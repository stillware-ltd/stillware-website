import type { Client } from "@libsql/client";
import { generateLicenseKey, hashLicenseKey } from "./crypto.js";
import { ensureLicenceTierColumn, ensureLicensePlatformColumn } from "./licenses.js";
import {
  licenceTermsFromTransactionItems,
  type LicensePlatform,
  type ProductConfig,
} from "./products.js";

// The part of paddle-webhook.ts after Paddle's signature is checked: mint the licence, email
// the key and, for an Every device price, issue the household record alongside. Kept apart
// from the HTTP handler and the Paddle SDK so it can be exercised against a local database.

/** licenses.email is NOT NULL in the schema; we keep a placeholder instead of the buyer's address. */
export const EMAIL_NOT_STORED = "not-stored";

export interface MintDeps {
  db: Client;
  /** Emails the key (lib/email.ts sendLicenseEmail). */
  sendKey: (
    to: string,
    licenseKey: string,
    product: ProductConfig,
    opts: { platform: LicensePlatform | null }
  ) => Promise<void>;
  /** HOUSEHOLD_DEVICE_CAP: the desktop activations an Every device licence gets. */
  deviceCap: number;
  /**
   * Signs and keeps the household record for a new Every device licence. Left out while
   * HOUSEHOLD_ENABLED is off: the licence is still tagged, and a record is signed on demand
   * when the household first asks for it.
   */
  issueHousehold?: (licenceId: string, purchasedDate: string) => Promise<void>;
  /** For tests: the list of Every device Paddle prices to use instead of the real one. */
  everyDevicePrices?: readonly string[];
}

export interface MintInput {
  transactionId: string;
  items: Array<{ price?: { id?: string } | null } | undefined> | undefined;
  product: ProductConfig;
  customerEmail: string;
}

/**
 * Mints the licence for a completed transaction. "duplicate" means Paddle sent the webhook
 * twice (the UNIQUE paddle_txn_id): nothing is sent. A database error other than that is thrown,
 * so the handler can answer 500 and Paddle retries. A failed email or a failed household
 * record is logged and does not undo the licence.
 */
export async function mintLicence(deps: MintDeps, input: MintInput): Promise<"minted" | "duplicate"> {
  const { db } = deps;
  const { platform, tier, maxActivations } = licenceTermsFromTransactionItems(
    input.items,
    input.product,
    deps.deviceCap,
    deps.everyDevicePrices
  );

  const licenseKey = generateLicenseKey();
  // Data minimisation (2026-09-30): the buyer's email is used below to send the key and is NOT
  // stored. Paddle, the merchant of record, already holds it and can be searched to find the
  // transaction id if support needs the licence.
  try {
    await ensureLicensePlatformColumn(db);
    await ensureLicenceTierColumn(db);
    await db.execute({
      sql: `INSERT INTO licenses (key_hash, email, paddle_txn_id, product, max_activations, platform, tier)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        hashLicenseKey(licenseKey),
        EMAIL_NOT_STORED,
        input.transactionId,
        input.product.slug,
        maxActivations,
        platform,
        tier,
      ],
    });
  } catch (err: any) {
    if (err?.message?.includes("UNIQUE constraint failed") || err?.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return "duplicate";
    }
    throw err;
  }

  // The only use of the address.
  try {
    await deps.sendKey(input.customerEmail, licenseKey, input.product, { platform });
  } catch (err) {
    console.error("Failed to send license email:", err);
  }

  if (tier === "every_device" && deps.issueHousehold) {
    try {
      const row = await db.execute({
        sql: "SELECT id, created_at FROM licenses WHERE paddle_txn_id = ?",
        args: [input.transactionId],
      });
      if (row.rows.length > 0) {
        await deps.issueHousehold(String(row.rows[0].id), String(row.rows[0].created_at).slice(0, 10));
      }
    } catch (err) {
      console.error("Failed to issue the household record:", err instanceof Error ? err.message : err);
    }
  }
  return "minted";
}
