import crypto from "node:crypto";
import type { Client } from "@libsql/client";
import { MAX_TRIES } from "./household-config.js";
import { canonicalBytes } from "./household-record.js";
import type { HouseholdRecord, RecordVia, SignedRecord } from "./household-record.js";

// Storage for the household licence (KL.2): store entitlements, email links, sign-in and link
// codes, issued records, the per-licence device count and the rate-limit hits. The tables are
// created on first use, as lib/licenses.ts does for its own, so no manual migration is needed;
// lib/schema.sql carries the same definitions (a test keeps the two in step).
//
// Nothing here holds an address in the clear: an email is kept only as the SHA-256 of its
// normalised form, and a code only as a salted hash that expires.

export const HOUSEHOLD_SCHEMA = `
CREATE TABLE IF NOT EXISTS household_store_entitlements (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  product                 TEXT NOT NULL,
  app_user_id             TEXT NOT NULL,
  lid                     TEXT NOT NULL UNIQUE,
  product_id              TEXT NOT NULL,
  store                   TEXT NOT NULL,
  via                     TEXT NOT NULL,
  purchased               TEXT NOT NULL,
  transaction_id          TEXT NOT NULL UNIQUE,
  original_transaction_id TEXT,
  environment             TEXT NOT NULL DEFAULT 'PRODUCTION',
  revoked                 INTEGER NOT NULL DEFAULT 0,
  revoked_at              TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_household_ent_user ON household_store_entitlements(product, app_user_id);

CREATE TABLE IF NOT EXISTS household_email_links (
  product     TEXT NOT NULL,
  email_hash  TEXT NOT NULL,
  app_user_id TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (product, email_hash, app_user_id)
);
CREATE INDEX IF NOT EXISTS idx_household_links_user ON household_email_links(app_user_id);

CREATE TABLE IF NOT EXISTS household_codes (
  id          TEXT PRIMARY KEY,
  purpose     TEXT NOT NULL,
  product     TEXT NOT NULL,
  email_hash  TEXT NOT NULL,
  app_user_id TEXT NOT NULL DEFAULT '',
  lid         TEXT,
  lid_source  TEXT,
  salt        TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  tries       INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  closed_at   TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_household_codes_lookup ON household_codes(purpose, product, email_hash, created_at);

CREATE TABLE IF NOT EXISTS household_issued (
  product    TEXT NOT NULL,
  lid        TEXT NOT NULL,
  kid        TEXT NOT NULL,
  record     TEXT NOT NULL,
  sig        TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (product, lid, kid)
);

CREATE TABLE IF NOT EXISTS household_devices (
  product    TEXT NOT NULL,
  lid        TEXT NOT NULL,
  devices    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (product, lid)
);

CREATE TABLE IF NOT EXISTS household_hits (
  bucket TEXT NOT NULL,
  at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_household_hits_bucket ON household_hits(bucket, at);
CREATE INDEX IF NOT EXISTS idx_household_hits_at ON household_hits(at);
`;

const tablesReady = new WeakSet<Client>();

/** Creates the household tables if they are not there. Cheap after the first call per client. */
export async function ensureHouseholdTables(db: Client): Promise<void> {
  if (tablesReady.has(db)) return;
  await db.executeMultiple(HOUSEHOLD_SCHEMA);
  tablesReady.add(db);
}

// ---------------------------------------------------------------------------------------------
// Emails, codes, ids

/** The form an address is compared in: trimmed and lower-cased. Nothing cleverer. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** SHA-256 (hex) of the normalised address: how a linked email is kept and looked up. */
export function emailHash(email: string): string {
  return crypto.createHash("sha256").update(normaliseEmail(email)).digest("hex");
}

/** A 6-digit code, uniformly random, zero-padded. */
export function newCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export function newLid(): string {
  return crypto.randomBytes(16).toString("hex");
}

function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function codeDigest(salt: string, purpose: string, hash: string, code: string): string {
  return sha256Hex(`${salt}:${purpose}:${hash}:${code}`);
}

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** A short digest of a request's address, for the rate-limit bucket. Kept two hours at most. */
export function ipBucket(ip: string): string {
  return "ip:" + sha256Hex("household-ip|" + ip).slice(0, 32);
}

export const emailBucket = (hash: string) => "email:" + hash;

// ---------------------------------------------------------------------------------------------
// Rate limits

/**
 * Takes one hit from `bucket` if it has had fewer than `limit` in the last hour. One statement,
 * so two requests at once cannot both take the last place. Returns false when the hour's
 * allowance is used up (the hit is then not recorded).
 */
export async function takeHit(db: Client, bucket: string, limit: number, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - 3_600_000).toISOString();
  const res = await db.execute({
    sql: `INSERT INTO household_hits (bucket, at)
          SELECT ?, ? WHERE (SELECT COUNT(*) FROM household_hits WHERE bucket = ? AND at > ?) < ?`,
    args: [bucket, now.toISOString(), bucket, since, limit],
  });
  if (Math.random() < 0.05) {
    const old = new Date(now.getTime() - 7_200_000).toISOString();
    await db.execute({ sql: "DELETE FROM household_hits WHERE at < ?", args: [old] });
  }
  return res.rowsAffected > 0;
}

// ---------------------------------------------------------------------------------------------
// Store entitlements (written by revenuecat-webhook)

export type StoreName = "app_store" | "play";

export interface Entitlement {
  lid: string;
  appUserId: string;
  via: RecordVia;
  /** YYYY-MM-DD, UTC. */
  purchased: string;
}

export interface PurchaseInput {
  product: string;
  appUserId: string;
  productId: string;
  store: StoreName;
  via: RecordVia;
  purchased: string;
  transactionId: string;
  originalTransactionId: string | null;
  environment: string;
}

/** Records an Every device purchase. A transaction already recorded is left as it is. */
export async function recordPurchase(db: Client, p: PurchaseInput): Promise<"recorded" | "duplicate"> {
  const res = await db.execute({
    sql: `INSERT OR IGNORE INTO household_store_entitlements
            (product, app_user_id, lid, product_id, store, via, purchased, transaction_id,
             original_transaction_id, environment)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      p.product, p.appUserId, newLid(), p.productId, p.store, p.via, p.purchased, p.transactionId,
      p.originalTransactionId, p.environment,
    ],
  });
  return res.rowsAffected > 0 ? "recorded" : "duplicate";
}

/**
 * A refund: revokes the entitlement bought in any of these store transactions. Records already
 * issued are not touched (honour-based: the app keeps verifying them). Returns how many
 * entitlements it revoked.
 */
export async function revokeByTransaction(db: Client, transactionIds: string[], now: Date): Promise<number> {
  const ids = [...new Set(transactionIds)];
  if (ids.length === 0) return 0;
  const marks = ids.map(() => "?").join(", ");
  const res = await db.execute({
    sql: `UPDATE household_store_entitlements SET revoked = 1, revoked_at = ?
          WHERE revoked = 0 AND (transaction_id IN (${marks}) OR original_transaction_id IN (${marks}))`,
    args: [now.toISOString(), ...ids, ...ids],
  });
  return res.rowsAffected;
}

/**
 * A RevenueCat transfer: what was bought under the `from` app user ids now belongs to `to`.
 * Linked emails move with it. Returns how many entitlements moved.
 */
export async function transferAppUser(db: Client, from: string[], to: string): Promise<number> {
  let moved = 0;
  for (const id of new Set(from)) {
    if (id === to) continue;
    const res = await db.execute({
      sql: "UPDATE household_store_entitlements SET app_user_id = ? WHERE app_user_id = ?",
      args: [to, id],
    });
    moved += res.rowsAffected;
    await db.execute({
      sql: "UPDATE OR IGNORE household_email_links SET app_user_id = ? WHERE app_user_id = ?",
      args: [to, id],
    });
    // A link that was already there for `to` makes the update above skip its row: drop the rest.
    await db.execute({ sql: "DELETE FROM household_email_links WHERE app_user_id = ?", args: [id] });
  }
  return moved;
}

function toEntitlement(row: Record<string, unknown>): Entitlement {
  return {
    lid: String(row.lid),
    appUserId: String(row.app_user_id),
    via: row.via as RecordVia,
    purchased: String(row.purchased),
  };
}

/** The earliest entitlement that is not revoked for any of these app user ids, or null. */
export async function entitlementForAppUsers(
  db: Client,
  product: string,
  appUserIds: string[]
): Promise<Entitlement | null> {
  if (appUserIds.length === 0) return null;
  const marks = appUserIds.map(() => "?").join(", ");
  const res = await db.execute({
    sql: `SELECT lid, app_user_id, via, purchased FROM household_store_entitlements
          WHERE product = ? AND revoked = 0 AND app_user_id IN (${marks})
          ORDER BY purchased ASC, id ASC LIMIT 1`,
    args: [product, ...appUserIds],
  });
  return res.rows.length ? toEntitlement(res.rows[0] as unknown as Record<string, unknown>) : null;
}

/** The entitlement with this licence id, if it is not revoked. */
export async function entitlementByLid(db: Client, product: string, lid: string): Promise<Entitlement | null> {
  const res = await db.execute({
    sql: `SELECT lid, app_user_id, via, purchased FROM household_store_entitlements
          WHERE product = ? AND lid = ? AND revoked = 0`,
    args: [product, lid],
  });
  return res.rows.length ? toEntitlement(res.rows[0] as unknown as Record<string, unknown>) : null;
}

// ---------------------------------------------------------------------------------------------
// Email links

export async function addLink(db: Client, product: string, hash: string, appUserId: string): Promise<void> {
  await db.execute({
    sql: "INSERT OR IGNORE INTO household_email_links (product, email_hash, app_user_id) VALUES (?, ?, ?)",
    args: [product, hash, appUserId],
  });
}

export async function linkedAppUsers(db: Client, product: string, hash: string): Promise<string[]> {
  const res = await db.execute({
    sql: "SELECT app_user_id FROM household_email_links WHERE product = ? AND email_hash = ?",
    args: [product, hash],
  });
  return res.rows.map((r) => String(r.app_user_id));
}

// ---------------------------------------------------------------------------------------------
// Paddle licences (the existing `licenses` table)

export interface PaddleLicenceRow {
  id: string;
  revoked: number;
  tier: string | null;
  created_at: string;
}

function toLicenceRow(row: Record<string, unknown>): PaddleLicenceRow {
  return {
    id: String(row.id),
    revoked: Number(row.revoked),
    tier: row.tier === null || row.tier === undefined ? null : String(row.tier),
    created_at: String(row.created_at),
  };
}

/** The licences minted by these Paddle transactions for `product`, oldest first. */
export async function licencesByTransactions(
  db: Client,
  product: string,
  transactionIds: string[]
): Promise<PaddleLicenceRow[]> {
  if (transactionIds.length === 0) return [];
  const marks = transactionIds.map(() => "?").join(", ");
  const res = await db.execute({
    sql: `SELECT id, revoked, tier, created_at FROM licenses
          WHERE product = ? AND paddle_txn_id IN (${marks}) ORDER BY created_at ASC, id ASC`,
    args: [product, ...transactionIds],
  });
  return res.rows.map((r) => toLicenceRow(r as unknown as Record<string, unknown>));
}

export async function licenceById(db: Client, product: string, id: string): Promise<PaddleLicenceRow | null> {
  const res = await db.execute({
    sql: "SELECT id, revoked, tier, created_at FROM licenses WHERE product = ? AND id = ?",
    args: [product, id],
  });
  return res.rows.length ? toLicenceRow(res.rows[0] as unknown as Record<string, unknown>) : null;
}

/**
 * Whether the licences table holds any licence that could be Every device: tagged so, or old
 * enough to be upgraded. When it holds none, sign-in skips the Paddle lookup altogether.
 */
export async function anyPaddleHouseholdLicence(
  db: Client,
  product: string,
  upgradeBefore: string | null
): Promise<boolean> {
  const res = await db.execute({
    sql: `SELECT 1 FROM licenses
          WHERE product = ? AND revoked = 0 AND (tier = 'every_device' OR (? IS NOT NULL AND created_at < ?))
          LIMIT 1`,
    args: [product, upgradeBefore, upgradeBefore],
  });
  return res.rows.length > 0;
}

// ---------------------------------------------------------------------------------------------
// Codes

export type CodePurpose = "signin" | "link";

export interface NewCodeInput {
  purpose: CodePurpose;
  product: string;
  emailHash: string;
  /** Link codes only; "" for sign-in. */
  appUserId: string;
  /**
   * The code to keep, or null for a decoy: a row that behaves like a code (tries, expiry) but
   * can never match, which is what an address with no purchase gets. Because it answers like a
   * real code, a known address and an unknown one cannot be told apart by trying codes.
   */
  code: string | null;
  /** The licence a sign-in code unlocks, and where it lives; null for a decoy and for link codes. */
  lid: string | null;
  lidSource: "store" | "paddle" | null;
  now: Date;
  ttlMinutes: number;
}

/** Deletes codes that expired more than a day ago, so the table (decoys included) stays small. */
export async function purgeOldCodes(db: Client, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - 86_400_000).toISOString();
  const res = await db.execute({ sql: "DELETE FROM household_codes WHERE expires_at < ?", args: [cutoff] });
  return res.rowsAffected;
}

/** Stores a code and closes any earlier live code for the same address (and app user). */
export async function storeCode(db: Client, c: NewCodeInput): Promise<void> {
  const at = c.now.toISOString();
  if (Math.random() < 0.05) await purgeOldCodes(db, c.now);
  await db.execute({
    sql: `UPDATE household_codes SET closed_at = ?
          WHERE purpose = ? AND product = ? AND email_hash = ? AND app_user_id = ? AND closed_at IS NULL`,
    args: [at, c.purpose, c.product, c.emailHash, c.appUserId],
  });
  const salt = crypto.randomBytes(16).toString("hex");
  const digest = codeDigest(salt, c.purpose, c.emailHash, c.code ?? "decoy-" + crypto.randomBytes(8).toString("hex"));
  await db.execute({
    sql: `INSERT INTO household_codes
            (id, purpose, product, email_hash, app_user_id, lid, lid_source, salt, code_hash, expires_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      newLid(), c.purpose, c.product, c.emailHash, c.appUserId, c.lid, c.lidSource, salt, digest,
      new Date(c.now.getTime() + c.ttlMinutes * 60_000).toISOString(), at,
    ],
  });
}

export type CodeCheck =
  | { ok: true; lid: string | null; lidSource: "store" | "paddle" | null }
  | { ok: false; error: "expired" }
  | { ok: false; error: "too_many_tries" }
  | { ok: false; error: "wrong_code"; triesLeft: number };

export interface CheckCodeInput {
  purpose: CodePurpose;
  product: string;
  emailHash: string;
  appUserId: string;
  code: string;
  now: Date;
}

/**
 * Checks a code against the newest live one for the address.
 *  - No live code, or it has expired, or it was already used: "expired" (one answer for all three).
 *  - Five wrong guesses use a code up: the fifth, and every later try, is "too_many_tries".
 *  - A right code works once.
 * A try is counted before the code is compared, in one statement, so guesses made at the same
 * time cannot slip past the limit.
 */
export async function checkCode(db: Client, c: CheckCodeInput): Promise<CodeCheck> {
  const found = await db.execute({
    sql: `SELECT id, salt, code_hash, lid, lid_source, tries, expires_at FROM household_codes
          WHERE purpose = ? AND product = ? AND email_hash = ? AND app_user_id = ? AND closed_at IS NULL
          ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    args: [c.purpose, c.product, c.emailHash, c.appUserId],
  });
  if (found.rows.length === 0) return { ok: false, error: "expired" };
  const row = found.rows[0];
  const id = String(row.id);
  if (String(row.expires_at) <= c.now.toISOString()) return { ok: false, error: "expired" };
  if (Number(row.tries) >= MAX_TRIES) return { ok: false, error: "too_many_tries" };

  const counted = await db.execute({
    sql: "UPDATE household_codes SET tries = tries + 1 WHERE id = ? AND closed_at IS NULL AND tries < ?",
    args: [id, MAX_TRIES],
  });
  if (counted.rowsAffected === 0) {
    // Lost a race: either the code was used (or replaced) a moment ago, or the tries ran out.
    const again = await db.execute({ sql: "SELECT closed_at FROM household_codes WHERE id = ?", args: [id] });
    return { ok: false, error: again.rows[0]?.closed_at ? "expired" : "too_many_tries" };
  }

  const digest = codeDigest(String(row.salt), c.purpose, c.emailHash, c.code);
  if (sameHex(digest, String(row.code_hash))) {
    const used = await db.execute({
      sql: "UPDATE household_codes SET closed_at = ? WHERE id = ? AND closed_at IS NULL",
      args: [c.now.toISOString(), id],
    });
    if (used.rowsAffected === 0) return { ok: false, error: "expired" };
    return {
      ok: true,
      lid: row.lid === null ? null : String(row.lid),
      lidSource: row.lid_source === null ? null : (String(row.lid_source) as "store" | "paddle"),
    };
  }

  const after = await db.execute({ sql: "SELECT tries FROM household_codes WHERE id = ?", args: [id] });
  const tries = Number(after.rows[0]?.tries ?? MAX_TRIES);
  if (tries >= MAX_TRIES) return { ok: false, error: "too_many_tries" };
  return { ok: false, error: "wrong_code", triesLeft: MAX_TRIES - tries };
}

// ---------------------------------------------------------------------------------------------
// Devices (the household cap)

/**
 * Counts one more device for a licence, unless it is at the cap. Each successful sign-in
 * counts one (the app sends no device id). One statement, so two sign-ins at once cannot both
 * take the last place. Returns false at the cap.
 */
export async function takeDeviceSlot(
  db: Client,
  product: string,
  lid: string,
  cap: number,
  now: Date
): Promise<boolean> {
  const res = await db.execute({
    sql: `INSERT INTO household_devices (product, lid, devices, updated_at) VALUES (?, ?, 1, ?)
          ON CONFLICT(product, lid) DO UPDATE SET devices = devices + 1, updated_at = excluded.updated_at
          WHERE devices < ?`,
    args: [product, lid, now.toISOString(), cap],
  });
  return res.rowsAffected > 0;
}

// ---------------------------------------------------------------------------------------------
// Issued records

/** The record already signed for this licence under this key id, or null. */
export async function getIssued(db: Client, product: string, lid: string, kid: string): Promise<SignedRecord | null> {
  const res = await db.execute({
    sql: "SELECT record, sig FROM household_issued WHERE product = ? AND lid = ? AND kid = ?",
    args: [product, lid, kid],
  });
  if (res.rows.length === 0) return null;
  return { record: JSON.parse(String(res.rows[0].record)) as HouseholdRecord, kid, sig: String(res.rows[0].sig) };
}

/** Keeps a signed record, as the exact text that was signed. */
export async function putIssued(db: Client, signed: SignedRecord, now: Date): Promise<void> {
  await db.execute({
    sql: `INSERT OR IGNORE INTO household_issued (product, lid, kid, record, sig, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      signed.record.product, signed.record.lid, signed.kid, canonicalBytes(signed.record).toString("utf8"),
      signed.sig, now.toISOString(),
    ],
  });
}
