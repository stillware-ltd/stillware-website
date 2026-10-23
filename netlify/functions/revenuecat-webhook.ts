import type { Context } from "@netlify/functions";
import { getDb } from "./lib/db.js";
import { handleRevenueCatWebhook } from "./lib/revenuecat.js";

// POST /webhooks/revenuecat: RevenueCat -> Every device purchases, refunds and transfers (KL.2).
// RevenueCat sends the value of REVENUECAT_WEBHOOK_AUTH in the Authorization header, exactly as
// typed in its dashboard. The logic and what it records: lib/revenuecat.ts.
export default function handler(req: Request, _context: Context) {
  return handleRevenueCatWebhook(req, { getDb, now: () => new Date(), env: process.env });
}
