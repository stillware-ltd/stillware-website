import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Client } from "@libsql/client";
import { hashLicenseKey } from "../../netlify/functions/lib/crypto.js";
import { sendHouseholdConfirmationEmail, sendLicenseEmail } from "../../netlify/functions/lib/email.js";
import {
  ALERT_HOUR_UTC,
  dailyMailAlert,
  ensureMailTables,
  failureClass,
  MailError,
  mailErrorCode,
  OUTBOX_RETENTION_HOURS,
  outboxKey,
  processOutbox,
  purgeMailStats,
  queueMail,
  RETRY_AFTER_MINUTES,
  seal,
  sendWithQuickRetry,
  STATS_RETENTION_DAYS,
  unseal,
} from "../../netlify/functions/lib/mail-outbox.js";
import { codeSender, confirmationSender, keySender, queuedSender, runMailJob } from "../../netlify/functions/lib/mail-prod.js";
import { mintLicence } from "../../netlify/functions/lib/paddle-licence.js";
import { PRODUCTS } from "../../netlify/functions/lib/products.js";
import { Clock, freshDb, SCHEMA_PATH, TEST_EMAIL_KEY } from "./helpers.js";

// Failed mails: the quick retries, the sealed outbox the hourly run retries, the daily counts and
// the summary to the founder. No real mail is sent: senders are fakes, and the two tests of
// lib/email.ts answer Resend's API with a stubbed fetch.

const KEY = outboxKey(TEST_EMAIL_KEY);
const H = 3_600_000;
const noSleep = async () => {};
const ADDRESS = "Parent.Name@example.org";
const WINDOWS = "pri_01knztpnwdqxx8ecnbrjt4zkzq";

const quota = () => new MailError("daily_quota_exceeded");
const limited = () => new MailError("rate_limit_exceeded");
const malformed = () => new MailError("validation_error");

async function stats(db: Client) {
  await ensureMailTables(db);
  const rows = (await db.execute("SELECT kind, outcome, n FROM mail_stats ORDER BY kind, outcome")).rows;
  return Object.fromEntries(rows.map((r) => [`${r.kind}:${r.outcome}`, Number(r.n)]));
}
async function outbox(db: Client) {
  await ensureMailTables(db);
  return (await db.execute("SELECT * FROM mail_outbox ORDER BY created_at")).rows;
}

// ------------------------------------------------------------------------------------- schema

test("schema.sql and the mail tables made on first use are the same", async () => {
  const squash = (s: unknown) => String(s).replace(/\s+/g, " ").trim();
  const mailObjects = async (db: Client) =>
    (await db.execute(
      "SELECT type, name, sql FROM sqlite_master WHERE name LIKE 'mail\\_%' ESCAPE '\\' OR name LIKE 'idx\\_mail\\_%' ESCAPE '\\' OR name LIKE 'sqlite\\_autoindex\\_mail\\_%' ESCAPE '\\' ORDER BY type, name"
    )).rows.map(
      (r) => `${r.type} ${r.name}: ${squash(r.sql)}`
    );
  const fromFile = await freshDb(false);
  await fromFile.executeMultiple(readFileSync(SCHEMA_PATH, "utf8"));
  const onFirstUse = await freshDb(false);
  await ensureMailTables(onFirstUse);
  const a = await mailObjects(fromFile);
  assert.deepEqual(a, await mailObjects(onFirstUse));
  assert.equal(a.filter((x) => x.startsWith("table ")).length, 3);
});

// ------------------------------------------------------------------------------------- sealing

test("sealing: opens with the same key; another key or a changed byte fails; nothing readable", () => {
  const payload = { to: ADDRESS, licenseKey: "ABCD-EF01-2345-6789" };
  const sealed = seal(KEY, payload);
  assert.deepEqual(unseal(KEY, sealed), payload);
  assert.ok(!sealed.includes("example.org") && !sealed.includes("ABCD"));
  assert.notEqual(seal(KEY, payload), sealed, "a fresh nonce every time");
  assert.throws(() => unseal(outboxKey(Buffer.alloc(32, 9)), sealed));
  const raw = Buffer.from(sealed, "base64");
  raw[20] ^= 1;
  assert.throws(() => unseal(KEY, raw.toString("base64")));
  assert.notDeepEqual(KEY, TEST_EMAIL_KEY, "the outbox key is not the hashing key");
});

// ------------------------------------------------------------------------------------- classes and quick retries

test("failure classes: passing failures now, quotas later, a malformed mail never", () => {
  assert.equal(failureClass(limited()), "quick");
  assert.equal(failureClass(new MailError("application_error")), "quick");
  assert.equal(failureClass(new Error("fetch failed")), "quick");
  assert.equal(failureClass(quota()), "later");
  assert.equal(failureClass(new MailError("monthly_quota_exceeded")), "later");
  assert.equal(failureClass(new MailError("invalid_api_key")), "later");
  assert.equal(failureClass(malformed()), "never");
  assert.equal(mailErrorCode(quota()), "daily_quota_exceeded");
  assert.equal(mailErrorCode(new MailError("Has spaces and an@address.com")), "refused");
  assert.equal(mailErrorCode(new TypeError("fetch failed for someone@example.com")), "TypeError");
});

test("quick retries: two more tries for a passing failure, none for a quota", async () => {
  const pauses: number[] = [];
  const sleep = async (ms: number) => void pauses.push(ms);
  let calls = 0;
  await sendWithQuickRetry(async () => {
    if (++calls < 3) throw limited();
  }, sleep);
  assert.equal(calls, 3);
  assert.deepEqual(pauses, [400, 1500]);

  calls = 0;
  await assert.rejects(sendWithQuickRetry(async () => void (calls++, (() => { throw quota(); })()), sleep), /daily_quota/);
  assert.equal(calls, 1);

  calls = 0;
  await assert.rejects(sendWithQuickRetry(async () => void (calls++, (() => { throw limited(); })()), noSleep));
  assert.equal(calls, 3, "gives up after the two retries");
});

// ------------------------------------------------------------------------------------- keeping a failed mail

test("queueMail: kept sealed, counted; no address or key readable in any column", async () => {
  const db = await freshDb();
  const clock = new Clock();
  const out = await queueMail(db, KEY, clock.now(), {
    kind: "licence_key", product: "rankup", payload: { to: ADDRESS, licenseKey: "ABCD-EF01-2345-6789", platform: "windows" },
  }, quota());
  assert.equal(out, "queued");
  const rows = await outbox(db);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.last_error, "daily_quota_exceeded");
  assert.equal(row.attempts, 1);
  assert.equal(row.next_attempt_at, new Date(clock.t + RETRY_AFTER_MINUTES * 60_000).toISOString());
  assert.equal(row.expires_at, new Date(clock.t + OUTBOX_RETENTION_HOURS * H).toISOString());
  for (const value of Object.values(row)) {
    assert.ok(!String(value).toLowerCase().includes("example.org") && !String(value).includes("ABCD-EF01"));
  }
  assert.deepEqual(await stats(db), { "licence_key:queued": 1 });
});

test("queueMail: a malformed mail is rejected and a missing key drops it; neither is kept", async () => {
  const db = await freshDb();
  const now = new Date();
  assert.equal(await queueMail(db, KEY, now, { kind: "confirmation", product: "rankup", payload: { to: "x" } }, malformed()), "rejected");
  assert.equal(await queueMail(db, null, now, { kind: "confirmation", product: "rankup", payload: { to: ADDRESS } }, quota()), "dropped");
  assert.equal((await outbox(db)).length, 0);
  assert.deepEqual(await stats(db), { "confirmation:dropped": 1, "confirmation:rejected": 1 });
});

// ------------------------------------------------------------------------------------- the senders the endpoints use

test("a desktop purchase whose key mail fails still gets that key, from the hourly run", async () => {
  const db = await freshDb();
  const clock = new Clock();
  let failing = true;
  const delivered: Array<{ to: string; key: string; platform: string | null; reissue: boolean }> = [];
  const realSend = async (to: string, key: string, _p: unknown, opts: { reissue?: boolean; platform?: "windows" | "macos" | null }) => {
    if (failing) throw quota();
    delivered.push({ to, key, platform: opts.platform ?? null, reissue: opts.reissue ?? false });
  };
  const sendKey = keySender({ db, key: KEY, now: clock.now, sleep: noSleep, send: realSend });

  const out = await mintLicence(
    { db, deviceCap: 10, sendKey },
    { transactionId: "txn_mail_1", items: [{ price: { id: WINDOWS } }], product: PRODUCTS.rankup, customerEmail: ADDRESS }
  );
  assert.equal(out, "minted", "the licence is made whether or not the mail went");
  assert.equal((await outbox(db)).length, 1);

  failing = false;
  clock.advance(RETRY_AFTER_MINUTES * 60_000);
  const run = await processOutbox({
    db, now: clock.now, key: KEY, sleep: noSleep,
    send: queuedSender({ sendKey: realSend, sendConfirmation: async () => {} }),
  });
  assert.deepEqual({ sent: run.sent, pending: run.pending }, { sent: 1, pending: 0 });
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].to, ADDRESS);
  assert.equal(delivered[0].platform, "windows");
  assert.equal(delivered[0].reissue, false);
  const lic = (await db.execute("SELECT key_hash FROM licenses WHERE paddle_txn_id = 'txn_mail_1'")).rows[0];
  assert.equal(hashLicenseKey(delivered[0].key), lic.key_hash, "the key delivered later is the licence's key");
  assert.deepEqual(await stats(db), { "licence_key:queued": 1, "licence_key:retried_ok": 1 });
});

test("a key mail that goes at the second quick try is not kept or counted", async () => {
  const db = await freshDb();
  let calls = 0;
  const sendKey = keySender({
    db, key: KEY, now: () => new Date(), sleep: noSleep,
    send: async () => {
      if (++calls === 1) throw limited();
    },
  });
  await sendKey(ADDRESS, "K", PRODUCTS.rankup, { platform: null });
  assert.equal(calls, 2);
  assert.equal((await outbox(db)).length, 0);
  assert.deepEqual(await stats(db), {});
});

test("a key mail that cannot be kept still throws, so the caller logs it as before", async () => {
  const db = await freshDb();
  const sendKey = keySender({ db, key: null, now: () => new Date(), sleep: noSleep, send: async () => { throw quota(); } });
  await assert.rejects(sendKey(ADDRESS, "K", PRODUCTS.rankup, { platform: null }), /daily_quota/);
  assert.deepEqual(await stats(db), { "licence_key:dropped": 1 });
});

test("a confirmation that fails is kept and later sent with its kind and its original date", async () => {
  const db = await freshDb();
  const clock = new Clock("2026-10-28T10:00:00Z");
  const at = clock.now();
  const sendConfirmation = confirmationSender({ db, key: KEY, now: clock.now, sleep: noSleep, send: async () => { throw quota(); } });
  await sendConfirmation(ADDRESS, PRODUCTS.rankup, "link", at); // resolves: it is kept
  const got: Array<{ to: string; kind: string; at: string }> = [];
  clock.advance(H);
  await processOutbox({
    db, now: clock.now, key: KEY, sleep: noSleep,
    send: queuedSender({
      sendKey: async () => {},
      sendConfirmation: async (to, _p, kind, when) => void got.push({ to, kind, at: when.toISOString() }),
    }),
  });
  assert.deepEqual(got, [{ to: ADDRESS, kind: "link", at: at.toISOString() }]);
});

test("a code that fails is counted and never kept (it works for 10 minutes)", async () => {
  const db = await freshDb();
  const send = codeSender({ db, now: () => new Date(), sleep: noSleep, send: async () => { throw quota(); } });
  await assert.rejects(send(ADDRESS, "123456", PRODUCTS.rankup, "signin"));
  const bad = codeSender({ db, now: () => new Date(), sleep: noSleep, send: async () => { throw malformed(); } });
  await assert.rejects(bad("not-an-address", "123456", PRODUCTS.rankup, "link"));
  assert.equal((await outbox(db)).length, 0);
  assert.deepEqual(await stats(db), { "code:dropped": 1, "code:rejected": 1 });
});

// ------------------------------------------------------------------------------------- the hourly run

async function keep(db: Client, now: Date, payload: Record<string, unknown> = { to: ADDRESS, licenseKey: "K" }) {
  await queueMail(db, KEY, now, { kind: "licence_key", product: "rankup", payload }, quota());
}

test("hourly run: not yet due stays; still failing moves on; refused for good goes; 24 hours old gives up", async () => {
  const db = await freshDb();
  const clock = new Clock();
  await keep(db, clock.now()); // A: will be due and still failing
  clock.advance(30 * 60_000);
  await keep(db, clock.now()); // B: will not be due yet
  clock.advance(30 * 60_000);
  const run = await processOutbox({ db, now: clock.now, key: KEY, sleep: noSleep, send: async () => { throw quota(); } });
  assert.deepEqual({ sent: run.sent, failed: run.failed, pending: run.pending }, { sent: 0, failed: 1, pending: 2 });
  const [a, b] = await outbox(db);
  assert.equal(a.attempts, 2);
  assert.equal(a.next_attempt_at, new Date(clock.t + RETRY_AFTER_MINUTES * 60_000).toISOString());
  assert.equal(b.attempts, 1, "B was not due");

  clock.advance(H);
  const refused = await processOutbox({ db, now: clock.now, key: KEY, sleep: noSleep, send: async () => { throw malformed(); } });
  assert.equal(refused.rejected, 2);
  assert.equal(refused.pending, 0);

  await keep(db, clock.now());
  clock.advance(OUTBOX_RETENTION_HOURS * H);
  const late = await processOutbox({ db, now: clock.now, key: KEY, sleep: noSleep, send: async () => assert.fail("not tried") });
  assert.equal(late.gaveUp, 1);
  assert.deepEqual(await stats(db), { "licence_key:gave_up": 1, "licence_key:queued": 3, "licence_key:rejected": 2 });
});

test("hourly run: without the key nothing is opened or tried, but old mails still go", async () => {
  const db = await freshDb();
  const clock = new Clock();
  await keep(db, clock.now());
  clock.advance(H);
  const run = await processOutbox({ db, now: clock.now, key: null, sleep: noSleep, send: async () => assert.fail("not tried") });
  assert.equal(run.pending, 1);
  clock.advance(OUTBOX_RETENTION_HOURS * H);
  assert.equal((await processOutbox({ db, now: clock.now, key: null, sleep: noSleep, send: async () => {} })).gaveUp, 1);
});

test("hourly run: a mail sealed under an old key is dropped; the time budget stops the run", async () => {
  const db = await freshDb();
  const clock = new Clock();
  await queueMail(db, outboxKey(Buffer.alloc(32, 3)), clock.now(), { kind: "licence_key", product: "rankup", payload: { to: ADDRESS } }, quota());
  clock.advance(H);
  const run = await processOutbox({ db, now: clock.now, key: KEY, sleep: noSleep, send: async () => {} });
  assert.equal(run.pending, 0);
  assert.equal((await stats(db))["licence_key:dropped"], 1);

  for (let i = 0; i < 3; i++) await keep(db, clock.now());
  clock.advance(H);
  let t = 0;
  let tried = 0;
  const budgeted = await processOutbox({
    db, now: clock.now, key: KEY, sleep: noSleep, budgetMs: 1000, elapsed: () => t,
    send: async () => {
      tried++;
      t += 600;
    },
  });
  assert.equal(tried, 2, "the third is not started after the budget is spent");
  assert.equal(budgeted.pending, 1);
});

// ------------------------------------------------------------------------------------- the daily summary

test("daily summary: once a day from 07:00 UTC, about the day before, only when something failed", async () => {
  const db = await freshDb();
  const clock = new Clock("2026-10-28T15:00:00Z");
  await keep(db, clock.now());
  await queueMail(db, null, clock.now(), { kind: "confirmation", product: "rankup", payload: {} }, quota());

  const sent: Array<{ subject: string; text: string }> = [];
  const send = async (subject: string, text: string) => void sent.push({ subject, text });

  clock.t = Date.parse(`2026-10-29T0${ALERT_HOUR_UTC - 1}:17:00Z`);
  assert.equal(await dailyMailAlert({ db, now: clock.now, send }), "not_yet");

  clock.t = Date.parse(`2026-10-29T0${ALERT_HOUR_UTC}:17:00Z`);
  let failing = true;
  const flaky = async (subject: string, text: string) => {
    if (failing) throw quota();
    await send(subject, text);
  };
  assert.equal(await dailyMailAlert({ db, now: clock.now, send: flaky }), "failed");
  failing = false;
  clock.advance(H);
  assert.equal(await dailyMailAlert({ db, now: clock.now, send: flaky }), "sent", "tried again the next hour");
  assert.equal(await dailyMailAlert({ db, now: clock.now, send }), "done");
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /2 emails failed on 2026-10-28/);
  assert.match(sent[0].text, /licence_key: queued 1/);
  assert.match(sent[0].text, /confirmation: dropped 1/);
  assert.match(sent[0].text, /Still waiting to be retried now: 1 \(licence_key daily_quota_exceeded: 1\)/);
  assert.ok(!sent[0].text.includes("example.org"));

  const clean = await freshDb();
  assert.equal(await dailyMailAlert({ db: clean, now: clock.now, send: async () => assert.fail("nothing to report") }), "none");
});

test("old counts and alert rows go after 90 days", async () => {
  const db = await freshDb();
  const clock = new Clock("2026-01-01T12:00:00Z");
  await keep(db, clock.now());
  clock.advance((STATS_RETENTION_DAYS - 1) * 24 * H);
  assert.equal(await purgeMailStats(db, clock.now()), 0);
  clock.advance(2 * 24 * H);
  assert.equal(await purgeMailStats(db, clock.now()), 1);
});

test("runMailJob: retries, then the summary to the alert address", async () => {
  const db = await freshDb();
  const clock = new Clock("2026-10-28T20:00:00Z");
  await keep(db, clock.now());
  clock.t = Date.parse("2026-10-29T07:17:00Z");
  const alerts: string[] = [];
  const job = await runMailJob({
    db, key: KEY, now: clock.now, sleep: noSleep,
    sendKey: async () => {},
    sendConfirmation: async () => {},
    sendAlert: async (to) => void alerts.push(to),
    alertTo: "founder@example.com",
  });
  assert.equal(job.outbox.sent, 1);
  assert.equal(job.alert, "sent");
  assert.deepEqual(alerts, ["founder@example.com"]);
});

// ------------------------------------------------------------------------------------- lib/email.ts against Resend's answer

test("a refused mail throws a MailError with Resend's error name (the key mail used to ignore it)", async () => {
  const realFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "re_test_not_a_real_key";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ statusCode: 429, name: "daily_quota_exceeded", message: "You have reached your daily email sending quota." }), {
      status: 429,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    await assert.rejects(
      sendLicenseEmail(ADDRESS, "ABCD-EF01", PRODUCTS.rankup, { platform: "windows" }),
      (err: unknown) => err instanceof MailError && err.code === "daily_quota_exceeded"
    );
    await assert.rejects(
      sendHouseholdConfirmationEmail(ADDRESS, PRODUCTS.rankup, "link", new Date()),
      (err: unknown) => err instanceof MailError && failureClass(err) === "later"
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
