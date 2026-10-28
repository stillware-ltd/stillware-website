import crypto from "node:crypto";
import type { Client } from "@libsql/client";

// What happens when a mail does not go (Resend over its limit, slow or down). Until now a refused
// mail was logged and forgotten: a desktop buyer got no key, a parent no confirmation, and nobody
// knew. Now:
//  1. every send is tried again at once, twice, when the failure is the passing kind (Resend's rate
//     limit, a server error, the network): sendWithQuickRetry;
//  2. a licence-key mail or a confirmation that still fails is kept in `mail_outbox`, sealed with
//     AES-256-GCM under a key derived from HOUSEHOLD_EMAIL_KEY, and the hourly run tries it again
//     until it goes or OUTBOX_RETENTION_HOURS pass: queueMail, processOutbox. Nothing in the table
//     is readable without the key: not the address, not the licence key. A code mail is never kept:
//     its code works for 10 minutes, so a parent asks for a new one instead;
//  3. every failure is counted per day in `mail_stats` (kind and outcome, no address, no content),
//     and the hourly run mails a summary once a day when the day before had any: dailyMailAlert.
// The hourly run is netlify/functions/household-purge.ts; the real senders are in lib/mail-prod.ts.

/** How long a failed mail is kept for retries. The hourly run deletes it then, so it is gone within 25 hours. */
export const OUTBOX_RETENTION_HOURS = 24;
/** A kept mail is tried again at the next hourly run (it runs every 60 minutes). */
export const RETRY_AFTER_MINUTES = 55;
/** The pauses between the immediate tries of one send. Two retries keep a request under 3 seconds. */
export const QUICK_RETRY_DELAYS_MS: readonly number[] = [400, 1500];
/** At most this many kept mails are tried in one run... */
export const OUTBOX_BATCH = 100;
/** ...and none is started after this long, so the run ends well inside a scheduled function's 30 seconds. */
export const OUTBOX_TIME_BUDGET_MS = 20_000;
/** The daily summary goes at the first hourly run at or after this hour (UTC), about the day before. */
export const ALERT_HOUR_UTC = 7;
/** Daily counts and alert rows are kept this long. */
export const STATS_RETENTION_DAYS = 90;

/** What a mail is: a desktop licence key, a household confirmation or a household code. */
export type MailKind = "licence_key" | "confirmation" | "code";
/**
 * What happened to a mail that did not go at first:
 * queued (kept for retries), dropped (could not be kept: a code, or no key to seal it with),
 * rejected (Resend refused it for good, such as a malformed address), retried_ok (a retry sent it),
 * gave_up (still not sent after OUTBOX_RETENTION_HOURS).
 */
export type MailOutcome = "queued" | "dropped" | "rejected" | "retried_ok" | "gave_up";
/** The outcomes that count as a failure in the daily summary. */
export const FAILURE_OUTCOMES: readonly MailOutcome[] = ["queued", "dropped", "rejected", "gave_up"];

/** A mail the provider refused, with the provider's error name (Resend's `error.name`). */
export class MailError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? `the mail was refused: ${code}`);
    this.name = "MailError";
    this.code = code;
  }
}

/** Refused for good: trying again would get the same answer. */
const NEVER = new Set(["validation_error", "missing_required_field", "invalid_parameter", "invalid_attachment"]);
/** Gone in a second or two: worth trying again at once. */
const QUICK = new Set(["rate_limit_exceeded", "application_error", "internal_server_error"]);

/**
 * How to treat a failed send: "quick" (try again now), "later" (keep it for the hourly run: a
 * daily or monthly quota, a key or domain problem being fixed) or "never". A throw that is not a
 * MailError is the network or a timeout, so it is "quick".
 */
export function failureClass(err: unknown): "quick" | "later" | "never" {
  if (!(err instanceof MailError)) return "quick";
  if (NEVER.has(err.code)) return "never";
  if (QUICK.has(err.code)) return "quick";
  return "later";
}

/** A failure as a short code for logs and the table: the provider's error name, never its message (it can quote the address). */
export function mailErrorCode(err: unknown): string {
  if (err instanceof MailError) return /^[a-z_]{1,40}$/.test(err.code) ? err.code : "refused";
  const name = (err as { name?: unknown } | null)?.name;
  return typeof name === "string" && /^[A-Za-z]{1,40}$/.test(name) ? name : "error";
}

/** Sends, and tries again after each of `delays` while the failure is the passing kind. Throws the last failure. */
export async function sendWithQuickRetry(
  send: () => Promise<void>,
  sleep: (ms: number) => Promise<void>,
  delays: readonly number[] = QUICK_RETRY_DELAYS_MS
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await send();
      return;
    } catch (err) {
      if (failureClass(err) !== "quick" || attempt >= delays.length) throw err;
      await sleep(delays[attempt]);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Sealing. The outbox key is derived from HOUSEHOLD_EMAIL_KEY with HKDF under its own label, so
// it is never the key the address hashes are made with, and needs no new secret.

const SEAL_LABEL = "stillware-mail-outbox-v1";

/** The key kept mails are sealed with, derived from the hashing key. */
export function outboxKey(emailKey: Buffer): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", emailKey, Buffer.alloc(0), SEAL_LABEL, 32));
}

/** AES-256-GCM: base64 of a 12-byte nonce, the ciphertext and the 16-byte tag. */
export function seal(key: Buffer, payload: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64");
}

/** Opens a sealed payload. Throws if it was sealed under another key or changed. */
export function unseal(key: Buffer, sealed: string): unknown {
  const raw = Buffer.from(sealed, "base64");
  if (raw.length < 29) throw new Error("sealed payload too short");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  const text = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8");
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------------------------
// Tables. Made on first use, like the household's; lib/schema.sql carries the same (a test keeps
// the two in step).

export const MAIL_SCHEMA = `
CREATE TABLE IF NOT EXISTS mail_outbox (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  product         TEXT NOT NULL,
  sealed          TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 1,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  expires_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_outbox_due ON mail_outbox(next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_mail_outbox_expires ON mail_outbox(expires_at);

CREATE TABLE IF NOT EXISTS mail_stats (
  day     TEXT NOT NULL,
  kind    TEXT NOT NULL,
  outcome TEXT NOT NULL,
  n       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, outcome)
);

CREATE TABLE IF NOT EXISTS mail_alerts (
  day     TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL,
  summary TEXT NOT NULL
);
`;

const tablesReady = new WeakSet<Client>();

/** Creates the mail tables if they are not there. Cheap after the first call per client. */
export async function ensureMailTables(db: Client): Promise<void> {
  if (tablesReady.has(db)) return;
  await db.executeMultiple(MAIL_SCHEMA);
  tablesReady.add(db);
}

const dayOf = (at: Date) => at.toISOString().slice(0, 10);
const later = (at: Date, ms: number) => new Date(at.getTime() + ms).toISOString();
const H = 3_600_000;

/** Adds one to today's count of `kind` and `outcome`. */
export async function countMail(db: Client, now: Date, kind: MailKind, outcome: MailOutcome): Promise<void> {
  await ensureMailTables(db);
  await db.execute({
    sql: `INSERT INTO mail_stats (day, kind, outcome, n) VALUES (?, ?, ?, 1)
          ON CONFLICT(day, kind, outcome) DO UPDATE SET n = n + 1`,
    args: [dayOf(now), kind, outcome],
  });
}

export interface FailedMail {
  kind: "licence_key" | "confirmation";
  product: string;
  /** What the sender needs to build the mail again; sealed before it is stored. */
  payload: Record<string, unknown>;
}

/**
 * Keeps a mail that failed after its quick retries, or says why it cannot: "rejected" when Resend
 * refused it for good, "dropped" when there is no key to seal it with. Counts the outcome either way.
 */
export async function queueMail(
  db: Client,
  key: Buffer | null,
  now: Date,
  mail: FailedMail,
  err: unknown
): Promise<"queued" | "dropped" | "rejected"> {
  if (failureClass(err) === "never") {
    await countMail(db, now, mail.kind, "rejected");
    return "rejected";
  }
  if (!key) {
    await countMail(db, now, mail.kind, "dropped");
    return "dropped";
  }
  await ensureMailTables(db);
  await db.execute({
    sql: `INSERT INTO mail_outbox (id, kind, product, sealed, attempts, last_error, created_at, next_attempt_at, expires_at)
          VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    args: [
      crypto.randomBytes(16).toString("hex"),
      mail.kind,
      mail.product,
      seal(key, mail.payload),
      mailErrorCode(err),
      now.toISOString(),
      later(now, RETRY_AFTER_MINUTES * 60_000),
      later(now, OUTBOX_RETENTION_HOURS * H),
    ],
  });
  await countMail(db, now, mail.kind, "queued");
  return "queued";
}

/**
 * Sends with quick retries; if it still fails, keeps the mail with `queue`. Resolves when the mail
 * went or is kept (it will go later); throws the failure when it could not be kept, so the caller
 * logs it as before.
 */
export async function sendOrQueue(
  send: () => Promise<void>,
  queue: (err: unknown) => Promise<"queued" | "dropped" | "rejected">,
  sleep: (ms: number) => Promise<void>
): Promise<"sent" | "queued"> {
  try {
    await sendWithQuickRetry(send, sleep);
    return "sent";
  } catch (err) {
    let kept: "queued" | "dropped" | "rejected" = "dropped";
    try {
      kept = await queue(err);
    } catch (queueErr) {
      console.error(`mail: could not keep a failed mail: ${mailErrorCode(queueErr)}`);
    }
    if (kept === "queued") return "queued";
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// The hourly run.

export interface OutboxDeps {
  db: Client;
  now: () => Date;
  /** The outbox key; null when HOUSEHOLD_EMAIL_KEY is not set (then nothing can be opened, and nothing is tried). */
  key: Buffer | null;
  /** Builds and sends a kept mail. Throws (a MailError when the provider refused it) if it did not go. */
  send: (kind: string, product: string, payload: unknown) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  /** Milliseconds since some fixed point, for the time budget (performance.now in production). */
  elapsed?: () => number;
  batch?: number;
  budgetMs?: number;
}

export interface OutboxResult {
  sent: number;
  failed: number;
  gaveUp: number;
  rejected: number;
  /** Mails still kept after the run. */
  pending: number;
}

/** Tries the kept mails that are due, drops the ones past OUTBOX_RETENTION_HOURS, and counts each outcome. */
export async function processOutbox(deps: OutboxDeps): Promise<OutboxResult> {
  const { db } = deps;
  await ensureMailTables(db);
  const now = deps.now();
  const result: OutboxResult = { sent: 0, failed: 0, gaveUp: 0, rejected: 0, pending: 0 };

  const expired = await db.execute({ sql: "SELECT id, kind FROM mail_outbox WHERE expires_at <= ?", args: [now.toISOString()] });
  for (const row of expired.rows) {
    await db.execute({ sql: "DELETE FROM mail_outbox WHERE id = ?", args: [String(row.id)] });
    await countMail(db, now, String(row.kind) as MailKind, "gave_up");
    result.gaveUp++;
  }

  if (deps.key) {
    const elapsed = deps.elapsed ?? (() => performance.now());
    const started = elapsed();
    const due = await db.execute({
      sql: "SELECT id, kind, product, sealed FROM mail_outbox WHERE next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?",
      args: [now.toISOString(), deps.batch ?? OUTBOX_BATCH],
    });
    for (const row of due.rows) {
      if (elapsed() - started > (deps.budgetMs ?? OUTBOX_TIME_BUDGET_MS)) break;
      const id = String(row.id);
      const kind = String(row.kind) as MailKind;
      let payload: unknown;
      try {
        payload = unseal(deps.key, String(row.sealed));
      } catch {
        // Sealed under a key that has since changed: it can never be opened.
        await db.execute({ sql: "DELETE FROM mail_outbox WHERE id = ?", args: [id] });
        await countMail(db, now, kind, "dropped");
        result.failed++;
        continue;
      }
      try {
        await sendWithQuickRetry(() => deps.send(kind, String(row.product), payload), deps.sleep);
        await db.execute({ sql: "DELETE FROM mail_outbox WHERE id = ?", args: [id] });
        await countMail(db, now, kind, "retried_ok");
        result.sent++;
      } catch (err) {
        if (failureClass(err) === "never") {
          await db.execute({ sql: "DELETE FROM mail_outbox WHERE id = ?", args: [id] });
          await countMail(db, now, kind, "rejected");
          result.rejected++;
        } else {
          await db.execute({
            sql: "UPDATE mail_outbox SET attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE id = ?",
            args: [mailErrorCode(err), later(now, RETRY_AFTER_MINUTES * 60_000), id],
          });
          result.failed++;
        }
      }
    }
  }

  result.pending = Number((await db.execute("SELECT COUNT(*) AS n FROM mail_outbox")).rows[0]?.n ?? 0);
  return result;
}

export interface AlertDeps {
  db: Client;
  now: () => Date;
  /** Sends the summary. Throws if it did not go (then the next hourly run tries again). */
  send: (subject: string, text: string) => Promise<void>;
}

/**
 * Once a day, at the first run from ALERT_HOUR_UTC, mails a summary of the day before when any
 * mail failed or some are still kept. A day with nothing to report is noted and sends nothing.
 * If the summary itself cannot go (Resend is the thing failing), the counts stay in the table and
 * the next hourly run tries again.
 */
export async function dailyMailAlert(deps: AlertDeps): Promise<"not_yet" | "done" | "none" | "sent" | "failed"> {
  const { db } = deps;
  await ensureMailTables(db);
  const now = deps.now();
  if (now.getUTCHours() < ALERT_HOUR_UTC) return "not_yet";
  const today = dayOf(now);
  const already = await db.execute({ sql: "SELECT 1 FROM mail_alerts WHERE day = ?", args: [today] });
  if (already.rows.length > 0) return "done";

  const yesterday = dayOf(new Date(now.getTime() - 24 * H));
  const stats = await db.execute({
    sql: "SELECT kind, outcome, n FROM mail_stats WHERE day = ? ORDER BY kind, outcome",
    args: [yesterday],
  });
  const kept = await db.execute("SELECT kind, last_error, COUNT(*) AS n FROM mail_outbox GROUP BY kind, last_error ORDER BY kind, last_error");
  const failures = stats.rows
    .filter((r) => (FAILURE_OUTCOMES as readonly string[]).includes(String(r.outcome)))
    .reduce((sum, r) => sum + Number(r.n), 0);
  const pending = kept.rows.reduce((sum, r) => sum + Number(r.n), 0);

  if (failures === 0 && pending === 0) {
    await db.execute({ sql: "INSERT INTO mail_alerts (day, sent_at, summary) VALUES (?, ?, 'none')", args: [today, now.toISOString()] });
    return "none";
  }

  const lines = [
    `On ${yesterday} (UTC), ${failures} email${failures === 1 ? "" : "s"} did not go out at the first try.`,
    "",
    "By kind and outcome (yesterday):",
    ...stats.rows.map((r) => `  ${r.kind}: ${r.outcome} ${r.n}`),
    "",
    `Still waiting to be retried now: ${pending}` +
      (pending > 0 ? ` (${kept.rows.map((r) => `${r.kind} ${r.last_error ?? "?"}: ${r.n}`).join(", ")})` : ""),
    "",
    "What the outcomes mean: queued = kept and retried every hour for 24 hours; retried_ok = a retry sent it;",
    "gave_up = still not sent after 24 hours; dropped = could not be kept (a sign-in code, or no key);",
    "rejected = Resend refused it for good (for example a malformed address).",
    "",
    "Errors named daily_quota_exceeded or monthly_quota_exceeded mean the Resend plan is too small:",
    "upgrade it at resend.com. rate_limit_exceeded means too many at once (they are retried).",
    "A buyer whose key mail gave up can get a new key at stillwareltd.com (Lost your key?).",
  ];
  const subject = `Stillware: ${failures} email${failures === 1 ? "" : "s"} failed on ${yesterday}`;
  try {
    await deps.send(subject, lines.join("\n"));
  } catch (err) {
    console.error(`mail: the daily summary could not be sent: ${mailErrorCode(err)}`);
    return "failed";
  }
  await db.execute({
    sql: "INSERT INTO mail_alerts (day, sent_at, summary) VALUES (?, ?, ?)",
    args: [today, now.toISOString(), JSON.stringify({ failures, pending })],
  });
  return "sent";
}

/** Deletes daily counts and alert rows older than STATS_RETENTION_DAYS. */
export async function purgeMailStats(db: Client, now: Date): Promise<number> {
  await ensureMailTables(db);
  const cutoff = dayOf(new Date(now.getTime() - STATS_RETENTION_DAYS * 24 * H));
  const a = await db.execute({ sql: "DELETE FROM mail_stats WHERE day < ?", args: [cutoff] });
  const b = await db.execute({ sql: "DELETE FROM mail_alerts WHERE day < ?", args: [cutoff] });
  return Number(a.rowsAffected) + Number(b.rowsAffected);
}
