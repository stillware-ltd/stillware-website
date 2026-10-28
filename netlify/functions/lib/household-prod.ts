import { getDb } from "./db.js";
import { sendHouseholdCodeEmail, sendHouseholdConfirmationEmail } from "./email.js";
import { REQUESTS_PER_IP_PER_HOUR, START_MIN_MS } from "./household-config.js";
import { householdHandlers, type HouseholdHandlers } from "./household-http.js";
import { loadSigner, type Signer } from "./household-record.js";
import { parseEmailKey } from "./household-store.js";
import { outboxKey } from "./mail-outbox.js";
import { codeSender, confirmationSender, realSleep } from "./mail-prod.js";
import { paddleCompletedTransactionIds } from "./paddle-lookup.js";
import { lookupLegacyPurchase, type LegacyLookup } from "./revenuecat-lookup.js";

// The real dependencies of the household endpoints: the Turso database, Resend, Paddle and the
// signing key from the environment. The function files call productionHandlers(); tests build
// their own with householdHandlers() and fakes.

let cachedSigner: { key: string; kid: string; signer: Signer } | null = null;

/** The signing key and key id from HOUSEHOLD_SIGNING_KEY and HOUSEHOLD_SIGNING_KID, parsed once. */
export function signerFromEnv(): Signer {
  const key = process.env.HOUSEHOLD_SIGNING_KEY ?? "";
  const kid = process.env.HOUSEHOLD_SIGNING_KID ?? "";
  if (!cachedSigner || cachedSigner.key !== key || cachedSigner.kid !== kid) {
    cachedSigner = { key, kid, signer: loadSigner(key, kid) };
  }
  return cachedSigner.signer;
}

let cachedEmailKey: { text: string; key: Buffer | null } | null = null;

/** The hashing key from HOUSEHOLD_EMAIL_KEY (base64, 32 bytes or more), parsed once; null when unusable. */
export function emailKeyFromEnv(): Buffer | null {
  const text = process.env.HOUSEHOLD_EMAIL_KEY ?? "";
  if (!cachedEmailKey || cachedEmailKey.text !== text) cachedEmailKey = { text, key: parseEmailKey(text) };
  return cachedEmailKey.key;
}

/** The key failed mails are sealed with (lib/mail-outbox.ts), derived from HOUSEHOLD_EMAIL_KEY; null when that is unusable. */
export function outboxKeyFromEnv(): Buffer | null {
  const key = emailKeyFromEnv();
  return key ? outboxKey(key) : null;
}

/** RevenueCat lookups for earlier buyers, only when REVENUECAT_SECRET_API_KEY is set. */
function legacyLookupFromEnv(): LegacyLookup | undefined {
  const key = (process.env.REVENUECAT_SECRET_API_KEY ?? "").trim();
  if (!key) return undefined;
  return (appUserId, entitlementId, platform) =>
    lookupLegacyPurchase({ key, appUserId, entitlementId, platform });
}

export function productionHandlers(): HouseholdHandlers {
  return householdHandlers({
    env: () => process.env,
    build: (settings) => {
      const db = getDb();
      const now = () => new Date();
      return {
        household: {
          legacyLookup: legacyLookupFromEnv(),
          db,
          now,
          settings,
          signer: signerFromEnv,
          emailKey: emailKeyFromEnv(),
          // Tried again at once on a passing failure; a confirmation that still fails is kept and
          // retried by the hourly run, a code is counted (lib/mail-prod.ts).
          sendCode: codeSender({ db, now, sleep: realSleep, send: sendHouseholdCodeEmail }),
          sendConfirmation: confirmationSender({ db, key: outboxKeyFromEnv(), now, sleep: realSleep, send: sendHouseholdConfirmationEmail }),
          paddleTransactionIds: (email) => paddleCompletedTransactionIds(process.env.PADDLE_API_KEY, email),
        },
        sleep: realSleep,
        startMinMs: START_MIN_MS,
        perIpLimit: REQUESTS_PER_IP_PER_HOUR,
      };
    },
  });
}
