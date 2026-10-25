import type { Config } from "@netlify/functions";
import { getDb } from "./lib/db.js";
import { purgeHousehold } from "./lib/household-purge.js";

// Hourly retention run for the household licence server (KL.2). It deletes:
//  - sign-in and link codes (decoys too) that stopped working more than 24 hours ago, whether
//    they expired, were used or were replaced;
//  - rate-limit hits older than 24 hours;
//  - cached local prices stored more than 24 hours ago;
//  - linked-email hashes whose last sign-in (or linking) was more than 730 days ago (KL.8);
//  - store purchases refunded more than 395 days ago, with their issued records and device counts (KL.8).
// Other links, purchases, issued records and device counts are not touched.
// It runs whether or not HOUSEHOLD_ENABLED is on, and needs no variable beyond the database's.
// It deploys with the site, and Netlify runs scheduled functions on the published production deploy.
// What is kept and for how long: docs/household-licence-server.md, "Data kept".
export default async function handler(_req: Request) {
  try {
    const deleted = await purgeHousehold(getDb(), new Date());
    console.log(
      `household-purge: deleted ${deleted.codes} code rows, ${deleted.hits} rate-limit rows, ${deleted.prices} cached prices, ` +
        `${deleted.links} stale links and ${deleted.revoked} refunded purchases`
    );
    return new Response(JSON.stringify({ ok: true, ...deleted }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("household-purge: failed:", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ ok: false }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}

// Every hour, at 17 minutes past (Netlify cron is UTC), so a row is gone about an hour after
// it passes the 24-hour mark: the privacy policy can say "within 25 hours".
export const config: Config = { schedule: "17 * * * *" };
