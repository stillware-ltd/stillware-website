import type { Client } from "@libsql/client";
import { generateLicenseKey, hashLicenseKey } from "./crypto.js";
import { householdSettings } from "./household-config.js";
import { ensureLicenceTierColumn, ensureLicenseKeysTable, ensureLicensePlatformColumn } from "./licenses.js";
import {
  PRODUCTS,
  licenceTermsFromTransactionItems,
  productFromTransactionItems,
  type LicensePlatform,
  type ProductConfig,
  type ProductSlug,
} from "./products.js";

// Lost-key recovery, the logic behind license-resend-key.ts (kept apart from the HTTP
// handler and from the Paddle SDK so it can be exercised against a local database).

/** A completed Paddle transaction of the customer asking, as much of it as recovery needs. */
export interface Purchase {
  id: string;
  items: Array<{ price?: { id?: string } | null } | undefined>;
  /** The address Paddle holds for the customer: the only place a key is ever sent. */
  customerEmail: string;
}

export interface ResendDeps {
  db: Client;
  send: (
    to: string,
    licenseKey: string,
    product: ProductConfig,
    opts: { reissue: boolean; platform: LicensePlatform | null }
  ) => Promise<void>;
  /** HOUSEHOLD_DEVICE_CAP, for a licence minted here from an Every device price. Default: the environment's. */
  deviceCap?: number;
}

/** No second re-issued key for the same licence within this many minutes of the last. */
export const RESEND_COOLDOWN_MINUTES = 15;

/** Re-issued keys per licence before self-service stops and support takes over. */
export const MAX_REISSUED_KEYS = 10;

/** Same placeholder as paddle-webhook.ts: the buyer's address is not stored (2026-09-30). */
const EMAIL_NOT_STORED = "not-stored";

export type ResendOutcome = "reissued" | "minted" | "cooldown" | "limit" | "revoked";

/**
 * Emails a key for each of `purchases` that bought `productSlug`. The result is for logs and
 * tests only; the HTTP answer never depends on it (no email enumeration).
 */
export async function resendKeys(
  deps: ResendDeps,
  purchases: AsyncIterable<Purchase>,
  productSlug: ProductSlug
): Promise<Array<{ txn: string; outcome: ResendOutcome }>> {
  const product = PRODUCTS[productSlug];
  const results: Array<{ txn: string; outcome: ResendOutcome }> = [];
  for await (const purchase of purchases) {
    if (productFromTransactionItems(purchase.items) !== productSlug) continue;
    try {
      results.push({ txn: purchase.id, outcome: await resendFor(deps, purchase, product) });
    } catch (err) {
      console.error(`resend-key: transaction ${purchase.id} failed:`, err);
    }
  }
  return results;
}

async function resendFor(
  { db, send, deviceCap }: ResendDeps,
  purchase: Purchase,
  product: ProductConfig
): Promise<ResendOutcome> {
  const cooldown = `-${RESEND_COOLDOWN_MINUTES} minutes`;
  await ensureLicensePlatformColumn(db);
  const found = await db.execute({
    sql: `SELECT id, revoked, platform, created_at > datetime('now', ?) AS fresh
          FROM licenses WHERE paddle_txn_id = ? AND product = ?`,
    args: [cooldown, purchase.id, product.slug],
  });

  if (found.rows.length === 0) {
    // Paid, but no licence: the webhook never got through (as from 2026-09-29, when its
    // deliveries were redirected). Mint it now, as paddle-webhook.ts would have. The UNIQUE
    // paddle_txn_id makes a webhook that arrives later a duplicate, which sends nothing.
    const key = generateLicenseKey();
    // An Every device price mints an Every device licence, as the webhook would have.
    const { platform, tier, maxActivations } = licenceTermsFromTransactionItems(
      purchase.items,
      product,
      deviceCap ?? householdSettings(process.env).deviceCap
    );
    await ensureLicenceTierColumn(db);
    await db.execute({
      sql: `INSERT INTO licenses (key_hash, email, paddle_txn_id, product, max_activations, platform, tier)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [hashLicenseKey(key), EMAIL_NOT_STORED, purchase.id, product.slug, maxActivations, platform, tier],
    });
    await send(purchase.customerEmail, key, product, { reissue: false, platform });
    return "minted";
  }

  const license = found.rows[0];
  if (license.revoked) return "revoked";
  // Its key was emailed moments ago (by the webhook or the branch above).
  if (Number(license.fresh) > 0) return "cooldown";

  // Only the key's hash is stored, so the original cannot be sent again. Issue a new key for
  // the same licence instead (lib/licenses.ts): same activations, same device limit.
  await ensureLicenseKeysTable(db);
  const issued = await db.execute({
    sql: `SELECT COUNT(*) AS total,
                 COALESCE(SUM(created_at > datetime('now', ?)), 0) AS recent
          FROM license_keys WHERE license_id = ?`,
    args: [cooldown, license.id],
  });
  if (Number(issued.rows[0].recent) > 0) return "cooldown";
  if (Number(issued.rows[0].total) >= MAX_REISSUED_KEYS) return "limit";

  const key = generateLicenseKey();
  await db.execute({
    sql: "INSERT INTO license_keys (key_hash, license_id) VALUES (?, ?)",
    args: [hashLicenseKey(key), license.id],
  });
  // A re-issued key unlocks the same licence, so it is for the same platform (or any).
  const platform = (license.platform as LicensePlatform | null) ?? null;
  await send(purchase.customerEmail, key, product, { reissue: true, platform });
  return "reissued";
}
