import crypto from "node:crypto";
import type { Client } from "@libsql/client";
import { LINK_RETENTION_DAYS, MAX_TRIES, REVOKED_RETENTION_DAYS } from "./household-config.js";
import { canonicalBytes } from "./household-record.js";
import type { HouseholdRecord, RecordVia, SignedRecord } from "./household-record.js";

// Storage for the household licence (KL.2): store entitlements, email links, sign-in and link
// codes, issued records, the per-licence device count and the rate-limit hits. The tables are
// created on first use, as lib/licenses.ts does for its own, so no manual migration is needed;
// lib/schema.sql carries the same definitions (a test keeps the two in step).
//
// Nothing here holds an address in the clear: an email is kept only as a keyed hash of its
// normalised form (HMAC-SHA-256 under HOUSEHOLD_EMAIL_KEY, so it cannot be matched to an address
// without the key: KL.8), and a code only as a salted hash that expires.

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
  product        TEXT NOT NULL,
  email_hash     TEXT NOT NULL,
  app_user_id    TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  notice_version TEXT NOT NULL DEFAULT '',
  last_used_at   TEXT,
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

CREATE TABLE IF NOT EXISTS household_upgrades (
  paddle_txn_id TEXT PRIMARY KEY,
  license_id    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS household_price_cache (
  product    TEXT NOT NULL,
  country    TEXT NOT NULL,
  platform   TEXT NOT NULL,
  body       TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (product, country, platform)
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

/** The fewest bytes HOUSEHOLD_EMAIL_KEY may decode to. */
export const MIN_EMAIL_KEY_BYTES = 32;

/**
 * The server's hashing key from HOUSEHOLD_EMAIL_KEY (base64), or null when it is unset, not
 * base64, or shorter than MIN_EMAIL_KEY_BYTES. With no key the household endpoints refuse to run.
 */
export function parseEmailKey(value: string | undefined): Buffer | null {
  const text = (value ?? "").trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  const key = Buffer.from(text, "base64");
  return key.length >= MIN_EMAIL_KEY_BYTES ? key : null;
}

/** HMAC-SHA-256 (hex) of `label|value` under the key. The label keeps the three uses apart. */
function keyedHex(key: Buffer, label: string, value: string): string {
  return crypto.createHmac("sha256", key).update(`${label}|${value}`).digest("hex");
}

/**
 * How an address is kept and looked up (codes, links, the per-address limit): HMAC-SHA-256 of
 * the normalised address under the server's key. A plain SHA-256 of an email can be reversed by
 * hashing likely addresses (FTC Office of Technology, July 2024); this cannot, without the key.
 */
export function emailHash(email: string, key: Buffer): string {
  return keyedHex(key, "email", normaliseEmail(email));
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

/**
 * A short keyed digest of a request's address, for the rate-limit bucket. Keyed, because an IPv4
 * address hashed without a secret can be found again by trying all four billion of them.
 */
export function ipBucket(ip: string, key: Buffer): string {
  return "ip:" + keyedHex(key, "ip", ip).slice(0, 32);
}

export const emailBucket = (hash: string) => "email:" + hash;

/** The rate-limit bucket of RevenueCat lookups for one app user id (keyed, like the others). */
export const legacyLookupBucket = (appUserId: string, key: Buffer) =>
  "rcid:" + keyedHex(key, "rcid", appUserId).slice(0, 32);

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

/**
 * Links an address (its keyed hash) to an app user id, with the version of the notice the parent
 * agreed to (KL.8). Linking again renews the consent: the newer notice and time replace the old.
 */
export async function addLink(
  db: Client,
  product: string,
  hash: string,
  appUserId: string,
  noticeVersion = "",
  now?: Date
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO household_email_links (product, email_hash, app_user_id, notice_version, created_at)
          VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')))
          ON CONFLICT (product, email_hash, app_user_id)
          DO UPDATE SET notice_version = excluded.notice_version, created_at = excluded.created_at`,
    args: [product, hash, appUserId, noticeVersion, now ? now.toISOString() : null],
  });
}

/** Notes a successful sign-in for an address's links, which restarts their retention clock. */
export async function touchLinks(db: Client, product: string, hash: string, now: Date): Promise<number> {
  const res = await db.execute({
    sql: "UPDATE household_email_links SET last_used_at = ? WHERE product = ? AND email_hash = ?",
    args: [now.toISOString(), product, hash],
  });
  return res.rowsAffected;
}

/**
 * Forgets an address (KL.8, a parent taking consent back): every link of it for this product, every
 * code row for it, and its per-address rate-limit hits. Returns how many links went.
 */
export async function removeEmail(db: Client, product: string, hash: string): Promise<number> {
  const links = await db.execute({
    sql: "DELETE FROM household_email_links WHERE product = ? AND email_hash = ?",
    args: [product, hash],
  });
  await db.execute({ sql: "DELETE FROM household_codes WHERE product = ? AND email_hash = ?", args: [product, hash] });
  await db.execute({ sql: "DELETE FROM household_hits WHERE bucket = ?", args: [emailBucket(hash)] });
  return links.rowsAffected;
}

/**
 * After a refund: deletes the links of the app user ids behind those transactions that no longer
 * own any purchase that is not revoked. A link exists only to restore a purchase.
 */
export async function dropLinksOfRefunded(db: Client, transactionIds: string[]): Promise<number> {
  const ids = [...new Set(transactionIds)];
  if (ids.length === 0) return 0;
  const marks = ids.map(() => "?").join(", ");
  const res = await db.execute({
    sql: `DELETE FROM household_email_links
          WHERE app_user_id IN (
            SELECT app_user_id FROM household_store_entitlements
            WHERE transaction_id IN (${marks}) OR original_transaction_id IN (${marks})
          )
          AND NOT EXISTS (
            SELECT 1 FROM household_store_entitlements e
            WHERE e.product = household_email_links.product
              AND e.app_user_id = household_email_links.app_user_id
              AND e.revoked = 0
          )`,
    args: [...ids, ...ids],
  });
  return res.rowsAffected;
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

export type CodePurpose = "signin" | "link" | "remove";

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

/** How long a row that has stopped counting is kept, in hours. The figure the privacy policy quotes. */
export const RETENTION_HOURS = 24;

/**
 * Deletes the codes that stopped working more than RETENTION_HOURS ago, decoys included. A code
 * stops working when it expires, is used, or is replaced by a newer one: whichever came first.
 */
export async function purgeOldCodes(db: Client, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_HOURS * 3_600_000).toISOString();
  const res = await db.execute({
    sql: "DELETE FROM household_codes WHERE MIN(expires_at, COALESCE(closed_at, expires_at)) < ?",
    args: [cutoff],
  });
  return res.rowsAffected;
}

/**
 * Deletes links whose last sign-in (or, never used, whose linking) was more than LINK_RETENTION_DAYS
 * ago (KL.8; 16 CFR 312.10: no indefinite retention). julianday() reads both of the time formats
 * the table holds (SQLite's default and ISO 8601).
 */
export async function purgeStaleLinks(db: Client, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - LINK_RETENTION_DAYS * 86_400_000).toISOString();
  const stale = await db.execute({
    sql: "DELETE FROM household_email_links WHERE julianday(COALESCE(last_used_at, created_at)) < julianday(?)",
    args: [cutoff],
  });
  // A link exists only to restore a store purchase: one whose app user id has no purchase left that
  // is not revoked has nothing to restore (the refund webhook drops these at once; this catches the rest).
  const orphaned = await db.execute(`DELETE FROM household_email_links
    WHERE NOT EXISTS (
      SELECT 1 FROM household_store_entitlements e
      WHERE e.product = household_email_links.product
        AND e.app_user_id = household_email_links.app_user_id
        AND e.revoked = 0
    )`);
  return stale.rowsAffected + orphaned.rowsAffected;
}

/**
 * Deletes store purchases refunded more than REVOKED_RETENTION_DAYS ago, with their issued records
 * and device counts (KL.8). A refunded purchase is kept that long for chargebacks and disputes.
 */
export async function purgeRevokedPurchases(db: Client, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - REVOKED_RETENTION_DAYS * 86_400_000).toISOString();
  const old = `SELECT product, lid FROM household_store_entitlements
               WHERE revoked = 1 AND revoked_at IS NOT NULL AND julianday(revoked_at) < julianday(?)`;
  await db.execute({
    sql: `DELETE FROM household_issued WHERE (product, lid) IN (${old})`,
    args: [cutoff],
  });
  await db.execute({
    sql: `DELETE FROM household_devices WHERE (product, lid) IN (${old})`,
    args: [cutoff],
  });
  const res = await db.execute({
    sql: `DELETE FROM household_store_entitlements
          WHERE revoked = 1 AND revoked_at IS NOT NULL AND julianday(revoked_at) < julianday(?)`,
    args: [cutoff],
  });
  return res.rowsAffected;
}

/** Deletes rate-limit hits older than RETENTION_HOURS (they stop counting after one hour). */
export async function purgeOldHits(db: Client, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_HOURS * 3_600_000).toISOString();
  const res = await db.execute({ sql: "DELETE FROM household_hits WHERE at < ?", args: [cutoff] });
  return res.rowsAffected;
}

// ---------------------------------------------------------------------------------------------
// Local prices cache (the `prices` endpoint)

/** The cached `prices` answer for a country and platform if it was stored since `since`, else null. */
export async function getCachedPrices(
  db: Client,
  product: string,
  country: string,
  platform: string,
  since: Date
): Promise<string | null> {
  const res = await db.execute({
    sql: `SELECT body FROM household_price_cache
          WHERE product = ? AND country = ? AND platform = ? AND fetched_at > ?`,
    args: [product, country, platform, since.toISOString()],
  });
  return res.rows.length ? String(res.rows[0].body) : null;
}

/** Keeps a `prices` answer (public prices only: no address, no IP) for a country and platform. */
export async function putCachedPrices(
  db: Client,
  product: string,
  country: string,
  platform: string,
  body: string,
  now: Date
): Promise<void> {
  await db.execute({
    sql: `INSERT OR REPLACE INTO household_price_cache (product, country, platform, body, fetched_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [product, country, platform, body, now.toISOString()],
  });
}

/** Deletes cached prices stored more than RETENTION_HOURS ago (they stop being used after one hour). */
export async function purgeOldPrices(db: Client, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_HOURS * 3_600_000).toISOString();
  const res = await db.execute({ sql: "DELETE FROM household_price_cache WHERE fetched_at < ?", args: [cutoff] });
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
