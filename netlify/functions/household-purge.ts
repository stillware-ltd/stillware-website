import type { Config } from "@netlify/functions";
import { getDb } from "./lib/db.js";
import { sendAlertEmail, sendHouseholdConfirmationEmail, sendLicenseEmail } from "./lib/email.js";
import { SUPPORT_EMAIL } from "./lib/household-config.js";
import { outboxKeyFromEnv } from "./lib/household-prod.js";
import { purgeHousehold } from "./lib/household-purge.js";
import { mailErrorCode } from "./lib/mail-outbox.js";
import { realSleep, runMailJob } from "./lib/mail-prod.js";

// Hourly retention run for the household licence server (KL.2). It deletes:
//  - sign-in and link codes (decoys too) that stopped working more than 24 hours ago, whether
//    they expired, were used or were replaced;
//  - rate-limit hits older than 24 hours;
//  - cached local prices stored more than 24 hours ago;
//  - linked-email hashes whose last sign-in (or linking) was more than 730 days ago (KL.8);
//  - store purchases refunded more than 395 days ago, with their issued records and device counts (KL.8).
// Other links, purchases, issued records and device counts are not touched.
// Then the mail run (lib/mail-outbox.ts): it tries again the licence-key mails and confirmations
// that failed, deletes the ones kept for 24 hours, mails the founder a summary once a day when
// the day before had failures (to MAIL_ALERT_TO, or support), and deletes daily counts older than
// 90 days. The two parts run apart: a failure in one does not stop the other.
// It runs whether or not HOUSEHOLD_ENABLED is on, and needs no variable beyond the database's
// (and RESEND_API_KEY and HOUSEHOLD_EMAIL_KEY for the mail run, which are already set).
// It deploys with the site, and Netlify runs scheduled functions on the published production deploy.
// What is kept and for how long: docs/household-licence-server.md, "Data kept".
export default async function handler(_req: Request) {
  const db = getDb();
  let ok = true;
  let deleted: Awaited<ReturnType<typeof purgeHousehold>> | null = null;
  try {
    deleted = await purgeHousehold(db, new Date());
    console.log(
      `household-purge: deleted ${deleted.codes} code rows, ${deleted.hits} rate-limit rows, ${deleted.prices} cached prices, ` +
        `${deleted.links} stale links and ${deleted.revoked} refunded purchases`
    );
  } catch (err) {
    ok = false;
    console.error("household-purge: failed:", err instanceof Error ? err.message : err);
  }

  let mail: Awaited<ReturnType<typeof runMailJob>> | null = null;
  try {
    mail = await runMailJob({
      db,
      key: outboxKeyFromEnv(),
      now: () => new Date(),
      sleep: realSleep,
      sendKey: sendLicenseEmail,
      sendConfirmation: sendHouseholdConfirmationEmail,
      sendAlert: sendAlertEmail,
      alertTo: (process.env.MAIL_ALERT_TO ?? "").trim() || SUPPORT_EMAIL,
    });
    const o = mail.outbox;
    console.log(
      `mail-outbox: sent ${o.sent}, still failing ${o.failed}, gave up ${o.gaveUp}, rejected ${o.rejected}, ` +
        `kept ${o.pending}; daily summary ${mail.alert}; ${mail.purged} old counts deleted`
    );
  } catch (err) {
    ok = false;
    console.error(`mail-outbox: failed: ${mailErrorCode(err)}`);
  }

  return new Response(JSON.stringify({ ok, ...(deleted ?? {}), mail: mail ? { ...mail.outbox, alert: mail.alert } : null }), {
    status: ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
}

// Every hour, at 17 minutes past (Netlify cron is UTC), so a row is gone about an hour after
// it passes the 24-hour mark: the privacy policy can say "within 25 hours".
export const config: Config = { schedule: "17 * * * *" };
