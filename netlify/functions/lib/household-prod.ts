import { getDb } from "./db.js";
import { sendHouseholdCodeEmail } from "./email.js";
import { REQUESTS_PER_IP_PER_HOUR, START_MIN_MS } from "./household-config.js";
import { householdHandlers, type HouseholdHandlers } from "./household-http.js";
import { loadSigner, type Signer } from "./household-record.js";
import { paddleCompletedTransactionIds } from "./paddle-lookup.js";

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

export function productionHandlers(): HouseholdHandlers {
  return householdHandlers({
    env: () => process.env,
    build: (settings) => ({
      household: {
        db: getDb(),
        now: () => new Date(),
        settings,
        signer: signerFromEnv,
        sendCode: sendHouseholdCodeEmail,
        paddleTransactionIds: (email) => paddleCompletedTransactionIds(process.env.PADDLE_API_KEY, email),
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      startMinMs: START_MIN_MS,
      perIpLimit: REQUESTS_PER_IP_PER_HOUR,
    }),
  });
}
