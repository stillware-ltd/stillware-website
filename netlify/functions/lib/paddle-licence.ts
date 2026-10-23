import type { Client } from "@libsql/client";
import { generateLicenseKey, hashLicenseKey } from "./crypto.js";
import { ensureHouseholdTables } from "./household-store.js";
import { ensureLicenceTierColumn, ensureLicensePlatformColumn, findLicenseByKey } from "./licenses.js";
import {
  EVERY_DEVICE_PADDLE_PRICE_IDS,
  EVERY_DEVICE_UPGRADE_PADDLE_PRICE_IDS,
  isUpgradePaddlePrice,
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
  /** For tests: the list of Every device UPGRADE Paddle prices to use instead of the real one. */
  upgradePrices?: readonly string[];
}

export interface MintInput {
  transactionId: string;
  items: Array<{ price?: { id?: string } | null } | undefined> | undefined;
  product: ProductConfig;
  customerEmail: string;
  /**
   * The transaction's custom data. For the Every device upgrade the desktop app sends
   * { licence: "<sha256 of the normalised key>" }; see licenceHashFromCustomData.
   */
  customData?: unknown;
}

/** The custom data of a Paddle notification (the SDK gives camelCase; raw JSON gives snake_case). */
export function customDataFrom(data: any): unknown {
  return data?.customData ?? data?.custom_data ?? null;
}

/**
 * The key hash the desktop app put in the checkout's custom data, or why there is none:
 * "missing" (no custom data, or no `licence` in it) or "malformed" (not 64 hex characters).
 */
export function licenceHashFromCustomData(customData: unknown): { hash: string } | { problem: "missing" | "malformed" } {
  if (typeof customData !== "object" || customData === null || Array.isArray(customData)) {
    return { problem: customData === null || customData === undefined ? "missing" : "malformed" };
  }
  const value = (customData as Record<string, unknown>).licence;
  if (value === undefined || value === null) return { problem: "missing" };
  if (typeof value !== "string" || !/^[0-9a-fA-F]{64}$/.test(value)) return { problem: "malformed" };
  return { hash: value.toLowerCase() };
}

/** Why an upgrade price became a new licence instead (for the log; never the key or its hash). */
type FallbackReason =
  | "no licence in the custom data"
  | "malformed licence in the custom data"
  | "no licence matches the key"
  | "the licence is revoked"
  | "the licence is already Every device"
  | "the licence changed while it was being upgraded";

function isUnique(err: any): boolean {
  return Boolean(err?.message?.includes("UNIQUE constraint failed") || err?.code === "SQLITE_CONSTRAINT_UNIQUE");
}

/**
 * The Every device upgrade of a key the buyer already has. Finds the licence from the hash in
 * the custom data (the original key or a re-issued one) for the same product, and makes it
 * Every device: tier every_device, any platform, at least the household's activations. The key
 * does not change, so no key email is sent. The claim row and the update go in one transaction,
 * and the claim (the Paddle transaction id) is what makes a repeat delivery a duplicate.
 *
 * Returns "upgraded", "duplicate", or why it could not be done (the caller then mints a new
 * Every device licence, so the purchase is never lost).
 */
async function upgradeExistingLicence(
  deps: MintDeps,
  input: MintInput
): Promise<{ done: "upgraded"; licenceId: string; created: string } | { done: "duplicate" } | { fallback: FallbackReason }> {
  const { db } = deps;
  await ensureHouseholdTables(db);

  const seen = await db.execute({
    sql: `SELECT 1 FROM household_upgrades WHERE paddle_txn_id = ?
          UNION ALL SELECT 1 FROM licenses WHERE paddle_txn_id = ?`,
    args: [input.transactionId, input.transactionId],
  });
  if (seen.rows.length > 0) return { done: "duplicate" };

  const asked = licenceHashFromCustomData(input.customData);
  if ("problem" in asked) {
    return { fallback: asked.problem === "missing" ? "no licence in the custom data" : "malformed licence in the custom data" };
  }
  const row = await findLicenseByKey(db, asked.hash, input.product.slug);
  if (!row) return { fallback: "no licence matches the key" };
  if (row.revoked) return { fallback: "the licence is revoked" };
  if (row.tier === "every_device") return { fallback: "the licence is already Every device" };
  const licenceId = String(row.id);

  try {
    const [, updated] = await db.batch(
      [
        { sql: "INSERT INTO household_upgrades (paddle_txn_id, license_id) VALUES (?, ?)", args: [input.transactionId, licenceId] },
        {
          sql: `UPDATE licenses SET tier = 'every_device', platform = NULL, max_activations = MAX(max_activations, ?)
                WHERE id = ? AND revoked = 0 AND (tier IS NULL OR tier <> 'every_device')`,
          args: [deps.deviceCap, licenceId],
        },
      ],
      "write"
    );
    if (updated.rowsAffected === 0) {
      // Revoked or upgraded by someone else between the lookup and the update: undo the claim.
      await db.execute({ sql: "DELETE FROM household_upgrades WHERE paddle_txn_id = ?", args: [input.transactionId] });
      return { fallback: "the licence changed while it was being upgraded" };
    }
  } catch (err) {
    if (isUnique(err)) return { done: "duplicate" };
    throw err;
  }
  return { done: "upgraded", licenceId, created: String(row.created_at) };
}

/**
 * Mints the licence for a completed transaction. "upgraded" means an existing key was made
 * Every device in place (no email: the key is the same). "duplicate" means Paddle sent the
 * webhook twice (the UNIQUE paddle_txn_id): nothing is sent. A database error other than that is thrown,
 * so the handler can answer 500 and Paddle retries. A failed email or a failed household
 * record is logged and does not undo the licence.
 */
export async function mintLicence(deps: MintDeps, input: MintInput): Promise<"minted" | "duplicate" | "upgraded"> {
  const { db } = deps;

  // The Every device upgrade of an existing key: upgrade it in place. Anything that stops that
  // falls through to minting a new Every device licence below, so the buyer is never charged
  // for nothing.
  if (isUpgradePaddlePrice(input.items, deps.upgradePrices)) {
    const result = await upgradeExistingLicence(deps, input);
    if ("done" in result) {
      if (result.done === "upgraded" && deps.issueHousehold) {
        try {
          await deps.issueHousehold(result.licenceId, result.created.slice(0, 10));
        } catch (err) {
          console.error("Failed to issue the household record:", err instanceof Error ? err.message : err);
        }
      }
      return result.done;
    }
    console.warn(
      `Every device upgrade in transaction ${input.transactionId}: ${result.fallback}; minting a new Every device licence instead.`
    );
  }

  const { platform, tier, maxActivations } = licenceTermsFromTransactionItems(
    input.items,
    input.product,
    deps.deviceCap,
    // An upgrade price that could not upgrade anything is worth a whole Every device licence.
    [
      ...(deps.everyDevicePrices ?? EVERY_DEVICE_PADDLE_PRICE_IDS),
      ...(deps.upgradePrices ?? EVERY_DEVICE_UPGRADE_PADDLE_PRICE_IDS),
    ]
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
