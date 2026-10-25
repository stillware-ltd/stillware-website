import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { householdSettings } from "../../netlify/functions/lib/household-config.js";
import { verifySignedRecord } from "../../netlify/functions/lib/household-record.js";
import { addLink } from "../../netlify/functions/lib/household-store.js";
import {
  addPaddleLicence,
  addStorePurchase,
  dumpHouseholdTables,
  makeWorld,
  type World,
  type WorldOptions,
  testEmailHash,
} from "./helpers.js";

// signin/start and signin/verify: the code mailed only when a purchase matches, the same answer
// for an unknown address, expiry, single use, five tries, the rate limits and the device cap.

const EMAIL = "parent@example.com";

/** A world where EMAIL is linked to an app user with an Every device store purchase. */
async function owner(opts?: WorldOptions) {
  const w = await makeWorld(opts);
  const lid = await addStorePurchase(w, { appUserId: "u1", purchased: "2026-10-02" });
  await addLink(w.db, "rankup", testEmailHash(EMAIL), "u1");
  return { w, lid };
}

const start = (w: World, email: string = EMAIL, ip?: string) =>
  w.call("signinStart", { product: "rankup", email }, { ip });
const verify = (w: World, code: string, email: string = EMAIL, ip?: string) =>
  w.call("signinVerify", { product: "rankup", email, code, platform: "android" }, { ip });

/** Starts a sign-in and returns the code that was mailed. */
async function signInCode(w: World, email: string = EMAIL): Promise<string> {
  const res = await start(w, email);
  assert.equal(res.status, 200);
  return w.lastCode(email);
}

test("start: a matching purchase gets a 6-digit code by mail, and the answer is {ok:true}", async () => {
  const { w } = await owner();
  const res = await start(w);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].to, EMAIL);
  assert.equal(w.sent[0].purpose, "signin");
  assert.match(w.sent[0].code, /^\d{6}$/);
});

test("start: an unknown address gets the same answer, in content and in padding, and no mail", async () => {
  const { w } = await owner();
  const known = await start(w, EMAIL);
  const unknown = await start(w, "stranger@example.org");
  assert.equal(unknown.status, known.status);
  assert.equal(unknown.text, known.text);
  assert.equal(w.sent.length, 1, "only the address with a purchase was mailed");
  // Both waited: each answer was held back to START_MIN_MS (1500 ms) less the work done.
  assert.equal(w.sleeps.length, 2);
  for (const ms of w.sleeps) assert.ok(ms > 1000 && ms <= 1500, `slept ${ms} ms`);
});

test("start: known and unknown addresses take as long to answer as each other (real sleep)", async () => {
  const { w } = await owner({ startMinMs: 80, realSleep: true });
  const timeIt = async (email: string) => {
    const t0 = Date.now();
    await start(w, email);
    return Date.now() - t0;
  };
  const known = await timeIt(EMAIL);
  const unknown = await timeIt("stranger@example.org");
  assert.ok(known >= 70 && unknown >= 70, `known ${known} ms, unknown ${unknown} ms`);
  assert.ok(Math.abs(known - unknown) < 100, `known ${known} ms, unknown ${unknown} ms`);
});

test("start: a bad request is not padded, a rate-limited one is", async () => {
  const { w } = await owner();
  await w.call("signinStart", { product: "rankup", email: "nope" });
  assert.equal(w.sleeps.length, 0);
  for (let i = 0; i < 6; i++) await start(w);
  assert.equal(w.sleeps.length, 6);
});

test("start: an unknown address leaves a decoy code that is never mailed", async () => {
  const { w } = await owner();
  await start(w, "stranger@example.org");
  assert.equal(w.sent.length, 0);
  const rows = (await dumpHouseholdTables(w.db)).rows.filter((r) => "code_hash" in r);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lid, null);
});

test("verify: the right code returns a signed record that Node's crypto.verify accepts", async () => {
  const { w, lid } = await owner();
  const code = await signInCode(w);
  const res = await verify(w, code);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.record, {
    v: 1, product: "rankup", lid, tier: "every_device", via: "app_store", purchased: "2026-10-02",
    issued: "2026-10-23T09:30:00Z",
  });
  assert.equal(res.body.kid, "rk-test-1");
  assert.equal(verifySignedRecord(res.body, w.key.publicKey), true);
  const bytes = Buffer.from(
    `{"issued":"2026-10-23T09:30:00Z","lid":"${lid}","product":"rankup","purchased":"2026-10-02",` +
      '"tier":"every_device","v":1,"via":"app_store"}'
  );
  assert.equal(crypto.verify(null, bytes, w.key.publicKey, Buffer.from(res.body.sig, "base64url")), true);
  // nothing personal in what leaves the server
  assert.equal(res.text.includes("example.com"), false);
  assert.equal(JSON.stringify(res.body.record).includes("u1"), false); // the app user id (the signature is random text)
});

test("verify: a wrong code says how many tries are left, and the fifth wrong one uses the code up", async () => {
  const { w } = await owner();
  const code = await signInCode(w);
  const wrong = code === "000000" ? "111111" : "000000";
  const seen: unknown[] = [];
  for (let i = 0; i < 5; i++) {
    const res = await verify(w, wrong);
    assert.equal(res.status, 400);
    seen.push(res.body);
  }
  assert.deepEqual(seen, [
    { error: "wrong_code", triesLeft: 4 },
    { error: "wrong_code", triesLeft: 3 },
    { error: "wrong_code", triesLeft: 2 },
    { error: "wrong_code", triesLeft: 1 },
    { error: "too_many_tries" },
  ]);
  // even the right code no longer works, and more tries change nothing
  assert.deepEqual((await verify(w, code)).body, { error: "too_many_tries" });
  assert.deepEqual((await verify(w, wrong)).body, { error: "too_many_tries" });
  // a new code starts afresh
  const fresh = await signInCode(w);
  assert.equal((await verify(w, fresh)).status, 200);
});

test("verify: the right code on the fifth try still works", async () => {
  const { w } = await owner();
  const code = await signInCode(w);
  const wrong = code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 4; i++) await verify(w, wrong);
  assert.equal((await verify(w, code)).status, 200);
});

test("verify: a code works for 10 minutes and not a second longer", async () => {
  const { w } = await owner();
  const code = await signInCode(w);
  w.clock.advance(9 * 60_000 + 59_000);
  assert.equal((await verify(w, code)).status, 200);

  const code2 = await signInCode(w);
  w.clock.advance(10 * 60_000 + 1000);
  const late = await verify(w, code2);
  assert.equal(late.status, 400);
  assert.deepEqual(late.body, { error: "expired" });
  // and a late wrong code is "expired" too, not a try
  assert.deepEqual((await verify(w, "000000")).body, { error: "expired" });
});

test("verify: a code works once; the second use is refused", async () => {
  const { w } = await owner();
  const code = await signInCode(w);
  assert.equal((await verify(w, code)).status, 200);
  const again = await verify(w, code);
  assert.equal(again.status, 400);
  assert.deepEqual(again.body, { error: "expired" });
  const devices = await w.db.execute("SELECT devices FROM household_devices");
  assert.equal(devices.rows[0].devices, 1, "the reuse did not count as a device");
});

test("verify: a newer code replaces the older one", async () => {
  const { w } = await owner();
  const first = await signInCode(w);
  const second = await signInCode(w);
  if (first !== second) {
    assert.equal((await verify(w, first)).body.error, "wrong_code");
  }
  assert.equal((await verify(w, second)).status, 200);
});

test("verify: an address that never asked for a code gets {expired}, known or not", async () => {
  const { w } = await owner();
  const a = await verify(w, "123456", EMAIL);
  const b = await verify(w, "123456", "stranger@example.org");
  assert.equal(a.status, 400);
  assert.equal(b.text, a.text);
  assert.deepEqual(a.body, { error: "expired" });
});

test("verify: an unknown address answers every guess exactly as a known one does", async () => {
  const { w } = await owner();
  await start(w, EMAIL);
  await start(w, "stranger@example.org");
  const known: unknown[] = [];
  const unknown: unknown[] = [];
  for (let i = 0; i < 7; i++) {
    known.push((await verify(w, "000001", EMAIL)).text);
    unknown.push((await verify(w, "000001", "stranger@example.org")).text);
  }
  // (a 1-in-a-million chance that "000001" was the real code is ignored)
  assert.deepEqual(unknown, known);
  assert.equal(JSON.parse(known[0] as string).triesLeft, 4);
  assert.equal(JSON.parse(known[4] as string).error, "too_many_tries");
});

test("verify: the same answer for a known and unknown address once the code has expired", async () => {
  const { w } = await owner();
  await start(w, EMAIL);
  await start(w, "stranger@example.org");
  w.clock.minutes(11);
  assert.equal((await verify(w, "000001", EMAIL)).text, (await verify(w, "000001", "stranger@example.org")).text);
});

test("rate limit: 5 codes an hour per address; the 6th gets {ok:true} and no mail", async () => {
  const { w } = await owner();
  for (let i = 0; i < 5; i++) {
    assert.deepEqual((await start(w)).body, { ok: true });
  }
  assert.equal(w.sent.length, 5);
  const sixth = await start(w);
  assert.equal(sixth.status, 200);
  assert.deepEqual(sixth.body, { ok: true });
  assert.equal(w.sent.length, 5, "no sixth code was sent");
  // a different address is not held back
  await addLink(w.db, "rankup", testEmailHash("other@example.com"), "u1");
  await start(w, "other@example.com");
  assert.equal(w.sent.length, 6);
  // the same address in another spelling is the same address
  await start(w, "  PARENT@Example.com ");
  assert.equal(w.sent.length, 6);
  // an hour later it is allowed again
  w.clock.minutes(61);
  await start(w);
  assert.equal(w.sent.length, 7);
});

test("rate limit: an unknown address is limited the same way, with the same answers", async () => {
  const { w } = await owner();
  const answers: string[] = [];
  for (let i = 0; i < 8; i++) answers.push((await start(w, "stranger@example.org")).text);
  assert.equal(new Set(answers).size, 1);
});

test("rate limit: 20 requests an hour per IP, then 429; another IP and an hour later are fine", async () => {
  const { w } = await owner();
  for (let i = 0; i < 20; i++) {
    const res = await start(w, `nobody${i}@example.org`, "203.0.113.7");
    assert.equal(res.status, 200, `request ${i + 1}`);
  }
  const blocked = await start(w, "nobody99@example.org", "203.0.113.7");
  assert.equal(blocked.status, 429);
  assert.deepEqual(blocked.body, { error: "rate_limited" });
  // verify counts against the same allowance
  assert.equal((await verify(w, "123456", EMAIL, "203.0.113.7")).status, 429);
  // another address of the world is fine
  assert.equal((await start(w, "nobody0@example.org", "203.0.113.8")).status, 200);
  // an hour later the first is fine again
  w.clock.minutes(61);
  assert.equal((await start(w, "nobody0@example.org", "203.0.113.7")).status, 200);
});

test("rate limit: fetch is not under the email-code limits", async () => {
  const w = await makeWorld();
  for (let i = 0; i < 25; i++) {
    const res = await w.call("fetch", { product: "rankup", appUserId: "nobody", platform: "ios" }, { ip: "203.0.113.9" });
    assert.equal(res.status, 404);
  }
});

test("rate limit: the IP is kept hashed, and not in the clear", async () => {
  const { w } = await owner();
  await start(w, EMAIL, "198.51.100.23");
  const { text } = await dumpHouseholdTables(w.db);
  assert.equal(text.includes("198.51.100.23"), false);
});

test("device cap: each successful sign-in counts one device; at the cap, 409 device_cap", async () => {
  const { w } = await owner({ env: { HOUSEHOLD_DEVICE_CAP: "2" } });
  assert.equal((await verify(w, await signInCode(w))).status, 200);
  assert.equal((await verify(w, await signInCode(w))).status, 200);
  const code = await signInCode(w);
  const capped = await verify(w, code);
  assert.equal(capped.status, 409);
  assert.deepEqual(capped.body, { error: "device_cap" });
  // the code that met the cap is used up: no record, no second try
  assert.deepEqual((await verify(w, code)).body, { error: "expired" });
  // another household is unaffected: the cap is per licence
  await addStorePurchase(w, { appUserId: "u2" });
  await addLink(w.db, "rankup", testEmailHash("second@example.com"), "u2");
  assert.equal((await verify(w, await signInCode(w, "second@example.com"), "second@example.com")).status, 200);
});

test("device cap: ten by default, the eleventh is refused", async () => {
  const { w } = await owner();
  for (let i = 0; i < 10; i++) {
    const res = await verify(w, await signInCode(w));
    assert.equal(res.status, 200, `sign-in ${i + 1}`);
    w.clock.minutes(61); // keeps the 5-codes-an-hour limit out of the way
  }
  const res = await verify(w, await signInCode(w));
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: "device_cap" });
});

test("device cap: an unset, zero, negative or odd HOUSEHOLD_DEVICE_CAP means 10", () => {
  for (const v of [undefined, "", "0", "-3", "abc", "2.5", "NaN"]) {
    assert.equal(householdSettings({ HOUSEHOLD_ENABLED: "1", HOUSEHOLD_DEVICE_CAP: v }).deviceCap, 10, String(v));
  }
  assert.equal(householdSettings({ HOUSEHOLD_DEVICE_CAP: "25" }).deviceCap, 25);
});

test("a refunded purchase: no code is mailed, and a code sent before is refused", async () => {
  const { w } = await owner();
  const code = await signInCode(w);
  await w.db.execute("UPDATE household_store_entitlements SET revoked = 1");
  const res = await verify(w, code);
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: "none" });
  const devices = await w.db.execute("SELECT COUNT(*) AS n FROM household_devices");
  assert.equal(devices.rows[0].n, 0, "no device was counted");
  const before = w.sent.length;
  await start(w);
  assert.equal(w.sent.length, before, "no new code for a revoked purchase");
});

test("Paddle: an Every device licence signs in by the address Paddle holds", async () => {
  const w = await makeWorld();
  const lid = await addPaddleLicence(w, { email: "buyer@example.net", tier: "every_device", createdAt: "2026-10-10 12:00:00" });
  const code = await signInCode(w, "buyer@example.net");
  const res = await verify(w, code, "buyer@example.net");
  assert.equal(res.status, 200);
  assert.equal(res.body.record.via, "paddle");
  assert.equal(res.body.record.lid, lid);
  assert.equal(res.body.record.purchased, "2026-10-10");
  assert.equal(verifySignedRecord(res.body, w.key.publicKey), true);
  // the address is never stored on our side
  assert.equal((await dumpHouseholdTables(w.db)).text.includes("buyer@example.net"), false);
});

test("Paddle: an earlier buyer is upgraded free, but only before HOUSEHOLD_UPGRADE_BEFORE", async () => {
  const w = await makeWorld({ env: { HOUSEHOLD_UPGRADE_BEFORE: "2026-10-20" } });
  const old = await addPaddleLicence(w, { email: "old@example.net", createdAt: "2026-10-10 12:00:00", platform: "windows" });
  await addPaddleLicence(w, { email: "new@example.net", createdAt: "2026-10-20 00:00:01" });

  const res = await verify(w, await signInCode(w, "old@example.net"), "old@example.net");
  assert.equal(res.status, 200);
  assert.equal(res.body.record.via, "upgrade");
  assert.equal(res.body.record.lid, old);

  const before = w.sent.length;
  await start(w, "new@example.net");
  assert.equal(w.sent.length, before, "bought on the switch date or later: no free upgrade");
});

test("Paddle: with no upgrade date, an untagged licence is not Every device", async () => {
  const w = await makeWorld();
  await addPaddleLicence(w, { email: "old@example.net", createdAt: "2020-01-01 00:00:00" });
  await start(w, "old@example.net");
  assert.equal(w.sent.length, 0);
  assert.equal(w.paddleCalls.length, 0, "Paddle was not even asked: no licence could qualify");
});

test("Paddle: a revoked Every device licence signs nobody in", async () => {
  const w = await makeWorld();
  await addPaddleLicence(w, { email: "buyer@example.net", tier: "every_device", revoked: 1 });
  await start(w, "buyer@example.net");
  assert.equal(w.sent.length, 0);
});

test("Paddle: an address with no purchase is asked about once, and gets no mail", async () => {
  const w = await makeWorld();
  await addPaddleLicence(w, { email: "buyer@example.net", tier: "every_device" });
  const res = await start(w, "stranger@example.org");
  assert.equal(res.status, 200);
  assert.equal(w.sent.length, 0);
  assert.deepEqual(w.paddleCalls, ["stranger@example.org"]);
});

test("Paddle: an outage gives the usual answer and no mail", async () => {
  const w = await makeWorld();
  await addPaddleLicence(w, { email: "buyer@example.net", tier: "every_device" });
  w.paddleFails.value = true;
  const res = await start(w, "buyer@example.net");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(w.sent.length, 0);
});

test("a mail outage does not change the answer", async () => {
  const { w } = await owner({ failSend: true });
  const res = await start(w);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test("addresses are compared trimmed and lower-cased, and mailed as typed", async () => {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: "u1" });
  await addLink(w.db, "rankup", testEmailHash("Parent@Example.COM "), "u1");
  await start(w, "  parent@example.com");
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].to, "parent@example.com");
  assert.equal((await verify(w, w.sent[0].code, "PARENT@example.com")).status, 200);
});

test("at rest: no address, no code and no secret is kept in the clear", async () => {
  const { w } = await owner();
  const code = await signInCode(w);
  await verify(w, code);
  const { rows, text } = await dumpHouseholdTables(w.db);
  assert.equal(text.includes(EMAIL), false);
  assert.equal(text.toLowerCase().includes("example.com"), false);
  for (const row of rows) for (const v of Object.values(row)) assert.notEqual(v, code);
  const codeRow = rows.find((r) => "code_hash" in r)!;
  assert.match(String(codeRow.code_hash), /^[0-9a-f]{64}$/);
  assert.match(String(codeRow.salt), /^[0-9a-f]{32}$/);
  assert.equal(codeRow.email_hash, testEmailHash(EMAIL));
  // keyed (KL.8): not the plain SHA-256 that anyone could rebuild from a list of addresses
  assert.notEqual(codeRow.email_hash, crypto.createHash("sha256").update(EMAIL).digest("hex"));
  assert.ok(codeRow.closed_at, "the used code is closed");
  // the stored expiry is ten minutes after it was issued
  assert.equal(Date.parse(String(codeRow.expires_at)) - Date.parse(String(codeRow.created_at)), 10 * 60_000);
});

test("two correct sign-ins at the same moment: only one wins", async () => {
  const { w } = await owner();
  const code = await signInCode(w);
  const results = await Promise.all([verify(w, code), verify(w, code), verify(w, code)]);
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => r.body?.error === "expired").length, 2);
});

test("a burst of wrong guesses cannot get past five tries", async () => {
  const { w } = await owner();
  const code = await signInCode(w);
  const wrong = code === "000000" ? "111111" : "000000";
  const results = await Promise.all(Array.from({ length: 12 }, () => verify(w, wrong)));
  assert.equal(results.filter((r) => r.status === 200).length, 0);
  assert.ok(results.filter((r) => r.body.error === "wrong_code").length <= 4);
  const tries = await w.db.execute("SELECT tries FROM household_codes WHERE lid IS NOT NULL");
  assert.equal(tries.rows[0].tries, 5);
  assert.deepEqual((await verify(w, code)).body, { error: "too_many_tries" });
});

test("a missing signing key is a 500 before the code is touched", async () => {
  const { w } = await owner();
  const code = await signInCode(w);
  w.signerFails.value = true;
  const res = await verify(w, code);
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "server_misconfigured" });
  w.signerFails.value = false;
  assert.equal((await verify(w, code)).status, 200, "the code was not used up by the failed attempt");
});
