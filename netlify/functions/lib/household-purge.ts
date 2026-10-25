import type { Client } from "@libsql/client";
import {
  ensureHouseholdTables,
  purgeOldCodes,
  purgeOldHits,
  purgeOldPrices,
  purgeRevokedPurchases,
  purgeStaleLinks,
  RETENTION_HOURS,
} from "./household-store.js";

// The retention run (netlify/functions/household-purge.ts). Kept apart from the function
// file so it can be tested against a local database.

export { RETENTION_HOURS };

export interface PurgeResult {
  /** Code rows deleted: those that stopped working more than RETENTION_HOURS ago. */
  codes: number;
  /** Rate-limit rows deleted: those older than RETENTION_HOURS. */
  hits: number;
  /** Cached local prices deleted: those stored more than RETENTION_HOURS ago. */
  prices: number;
  /** Linked emails deleted: last sign-in (or linking) more than LINK_RETENTION_DAYS ago (KL.8). */
  links: number;
  /** Store purchases deleted: refunded more than REVOKED_RETENTION_DAYS ago, with their records (KL.8). */
  revoked: number;
}

export async function purgeHousehold(db: Client, now: Date): Promise<PurgeResult> {
  await ensureHouseholdTables(db);
  return {
    codes: await purgeOldCodes(db, now),
    hits: await purgeOldHits(db, now),
    prices: await purgeOldPrices(db, now),
    links: await purgeStaleLinks(db, now),
    revoked: await purgeRevokedPurchases(db, now),
  };
}
