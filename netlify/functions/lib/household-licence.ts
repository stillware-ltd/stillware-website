import type { Client } from "@libsql/client";
import type { HouseholdSettings } from "./household-config.js";
import { householdTierOfLicence, issueRecord } from "./household.js";
import { signerFromEnv } from "./household-prod.js";
import { isHouseholdProduct } from "./products.js";

// What the desktop licence endpoints (license-activate, license-validate) share about the
// household licence: whether a licence is Every device, and the signed record that goes in their
// answer as `household: {record, kid, sig}`.

/**
 * How a licence is Every device (via "paddle": sold at an Every device price or upgraded with the
 * Paddle upgrade; via "upgrade": the free upgrade of an earlier buyer, from HOUSEHOLD_UPGRADE_BEFORE),
 * or null. Always null while HOUSEHOLD_ENABLED is off, for a product with no household endpoints,
 * and for a revoked licence, so nothing changes for today's licences until the switch.
 */
export function everyDeviceOfLicence(
  row: { revoked: unknown; tier: unknown; created_at: unknown },
  productSlug: string,
  settings: HouseholdSettings
): { via: "paddle" | "upgrade"; purchased: string } | null {
  if (!settings.enabled || !isHouseholdProduct(productSlug)) return null;
  return householdTierOfLicence(row, settings.upgradeBefore);
}

/**
 * `{ household: {record, kid, sig} }` for an Every device licence, else nothing. A record that
 * cannot be signed is logged (by `endpoint`, never with the key) and left out: it must never stop
 * an activation or a validation.
 */
export async function householdRecordPart(
  db: Client,
  product: string,
  licenceId: string,
  everyDevice: { via: "paddle" | "upgrade"; purchased: string } | null,
  endpoint: string
): Promise<{ household?: object }> {
  if (!everyDevice) return {};
  try {
    const signed = await issueRecord({ db, now: () => new Date(), signer: signerFromEnv }, product, {
      lid: licenceId,
      via: everyDevice.via,
      purchased: everyDevice.purchased,
    });
    return { household: signed };
  } catch (err) {
    console.error(`${endpoint}: could not issue the household record:`, err instanceof Error ? err.message : err);
    return {};
  }
}
