import type { Client } from "@libsql/client";
import type { SendCode, SendConfirmation } from "./household.js";
import {
  countMail,
  dailyMailAlert,
  failureClass,
  MailError,
  processOutbox,
  purgeMailStats,
  queueMail,
  sendOrQueue,
  sendWithQuickRetry,
  type OutboxResult,
} from "./mail-outbox.js";
import { PRODUCTS, type LicensePlatform, type ProductConfig, type ProductSlug } from "./products.js";

// The senders the endpoints use, wrapped with lib/mail-outbox.ts: each tries again at once on a
// passing failure; a licence key or a confirmation that still fails is kept for the hourly run; a
// code that fails is counted. The function files pass the real senders (lib/email.ts), the
// database and the outbox key (household-prod.ts outboxKeyFromEnv); tests pass fakes.

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** lib/email.ts sendLicenseEmail's shape. */
export type SendKey = (
  to: string,
  licenseKey: string,
  product: ProductConfig,
  opts: { reissue?: boolean; platform?: LicensePlatform | null }
) => Promise<void>;

interface Wiring {
  db: Client;
  /** The outbox key; null when HOUSEHOLD_EMAIL_KEY is not set (a failed mail is then only counted). */
  key: Buffer | null;
  now: () => Date;
  sleep: Sleep;
}

/** A licence-key sender that keeps the mail when it fails: resolves once it is sent or kept. */
export function keySender(o: Wiring & { send: SendKey }): SendKey {
  return async (to, licenseKey, product, opts) => {
    const reissue = opts.reissue ?? false;
    const platform = opts.platform ?? null;
    await sendOrQueue(
      () => o.send(to, licenseKey, product, { reissue, platform }),
      (err) =>
        queueMail(o.db, o.key, o.now(), { kind: "licence_key", product: product.slug, payload: { to, licenseKey, reissue, platform } }, err),
      o.sleep
    );
  };
}

/** A confirmation sender that keeps the mail when it fails (the "plus" of email plus must reach the parent). */
export function confirmationSender(o: Wiring & { send: SendConfirmation }): SendConfirmation {
  return async (to, product, kind, at) => {
    await sendOrQueue(
      () => o.send(to, product, kind, at),
      (err) =>
        queueMail(o.db, o.key, o.now(), { kind: "confirmation", product: product.slug, payload: { to, confirmation: kind, at: at.toISOString() } }, err),
      o.sleep
    );
  };
}

/** A code sender: tries again at once; a code that still fails is counted, never kept (it works for 10 minutes). */
export function codeSender(o: Omit<Wiring, "key"> & { send: SendCode }): SendCode {
  return async (to, code, product, purpose) => {
    try {
      await sendWithQuickRetry(() => o.send(to, code, product, purpose), o.sleep);
    } catch (err) {
      try {
        await countMail(o.db, o.now(), "code", failureClass(err) === "never" ? "rejected" : "dropped");
      } catch {
        /* the count is best effort; the caller logs the failure */
      }
      throw err;
    }
  };
}

const CONFIRMATIONS = new Set(["link", "signin", "remove"]);

/** Builds a kept mail again from its opened payload and sends it. A payload that makes no sense is refused for good. */
export function queuedSender(o: { sendKey: SendKey; sendConfirmation: SendConfirmation }) {
  return async (kind: string, product: string, payload: unknown): Promise<void> => {
    const p = (payload ?? {}) as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(PRODUCTS, product) || typeof p.to !== "string") {
      throw new MailError("validation_error", "a kept mail with no product or address");
    }
    const config = PRODUCTS[product as ProductSlug];
    if (kind === "licence_key" && typeof p.licenseKey === "string") {
      const platform = p.platform === "macos" || p.platform === "windows" ? (p.platform as LicensePlatform) : null;
      await o.sendKey(p.to, p.licenseKey, config, { reissue: p.reissue === true, platform });
      return;
    }
    const at = new Date(String(p.at));
    if (kind === "confirmation" && CONFIRMATIONS.has(String(p.confirmation)) && !Number.isNaN(at.getTime())) {
      await o.sendConfirmation(p.to, config, p.confirmation as "link" | "signin" | "remove", at);
      return;
    }
    throw new MailError("validation_error", "a kept mail that cannot be built again");
  };
}

export interface MailJobDeps extends Wiring {
  sendKey: SendKey;
  sendConfirmation: SendConfirmation;
  sendAlert: (to: string, subject: string, text: string) => Promise<void>;
  alertTo: string;
}

/** The mail part of the hourly run: retries, the daily summary, and the clean-up of old counts. */
export async function runMailJob(o: MailJobDeps): Promise<{ outbox: OutboxResult; alert: string; purged: number }> {
  const outbox = await processOutbox({
    db: o.db,
    now: o.now,
    key: o.key,
    sleep: o.sleep,
    send: queuedSender({ sendKey: o.sendKey, sendConfirmation: o.sendConfirmation }),
  });
  const alert = await dailyMailAlert({
    db: o.db,
    now: o.now,
    send: (subject, text) => sendWithQuickRetry(() => o.sendAlert(o.alertTo, subject, text), o.sleep),
  });
  const purged = await purgeMailStats(o.db, o.now());
  return { outbox, alert, purged };
}
