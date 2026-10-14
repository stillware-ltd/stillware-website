import type { Client, Row } from "@libsql/client";

// A licence can be unlocked by more than one key. The key minted with the purchase is
// `licenses.key_hash`; every key issued later for the same purchase (lost-key recovery,
// license-resend-key.ts) is a row in `license_keys`. All of a licence's keys share its
// activations and its device limit, so re-issuing a key never adds a device slot and never
// stops an earlier key from working.
//
// The table is created on first use (as dashboard-ops.ts does), so no manual migration is
// needed; schema.sql carries the same definition.
let licenseKeysReady = false;

export async function ensureLicenseKeysTable(db: Client): Promise<void> {
  if (licenseKeysReady) return;
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS license_keys (
      key_hash   TEXT PRIMARY KEY,
      license_id TEXT NOT NULL REFERENCES licenses(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_license_keys_license ON license_keys(license_id);
  `);
  licenseKeysReady = true;
}

/**
 * The licence `keyHash` unlocks for `product` (id, max_activations, revoked), or null.
 *
 * The original-key lookup runs first and is the query activate/validate/deactivate always
 * ran, so a key that was never re-issued costs nothing extra; `license_keys` is only read
 * when that misses.
 */
export async function findLicenseByKey(
  db: Client,
  keyHash: string,
  product: string
): Promise<Row | null> {
  const original = await db.execute({
    sql: "SELECT id, max_activations, revoked FROM licenses WHERE key_hash = ? AND product = ?",
    args: [keyHash, product],
  });
  if (original.rows.length > 0) return original.rows[0];

  await ensureLicenseKeysTable(db);
  const reissued = await db.execute({
    sql: `SELECT l.id, l.max_activations, l.revoked
          FROM license_keys k JOIN licenses l ON l.id = k.license_id
          WHERE k.key_hash = ? AND l.product = ?`,
    args: [keyHash, product],
  });
  return reissued.rows[0] ?? null;
}
