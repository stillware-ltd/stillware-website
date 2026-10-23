import type { Client } from "@libsql/client";
import { ensureHouseholdTables, purgeOldCodes, purgeOldHits, purgeOldPrices, RETENTION_HOURS } from "./household-store.js";

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
}

export async function purgeHousehold(db: Client, now: Date): Promise<PurgeResult> {
  await ensureHouseholdTables(db);
  return { codes: await purgeOldCodes(db, now), hits: await purgeOldHits(db, now), prices: await purgeOldPrices(db, now) };
}
