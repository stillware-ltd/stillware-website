import test from "node:test";
import assert from "node:assert/strict";
import { format } from "node:util";
import { NOTICE_VERSION } from "../../netlify/functions/lib/household-config.js";
import { purgeHousehold } from "../../netlify/functions/lib/household-purge.js";
import { addLink } from "../../netlify/functions/lib/household-store.js";
import { addPaddleLicence, addStorePurchase, makeWorld, testEmailHash, type World } from "./helpers.js";

// KL.8, verifiable parental consent by email plus: the confirmation after each successful verify
// (and none otherwise), the record of which notice was agreed to, the retention clock a sign-in
// restarts, the 730-day limit on links, and links dropped when their purchase is refunded.

const EMAIL = "parent@example.com";
const USER = "$RCAnonymousID:buyer1";
const DAY = 86_400_000;

const linkStart = (w: World, email = EMAIL) => w.call("linkStart", { product: "rankup", appUserId: USER, email });
const linkVerify = (w: World, code: string, email = EMAIL) =>
  w.call("linkVerify", { product: "rankup", appUserId: USER, email, code });
const signinStart = (w: World, email = EMAIL) => w.call("signinStart", { product: "rankup", email });
const signinVerify = (w: World, code: string, email = EMAIL) =>
  w.call("signinVerify", { product: "rankup", email, code, platform: "ios" });

async function link(w: World) {
  await linkStart(w);
  const res = await linkVerify(w, w.lastCode(EMAIL));
  assert.deepEqual(res.body, { linked: true });
}

const linkRow = async (w: World) =>
  (await w.db.execute({ sql: "SELECT * FROM household_email_links WHERE email_hash = ?", args: [testEmailHash(EMAIL)] })).rows[0];

test("link: one confirmation after the right code, with the time; the notice agreed to is kept", async () => {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: USER });
  await link(w);
  assert.deepEqual(w.confirmations.map((c) => [c.to, c.kind, c.at.toISOString()]), [[EMAIL, "link", w.clock.now().toISOString()]]);
  const row = await linkRow(w);
  assert.equal(row.notice_version, NOTICE_VERSION);
  assert.equal(String(row.created_at), w.clock.now().toISOString(), "consent time, from the server's clock");
  assert.equal(row.last_used_at, null);
});

test("link: no confirmation for a wrong, expired or decoy code", async () => {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: USER });
  await linkStart(w);
  const code = w.lastCode(EMAIL);
  await linkVerify(w, code === "000000" ? "111111" : "000000");
  w.clock.minutes(11);
  await linkVerify(w, code);
  await w.call("linkStart", { product: "rankup", appUserId: "no-purchase", email: "x@example.com" });
  await w.call("linkVerify", { product: "rankup", appUserId: "no-purchase", email: "x@example.com", code: "123456" });
  assert.equal(w.confirmations.length, 0);
});

test("linking again renews the consent: the newer notice and time replace the old", async () => {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: USER });
  await addLink(w.db, "rankup", testEmailHash(EMAIL), USER, "2020-01-01", new Date("2026-01-01T00:00:00Z"));
  await link(w);
  const row = await linkRow(w);
  assert.equal(row.notice_version, NOTICE_VERSION);
  assert.equal(String(row.created_at), w.clock.now().toISOString());
  const n = (await w.db.execute("SELECT COUNT(*) AS n FROM household_email_links")).rows[0].n;
  assert.equal(Number(n), 1, "still one link");
});

test("sign-in: one confirmation after the record is issued; the link's last use is noted", async () => {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: USER });
  await link(w);
  w.clock.advance(30 * DAY);
  await signinStart(w);
  const res = await signinVerify(w, w.lastCode(EMAIL));
  assert.equal(res.status, 200);
  assert.deepEqual(w.confirmations.map((c) => c.kind), ["link", "signin"]);
  assert.equal(String((await linkRow(w)).last_used_at), w.clock.now().toISOString());
});

test("sign-in through a Paddle purchase confirms too, and stores nothing about the address", async () => {
  const w = await makeWorld();
  await addPaddleLicence(w, { email: EMAIL, tier: "every_device" });
  await signinStart(w);
  assert.equal((await signinVerify(w, w.lastCode(EMAIL))).status, 200);
  assert.deepEqual(w.confirmations.map((c) => c.kind), ["signin"]);
  const n = (await w.db.execute("SELECT COUNT(*) AS n FROM household_email_links")).rows[0].n;
  assert.equal(Number(n), 0);
});

test("sign-in: no confirmation for a wrong code, the device cap, or an address with no purchase", async () => {
  const w = await makeWorld({ env: { HOUSEHOLD_ENABLED: "1", HOUSEHOLD_DEVICE_CAP: "1" } });
  await addStorePurchase(w, { appUserId: USER });
  await link(w);
  w.confirmations.length = 0;
  await signinStart(w);
  const code = w.lastCode(EMAIL);
  await signinVerify(w, code === "000000" ? "111111" : "000000");
  await signinVerify(w, code); // the first device: confirmed
  await signinStart(w);
  const capped = await signinVerify(w, w.lastCode(EMAIL));
  assert.deepEqual(capped.body, { error: "device_cap" });
  await signinStart(w, "stranger@example.org");
  await signinVerify(w, "123456", "stranger@example.org");
  assert.deepEqual(w.confirmations.map((c) => c.kind), ["signin"], "only the one that issued a record");
});

test("a failed confirmation mail changes no answer (link and sign-in)", async () => {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: USER });
  w.mail.failConfirm = true;
  const logged: string[] = [];
  const err = console.error;
  console.error = (...args: unknown[]) => void logged.push(format(...args));
  try {
    await link(w);
    await signinStart(w);
    assert.equal((await signinVerify(w, w.lastCode(EMAIL))).status, 200);
  } finally {
    console.error = err;
  }
  // Logged without the address, though the error quoted it.
  assert.equal(logged.filter((line) => line.includes("could not send a")).length, 2);
  assert.ok(logged.every((line) => !line.toLowerCase().includes(EMAIL.toLowerCase())), logged.join(" | "));
});

test("retention: a link goes 730 days after its last sign-in, or after its linking if never used", async () => {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: "u-used" });
  await addStorePurchase(w, { appUserId: "u-idle" });
  const t0 = w.clock.now();
  await addLink(w.db, "rankup", testEmailHash("used@example.com"), "u-used", NOTICE_VERSION, t0);
  await addLink(w.db, "rankup", testEmailHash("idle@example.com"), "u-idle", NOTICE_VERSION, t0);
  // "used" signs in a year later, which restarts its clock
  await w.db.execute({
    sql: "UPDATE household_email_links SET last_used_at = ? WHERE app_user_id = 'u-used'",
    args: [new Date(t0.getTime() + 365 * DAY).toISOString()],
  });
  const count = async () => Number((await w.db.execute("SELECT COUNT(*) AS n FROM household_email_links")).rows[0].n);

  assert.equal((await purgeHousehold(w.db, new Date(t0.getTime() + 729 * DAY))).links, 0);
  assert.equal(await count(), 2);
  assert.equal((await purgeHousehold(w.db, new Date(t0.getTime() + 731 * DAY))).links, 1, "the idle one went");
  const left = await w.db.execute("SELECT app_user_id FROM household_email_links");
  assert.deepEqual(left.rows.map((r) => r.app_user_id), ["u-used"]);
  assert.equal((await purgeHousehold(w.db, new Date(t0.getTime() + (365 + 731) * DAY))).links, 1, "then the used one");
  assert.equal(await count(), 0);
});

test("retention: links stored with SQLite's own time format are judged by the same clock", async () => {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: "u1" });
  await w.db.execute({
    sql: "INSERT INTO household_email_links (product, email_hash, app_user_id, created_at) VALUES ('rankup', ?, 'u1', ?)",
    args: [testEmailHash(EMAIL), "2024-10-01 12:00:00"],
  });
  assert.equal((await purgeHousehold(w.db, new Date("2026-09-30T12:00:00Z"))).links, 0, "729 days");
  assert.equal((await purgeHousehold(w.db, new Date("2026-10-02T12:00:00Z"))).links, 1, "731 days");
});

test("a refund drops the refunded household's links at once; another household's stay", async () => {
  const w = await makeWorld({ env: { HOUSEHOLD_ENABLED: "1", REVENUECAT_WEBHOOK_AUTH: "Bearer s" } });
  await addStorePurchase(w, { appUserId: "u1", transactionId: "T1" });
  await addStorePurchase(w, { appUserId: "u2", transactionId: "T2" });
  await addLink(w.db, "rankup", testEmailHash(EMAIL), "u1");
  await addLink(w.db, "rankup", testEmailHash("other@example.com"), "u2");
  const { handleRevenueCatWebhook } = await import("../../netlify/functions/lib/revenuecat.js");
  const res = await handleRevenueCatWebhook(
    new Request("https://x/", {
      method: "POST",
      headers: { Authorization: "Bearer s" },
      body: JSON.stringify({ event: { type: "REFUND", transaction_id: "T1" } }),
    }),
    { getDb: () => w.db, now: w.clock.now, env: { REVENUECAT_WEBHOOK_AUTH: "Bearer s" } }
  );
  assert.deepEqual(await res.json(), { ok: true, revoked: 1, unlinked: 1 });
  const left = await w.db.execute("SELECT app_user_id FROM household_email_links");
  assert.deepEqual(left.rows.map((r) => r.app_user_id), ["u2"]);
});

test("a refund of one of two purchases keeps the household's links", async () => {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: "u1", transactionId: "T1" });
  await addStorePurchase(w, { appUserId: "u1", transactionId: "T9" });
  await addLink(w.db, "rankup", testEmailHash(EMAIL), "u1");
  const { handleRevenueCatWebhook } = await import("../../netlify/functions/lib/revenuecat.js");
  const res = await handleRevenueCatWebhook(
    new Request("https://x/", {
      method: "POST",
      headers: { Authorization: "Bearer s" },
      body: JSON.stringify({ event: { type: "REFUND", transaction_id: "T1" } }),
    }),
    { getDb: () => w.db, now: w.clock.now, env: { REVENUECAT_WEBHOOK_AUTH: "Bearer s" } }
  );
  assert.deepEqual(await res.json(), { ok: true, revoked: 1, unlinked: 0 });
});
