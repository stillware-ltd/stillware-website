import type { Client } from "@libsql/client";
import {
  CODES_PER_EMAIL_PER_HOUR,
  CODE_TTL_MINUTES,
  LEGACY_LOOKUPS_PER_ID_PER_HOUR,
  NOTICE_VERSION,
  type HouseholdSettings,
} from "./household-config.js";
import {
  canonicalBytes,
  issuedStamp,
  signRecord,
  type HouseholdRecord,
  type RecordVia,
  type SignedRecord,
  type Signer,
} from "./household-record.js";
import {
  addLink,
  anyPaddleHouseholdLicence,
  checkCode,
  emailBucket,
  emailHash,
  ensureHouseholdTables,
  entitlementByLid,
  entitlementForAppUsers,
  getIssued,
  licenceById,
  licencesByTransactions,
  linkedAppUsers,
  legacyLookupBucket,
  newCode,
  putIssued,
  recordPurchase,
  removeEmail,
  storeCode,
  takeDeviceSlot,
  takeHit,
  touchLinks,
  type CodeCheck,
  type CodePurpose,
  type PaddleLicenceRow,
} from "./household-store.js";
import { ensureLicenceTierColumn } from "./licenses.js";
import { PRODUCTS, type ProductConfig, type ProductSlug } from "./products.js";
import type { LegacyLookup } from "./revenuecat-lookup.js";

// The household licence server's logic (KL.2), kept apart from the HTTP handlers and from the
// Paddle, Resend and RevenueCat clients so it can be tested against a local database (as
// lib/resend-key.ts is). Contract: docs/household-licence.md in the RankUp Chess repo, §4-§5.

export type SendCode = (
  to: string,
  code: string,
  product: ProductConfig,
  purpose: CodePurpose
) => Promise<void>;

/** The "plus" of email plus (KL.8): the confirmation after a link, a sign-in or a removal. */
export type SendConfirmation = (
  to: string,
  product: ProductConfig,
  kind: "link" | "signin" | "remove",
  at: Date
) => Promise<void>;

/** What the logic needs from the outside. The handlers build the real ones; tests build fakes. */
export interface HouseholdDeps {
  db: Client;
  now: () => Date;
  settings: HouseholdSettings;
  /** The signing key and key id. Throws when they are not configured. */
  signer: () => Signer;
  /**
   * The key every address, IP and app user id is hashed under (HOUSEHOLD_EMAIL_KEY). Null when it
   * is not configured: the HTTP layer then answers server_misconfigured before any logic runs.
   */
  emailKey: Buffer | null;
  sendCode: SendCode;
  sendConfirmation: SendConfirmation;
  /** Ids of the completed Paddle transactions of the customer(s) with this address. */
  paddleTransactionIds: (email: string) => Promise<string[]>;
  /**
   * Asks RevenueCat whether an app user id bought the One platform unlock before the switch.
   * Absent when REVENUECAT_SECRET_API_KEY is not set: then `fetch` never asks.
   */
  legacyLookup?: LegacyLookup;
}

/** What an answer is: an HTTP status and a JSON body. household-http.ts turns it into a Response. */
export interface Answer {
  status: number;
  body: Record<string, unknown>;
}

const answer = (status: number, body: Record<string, unknown>): Answer => ({ status, body });

/** The hashing key. household-http.ts refuses to call the logic without one, so this only guards. */
function keyOf(deps: HouseholdDeps): Buffer {
  if (!deps.emailKey) throw new Error("HOUSEHOLD_EMAIL_KEY is not set");
  return deps.emailKey;
}
const OK: Answer = answer(200, { ok: true });

/** A licence that has a right to a record. */
export interface Eligible {
  lid: string;
  source: "store" | "paddle";
  via: RecordVia;
  /** YYYY-MM-DD, UTC. */
  purchased: string;
}

// ---------------------------------------------------------------------------------------------
// Which Paddle licences are Every device

/**
 * Whether a Paddle licence is Every device, and how:
 *  - tagged `tier = 'every_device'` when it was sold (an Every device price): via "paddle";
 *  - otherwise, created before `upgradeBefore` (the switch date; unset means never): the free
 *    upgrade of an earlier buyer, via "upgrade".
 * A revoked licence is neither. `purchased` is the date the licence was created, in UTC.
 */
export function householdTierOfLicence(
  row: { revoked: unknown; tier: unknown; created_at: unknown },
  upgradeBefore: string | null
): { via: "paddle" | "upgrade"; purchased: string } | null {
  if (Number(row.revoked) !== 0) return null;
  const purchased = String(row.created_at ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchased)) return null;
  if (row.tier === "every_device") return { via: "paddle", purchased };
  if (upgradeBefore && purchased < upgradeBefore) return { via: "upgrade", purchased };
  return null;
}

function eligibleFromLicence(row: PaddleLicenceRow, upgradeBefore: string | null): Eligible | null {
  const tier = householdTierOfLicence(row, upgradeBefore);
  return tier ? { lid: row.id, source: "paddle", via: tier.via, purchased: tier.purchased } : null;
}

// ---------------------------------------------------------------------------------------------
// Issuing a record

export interface IssueDeps {
  db: Client;
  now: () => Date;
  signer: () => Signer;
}

/**
 * The signed record for a licence. The first call signs it and keeps it; later calls (the
 * same household on its next device) get the same record back. A new key id signs a new one,
 * so retiring a key in the app just needs the server to be on the new `kid`.
 */
export async function issueRecord(
  deps: IssueDeps,
  product: string,
  licence: { lid: string; via: RecordVia; purchased: string }
): Promise<SignedRecord> {
  await ensureHouseholdTables(deps.db);
  const signer = deps.signer();
  const stored = await getIssued(deps.db, product, licence.lid, signer.kid);
  if (stored) return stored;

  const now = deps.now();
  const record: HouseholdRecord = {
    v: 1,
    product,
    lid: licence.lid,
    tier: "every_device",
    via: licence.via,
    purchased: licence.purchased,
    issued: issuedStamp(now),
  };
  canonicalBytes(record); // refuses a malformed record before anything is signed or kept
  const signed = signRecord(record, signer);
  await putIssued(deps.db, signed, now);
  // Two requests at once both sign; the table keeps the first, and both answer with it.
  return (await getIssued(deps.db, product, licence.lid, signer.kid)) ?? signed;
}

// ---------------------------------------------------------------------------------------------
// Finding who owns what

/** The licence an app user id owns through a store purchase (revenuecat-webhook), if any. */
export async function eligibleForAppUser(
  db: Client,
  product: string,
  appUserIds: string[]
): Promise<Eligible | null> {
  const e = await entitlementForAppUsers(db, product, appUserIds);
  return e ? { lid: e.lid, source: "store", via: e.via, purchased: e.purchased } : null;
}

/**
 * The Every device licence an address owns: through an email linked to a store purchase, or
 * through a Paddle purchase made with that address (looked up at Paddle, as lib/resend-key.ts
 * does: the address is never stored here).
 */
async function eligibleForEmail(
  deps: HouseholdDeps,
  product: string,
  email: string,
  hash: string
): Promise<Eligible | null> {
  const { db, settings } = deps;
  const linked = await eligibleForAppUser(db, product, await linkedAppUsers(db, product, hash));
  if (linked) return linked;

  await ensureLicenceTierColumn(db);
  // No licence could qualify: no need to ask Paddle anything.
  if (!(await anyPaddleHouseholdLicence(db, product, settings.upgradeBefore))) return null;
  let transactionIds: string[];
  try {
    transactionIds = await deps.paddleTransactionIds(email);
  } catch (err) {
    console.error("household: Paddle lookup failed:", err);
    return null;
  }
  for (const row of await licencesByTransactions(db, product, transactionIds)) {
    const e = eligibleFromLicence(row, settings.upgradeBefore);
    if (e) return e;
  }
  return null;
}

/** The licence a stored code points at, if it is still Every device and not revoked. */
async function eligibleByLid(
  deps: HouseholdDeps,
  product: string,
  lid: string,
  source: "store" | "paddle"
): Promise<Eligible | null> {
  if (source === "store") {
    const e = await entitlementByLid(deps.db, product, lid);
    return e ? { lid: e.lid, source: "store", via: e.via, purchased: e.purchased } : null;
  }
  await ensureLicenceTierColumn(deps.db);
  const row = await licenceById(deps.db, product, lid);
  return row ? eligibleFromLicence(row, deps.settings.upgradeBefore) : null;
}

// ---------------------------------------------------------------------------------------------
// The five endpoints' logic

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (s: unknown): s is string =>
  typeof s === "string" && s.trim().length <= 254 && EMAIL_RE.test(s.trim());

/**
 * fetch: the record of the licence an app user id owns through a store purchase.
 * 404 none otherwise (including a revoked one).
 *
 * An earlier buyer has no entitlement here yet (their purchase predates the webhook), so when
 * none is found and HOUSEHOLD_UPGRADE_BEFORE and a RevenueCat key are set, RevenueCat is asked
 * once (upgradeFromRevenueCat). 503 try_later when it cannot be reached; 429 when this app user
 * id has used up its lookups for the hour.
 */
export async function fetchRecord(
  deps: HouseholdDeps,
  product: string,
  appUserId: string,
  platform?: string
): Promise<Answer> {
  await ensureHouseholdTables(deps.db);
  const signer = readSigner(deps);
  if (!signer) return SERVER_MISCONFIGURED;
  let e = await eligibleForAppUser(deps.db, product, [appUserId]);
  if (!e) {
    const upgraded = await upgradeFromRevenueCat(deps, product, appUserId, platform);
    if (upgraded === "unavailable") return answer(503, { error: "try_later" });
    if (upgraded === "limited") return answer(429, { error: "rate_limited" });
    e = upgraded;
  }
  if (!e) return answer(404, { error: "none" });
  return answer(200, { ...(await issueRecord(deps, product, e)) });
}

/**
 * The free upgrade of an earlier store buyer. Asks RevenueCat for the app user id's One platform
 * entitlement (at most LEGACY_LOOKUPS_PER_ID_PER_HOUR times an hour per id, counted before the
 * call). A purchase first made before HOUSEHOLD_UPGRADE_BEFORE is stored as an entitlement with
 * `via: "upgrade"` (sandbox ones marked as such, as the webhook does), so the next `fetch` finds
 * it here and RevenueCat is not asked again. A purchase on or after that date, no purchase or a
 * 404 is null (the same as never having bought). Nothing is stored when RevenueCat cannot be
 * reached.
 */
async function upgradeFromRevenueCat(
  deps: HouseholdDeps,
  product: string,
  appUserId: string,
  platform?: string
): Promise<Eligible | null | "unavailable" | "limited"> {
  const { settings, legacyLookup } = deps;
  if (!legacyLookup || !settings.upgradeBefore) return null;
  if (!(await takeHit(deps.db, legacyLookupBucket(appUserId, keyOf(deps)), LEGACY_LOOKUPS_PER_ID_PER_HOUR, deps.now()))) {
    return "limited";
  }
  let found;
  try {
    found = await legacyLookup(appUserId, settings.legacyEntitlement, platform);
  } catch (err) {
    console.error("household: RevenueCat lookup failed:", err instanceof Error ? err.name : "error");
    return "unavailable";
  }
  if (found.status === "unavailable") return "unavailable";
  if (found.status === "none") return null;

  const p = found.purchase;
  if (!(p.purchased < settings.upgradeBefore)) return null;
  await recordPurchase(deps.db, {
    product,
    appUserId,
    productId: p.productId,
    store: p.store,
    via: "upgrade",
    purchased: p.purchased,
    transactionId: p.transactionId,
    originalTransactionId: p.transactionId,
    environment: p.sandbox ? "SANDBOX" : "PRODUCTION",
  });
  // Null if that transaction was recorded before and since refunded (or for another app user id).
  return eligibleForAppUser(deps.db, product, [appUserId]);
}

/**
 * signin/start: a 6-digit code goes to the address only if a purchase matches. The answer is
 * 200 {"ok":true} in every case. An address with no purchase still gets a stored decoy code,
 * so a later signin/verify for it answers exactly as it would for a real one.
 * `outcome` is for logs and tests; the HTTP answer never depends on it.
 */
export async function startSignin(
  deps: HouseholdDeps,
  product: ProductSlug,
  rawEmail: string
): Promise<{ answer: Answer; outcome: "sent" | "no_match" | "limited" }> {
  await ensureHouseholdTables(deps.db);
  const email = rawEmail.trim();
  const hash = emailHash(email, keyOf(deps));
  const now = deps.now();
  if (!(await takeHit(deps.db, emailBucket(hash), CODES_PER_EMAIL_PER_HOUR, now))) {
    return { answer: OK, outcome: "limited" };
  }
  const eligible = await eligibleForEmail(deps, product, email, hash);
  const code = newCode();
  await storeCode(deps.db, {
    purpose: "signin",
    product,
    emailHash: hash,
    appUserId: "",
    code: eligible ? code : null,
    lid: eligible?.lid ?? null,
    lidSource: eligible?.source ?? null,
    now,
    ttlMinutes: CODE_TTL_MINUTES,
  });
  if (!eligible) return { answer: OK, outcome: "no_match" };
  await mail(deps, email, code, product, "signin");
  return { answer: OK, outcome: "sent" };
}

/**
 * signin/verify: the code, then the cap, then the signed record.
 *  - 400 wrong_code (with triesLeft), expired, too_many_tries
 *  - 409 device_cap: this licence already counts the household cap of devices
 * `platform` is checked by the caller and not kept: no device data is stored.
 */
export async function verifySignin(
  deps: HouseholdDeps,
  product: ProductSlug,
  rawEmail: string,
  code: string
): Promise<Answer> {
  await ensureHouseholdTables(deps.db);
  const signer = readSigner(deps);
  if (!signer) return SERVER_MISCONFIGURED;
  const now = deps.now();
  const hash = emailHash(rawEmail, keyOf(deps));
  const checked = await checkCode(deps.db, {
    purpose: "signin",
    product,
    emailHash: hash,
    appUserId: "",
    code,
    now,
  });
  if (!checked.ok) return codeError(checked);
  // A code that was never mailed cannot match; this only guards against an odd row.
  if (!checked.lid || !checked.lidSource) return answer(400, { error: "expired" });

  const licence = await eligibleByLid(deps, product, checked.lid, checked.lidSource);
  if (!licence) return answer(404, { error: "none" });
  if (!(await takeDeviceSlot(deps.db, product, licence.lid, deps.settings.deviceCap, now))) {
    return answer(409, { error: "device_cap" });
  }
  const record = await issueRecord(deps, product, licence);
  // A sign-in through a linked email restarts that link's retention clock (KL.8).
  await touchLinks(deps.db, product, hash, now);
  await confirm(deps, rawEmail, product, "signin", now);
  return answer(200, { ...record });
}

/**
 * link/start: a store buyer asks to link an address to their app user id. A code goes to the
 * address only when that app user id owns an Every device purchase; the answer is 200 either
 * way (and a decoy is stored when nothing is sent, as in signin/start).
 */
export async function startLink(
  deps: HouseholdDeps,
  product: ProductSlug,
  appUserId: string,
  rawEmail: string
): Promise<{ answer: Answer; outcome: "sent" | "no_match" | "limited" }> {
  await ensureHouseholdTables(deps.db);
  const email = rawEmail.trim();
  const hash = emailHash(email, keyOf(deps));
  const now = deps.now();
  if (!(await takeHit(deps.db, emailBucket(hash), CODES_PER_EMAIL_PER_HOUR, now))) {
    return { answer: OK, outcome: "limited" };
  }
  const owns = (await entitlementForAppUsers(deps.db, product, [appUserId])) !== null;
  const code = newCode();
  await storeCode(deps.db, {
    purpose: "link",
    product,
    emailHash: hash,
    appUserId,
    code: owns ? code : null,
    lid: null,
    lidSource: null,
    now,
    ttlMinutes: CODE_TTL_MINUTES,
  });
  if (!owns) return { answer: OK, outcome: "no_match" };
  await mail(deps, email, code, product, "link");
  return { answer: OK, outcome: "sent" };
}

/**
 * link/verify: the code confirms the address; it is then linked to the app user id (as a
 * SHA-256 of the normalised address), and that address can sign in. 200 {"linked":true}, or
 * the same code errors as signin/verify.
 */
export async function verifyLink(
  deps: HouseholdDeps,
  product: ProductSlug,
  appUserId: string,
  rawEmail: string,
  code: string
): Promise<Answer> {
  await ensureHouseholdTables(deps.db);
  const hash = emailHash(rawEmail, keyOf(deps));
  const now = deps.now();
  const checked = await checkCode(deps.db, {
    purpose: "link",
    product,
    emailHash: hash,
    appUserId,
    code,
    now,
  });
  if (!checked.ok) return codeError(checked);
  // Checked again now: the purchase may have been refunded since the code was sent.
  if ((await entitlementForAppUsers(deps.db, product, [appUserId])) === null) {
    return answer(404, { error: "none" });
  }
  // The parent agreed to this notice (the code mail) by entering its code: keep which one (KL.8).
  await addLink(deps.db, product, hash, appUserId, NOTICE_VERSION, now);
  await confirm(deps, rawEmail, product, "link", now);
  return answer(200, { linked: true });
}

/**
 * email/remove/start (KL.8): a parent asks to remove a linked address. A code goes to the address
 * only when it is linked to something; the answer is 200 either way, and a decoy is stored when
 * nothing is sent, so removal cannot be used to learn whose address is linked.
 */
export async function startRemove(
  deps: HouseholdDeps,
  product: ProductSlug,
  rawEmail: string
): Promise<{ answer: Answer; outcome: "sent" | "no_match" | "limited" }> {
  await ensureHouseholdTables(deps.db);
  const email = rawEmail.trim();
  const hash = emailHash(email, keyOf(deps));
  const now = deps.now();
  if (!(await takeHit(deps.db, emailBucket(hash), CODES_PER_EMAIL_PER_HOUR, now))) {
    return { answer: OK, outcome: "limited" };
  }
  const linked = (await linkedAppUsers(deps.db, product, hash)).length > 0;
  const code = newCode();
  await storeCode(deps.db, {
    purpose: "remove",
    product,
    emailHash: hash,
    appUserId: "",
    code: linked ? code : null,
    lid: null,
    lidSource: null,
    now,
    ttlMinutes: CODE_TTL_MINUTES,
  });
  if (!linked) return { answer: OK, outcome: "no_match" };
  await mail(deps, email, code, product, "remove");
  return { answer: OK, outcome: "sent" };
}

/**
 * email/remove/verify (KL.8): the code proves the address is the asker's; then every link of it,
 * its code rows and its rate-limit hits are deleted, and a last mail confirms it. 200
 * {"removed":true}, or the same code errors as signin/verify.
 */
export async function verifyRemove(
  deps: HouseholdDeps,
  product: ProductSlug,
  rawEmail: string,
  code: string
): Promise<Answer> {
  await ensureHouseholdTables(deps.db);
  const hash = emailHash(rawEmail, keyOf(deps));
  const now = deps.now();
  const checked = await checkCode(deps.db, { purpose: "remove", product, emailHash: hash, appUserId: "", code, now });
  if (!checked.ok) return codeError(checked);
  await removeEmail(deps.db, product, hash);
  await confirm(deps, rawEmail, product, "remove", now);
  return answer(200, { removed: true });
}

// ---------------------------------------------------------------------------------------------

const SERVER_MISCONFIGURED: Answer = answer(500, { error: "server_misconfigured" });

function readSigner(deps: HouseholdDeps): Signer | null {
  try {
    return deps.signer();
  } catch (err) {
    console.error("household: signing key is not usable:", err instanceof Error ? err.message : err);
    return null;
  }
}

function codeError(c: Exclude<CodeCheck, { ok: true }>): Answer {
  if (c.error === "wrong_code") return answer(400, { error: "wrong_code", triesLeft: c.triesLeft });
  return answer(400, { error: c.error });
}

/** Sends a confirmation; like mail(), a failure is logged (never the address) and changes nothing. */
async function confirm(
  deps: HouseholdDeps,
  rawEmail: string,
  product: ProductSlug,
  kind: "link" | "signin" | "remove",
  at: Date
): Promise<void> {
  try {
    await deps.sendConfirmation(rawEmail.trim(), PRODUCTS[product], kind, at);
  } catch (err) {
    console.error(`household: could not send a ${kind} confirmation:`, err instanceof Error ? err.message : err);
  }
}

async function mail(
  deps: HouseholdDeps,
  email: string,
  code: string,
  product: ProductSlug,
  purpose: CodePurpose
): Promise<void> {
  try {
    await deps.sendCode(email, code, PRODUCTS[product], purpose);
  } catch (err) {
    // The answer must not depend on whether the mail went: log it (never the address) and go on.
    console.error(`household: could not send a ${purpose} code:`, err instanceof Error ? err.message : err);
  }
}
