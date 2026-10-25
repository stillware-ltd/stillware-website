import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifySignedRecord } from "../../netlify/functions/lib/household-record.js";
import type { HouseholdHandlers } from "../../netlify/functions/lib/household-http.js";
import { addStorePurchase, dumpHouseholdTables, makeWorld } from "./helpers.js";

// Each of the seven endpoints (contract §5; the remove pair is KL.8): valid input, invalid input, the flag off, a wrong
// product. The sign-in and link flows have their own files.

const NAMES: Array<keyof HouseholdHandlers> = [
  "fetch", "signinStart", "signinVerify", "linkStart", "linkVerify", "removeStart", "removeVerify",
];

const VALID: Record<keyof HouseholdHandlers, object> = {
  fetch: { product: "rankup", appUserId: "$RCAnonymousID:abc", platform: "android" },
  signinStart: { product: "rankup", email: "parent@example.com" },
  signinVerify: { product: "rankup", email: "parent@example.com", code: "123456", platform: "ios" },
  linkStart: { product: "rankup", appUserId: "$RCAnonymousID:abc", email: "parent@example.com" },
  linkVerify: { product: "rankup", appUserId: "$RCAnonymousID:abc", email: "parent@example.com", code: "123456" },
  removeStart: { product: "rankup", email: "parent@example.com" },
  removeVerify: { product: "rankup", email: "parent@example.com", code: "123456" },
};

test("the flag off: every endpoint answers 404 {error:off}, whatever it is sent", async () => {
  for (const flag of [undefined, "", "0", "true", "yes", "2", " 1"]) {
    const w = await makeWorld({ env: { HOUSEHOLD_ENABLED: flag } });
    for (const name of NAMES) {
      const res = await w.call(name, VALID[name]);
      assert.equal(res.status, 404, `${name} with flag ${JSON.stringify(flag)}`);
      assert.deepEqual(res.body, { error: "off" });
      // not even a wrong method, a bad body or a wrong product shows a difference
      assert.deepEqual((await w.call(name, null, { method: "GET" })).body, { error: "off" });
      assert.deepEqual((await w.call(name, null, { raw: "{not json" })).body, { error: "off" });
      assert.deepEqual((await w.call(name, { product: "zeroed" })).body, { error: "off" });
    }
    // nothing was written, no mail was sent, nobody was asked anything
    assert.equal(w.sent.length, 0);
    assert.equal(w.paddleCalls.length, 0);
    assert.equal((await dumpHouseholdTables(w.db)).rows.length, 0, "nothing is written while the flag is off");
  }
});

test("no hashing key (HOUSEHOLD_EMAIL_KEY unset or short): every endpoint is a 500 server_misconfigured", async () => {
  // KL.8: without the key nothing could be hashed, looked up or limited safely, so nothing runs.
  const w = await makeWorld({ emailKey: null });
  for (const name of NAMES) {
    const res = await w.call(name, VALID[name]);
    assert.equal(res.status, 500, name);
    assert.deepEqual(res.body, { error: "server_misconfigured" });
  }
  assert.equal(w.sent.length, 0);
  assert.equal(w.paddleCalls.length, 0);
  assert.equal((await dumpHouseholdTables(w.db)).rows.length, 0, "nothing is written without the key");
});

test("the flag is exactly the string 1", async () => {
  const w = await makeWorld({ env: { HOUSEHOLD_ENABLED: "1" } });
  assert.equal((await w.call("signinStart", VALID.signinStart)).status, 200);
});

test("a wrong or missing product: 400 unknown_product", async () => {
  const w = await makeWorld();
  for (const name of NAMES) {
    for (const product of ["zeroed", "chess", "RankUp", "", 7, null, undefined, ["rankup"]]) {
      const res = await w.call(name, { ...VALID[name], product });
      assert.equal(res.status, 400, `${name} product ${JSON.stringify(product)}`);
      assert.deepEqual(res.body, { error: "unknown_product" });
    }
  }
  assert.equal(w.sent.length, 0);
});

test("bad JSON, a non-object body, an oversized body: 400 bad_request", async () => {
  const w = await makeWorld();
  for (const name of NAMES) {
    for (const raw of ["", "{not json", "[]", "null", "42", '"rankup"']) {
      const res = await w.call(name, null, { raw });
      assert.equal(res.status, 400, `${name} ${raw}`);
      assert.deepEqual(res.body, { error: "bad_request" });
    }
    const big = await w.call(name, { ...VALID[name], pad: "x".repeat(9000) });
    assert.equal(big.status, 400);
  }
});

test("any method but POST: 405 (when the flag is on)", async () => {
  const w = await makeWorld();
  for (const name of NAMES) {
    for (const method of ["GET", "PUT", "DELETE"]) {
      const res = await w.call(name, null, { method });
      assert.equal(res.status, 405, `${name} ${method}`);
    }
  }
});

test("answers are JSON and are not cached", async () => {
  const w = await makeWorld();
  const req = new Request("https://www.stillwareltd.com/x", { method: "POST", body: JSON.stringify(VALID.signinStart) });
  const res = await w.handlers.signinStart(req);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("fetch: the record for an app user id with an Every device purchase", async () => {
  const w = await makeWorld();
  const lid = await addStorePurchase(w, { appUserId: "$RCAnonymousID:abc", purchased: "2026-10-02", via: "play" });
  const res = await w.call("fetch", VALID.fetch);
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ["kid", "record", "sig"]);
  assert.deepEqual(res.body.record, {
    v: 1, product: "rankup", lid, tier: "every_device", via: "play", purchased: "2026-10-02",
    issued: "2026-10-23T09:30:00Z",
  });
  assert.equal(res.body.kid, "rk-test-1");
  assert.equal(verifySignedRecord(res.body, w.key.publicKey), true);
  // Node's own verify over the bytes it should have signed
  const text =
    `{"issued":"2026-10-23T09:30:00Z","lid":"${lid}","product":"rankup","purchased":"2026-10-02",` +
    '"tier":"every_device","v":1,"via":"play"}';
  assert.equal(
    crypto.verify(null, Buffer.from(text), w.key.publicKey, Buffer.from(res.body.sig, "base64url")),
    true
  );
});

test("fetch: the same household gets the same record again, even later", async () => {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: "u1" });
  const first = await w.call("fetch", { ...VALID.fetch, appUserId: "u1" });
  w.clock.minutes(90);
  const second = await w.call("fetch", { ...VALID.fetch, appUserId: "u1" });
  assert.deepEqual(second.body, first.body);
  const rows = await w.db.execute("SELECT COUNT(*) AS n FROM household_issued");
  assert.equal(rows.rows[0].n, 1);
});

test("fetch: 404 none for an unknown app user id, and for a revoked purchase", async () => {
  const w = await makeWorld();
  assert.deepEqual((await w.call("fetch", VALID.fetch)).body, { error: "none" });
  assert.equal((await w.call("fetch", VALID.fetch)).status, 404);

  await addStorePurchase(w, { appUserId: "$RCAnonymousID:abc" });
  assert.equal((await w.call("fetch", VALID.fetch)).status, 200);
  await w.db.execute("UPDATE household_store_entitlements SET revoked = 1");
  assert.equal((await w.call("fetch", VALID.fetch)).status, 404);
});

test("fetch: an Every device purchase belongs to its own app user id only", async () => {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: "owner" });
  assert.equal((await w.call("fetch", { ...VALID.fetch, appUserId: "someone-else" })).status, 404);
  assert.equal((await w.call("fetch", { ...VALID.fetch, appUserId: "OWNER" })).status, 404);
  assert.equal((await w.call("fetch", { ...VALID.fetch, appUserId: "owner" })).status, 200);
});

test("fetch: invalid fields are 400 bad_request", async () => {
  const w = await makeWorld();
  for (const bad of [
    { appUserId: "" }, { appUserId: 5 }, { appUserId: "x".repeat(201) }, { appUserId: "a\nb" }, { appUserId: undefined },
    { platform: undefined }, { platform: "" }, { platform: "Android phone!" }, { platform: 3 }, { platform: "x".repeat(25) },
  ]) {
    const res = await w.call("fetch", { ...VALID.fetch, ...bad });
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.deepEqual(res.body, { error: "bad_request" });
  }
  // a normal platform name in any case is accepted
  await addStorePurchase(w, { appUserId: "$RCAnonymousID:abc" });
  for (const platform of ["android", "ios", "macos", "windows", "linux", "iOS"]) {
    assert.equal((await w.call("fetch", { ...VALID.fetch, platform })).status, 200, platform);
  }
});

test("fetch: a signing key that is not set is a 500 that says nothing, not a crash", async () => {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: "$RCAnonymousID:abc" });
  w.signerFails.value = true;
  const res = await w.call("fetch", VALID.fetch);
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "server_misconfigured" });
  w.signerFails.value = false;
  assert.equal((await w.call("fetch", VALID.fetch)).status, 200);
});

test("signin/start: a bad address is 400 bad_email; a good one is 200 {ok:true}", async () => {
  const w = await makeWorld();
  for (const email of ["", "nope", "a@b", "a b@c.de", "@x.yz", 5, null, undefined, "a@b.cd".padEnd(260, "x")]) {
    const res = await w.call("signinStart", { product: "rankup", email });
    assert.equal(res.status, 400, JSON.stringify(email));
    assert.deepEqual(res.body, { error: "bad_email" });
  }
  const ok = await w.call("signinStart", VALID.signinStart);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true });
});

test("signin/verify: a bad address, code or platform is 400", async () => {
  const w = await makeWorld();
  const base = VALID.signinVerify as Record<string, unknown>;
  assert.deepEqual((await w.call("signinVerify", { ...base, email: "nope" })).body, { error: "bad_email" });
  for (const bad of [{ code: "" }, { code: 123456 }, { code: undefined }, { code: "1".repeat(17) }, { platform: undefined }, { platform: "$" }]) {
    const res = await w.call("signinVerify", { ...base, ...bad });
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.deepEqual(res.body, { error: "bad_request" });
  }
});

test("link/start and link/verify: bad fields are 400; good ones are 200", async () => {
  const w = await makeWorld();
  const start = VALID.linkStart as Record<string, unknown>;
  assert.deepEqual((await w.call("linkStart", { ...start, appUserId: "" })).body, { error: "bad_request" });
  assert.deepEqual((await w.call("linkStart", { ...start, email: "x" })).body, { error: "bad_email" });
  const ok = await w.call("linkStart", start);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true });

  const verify = VALID.linkVerify as Record<string, unknown>;
  assert.deepEqual((await w.call("linkVerify", { ...verify, appUserId: undefined })).body, { error: "bad_request" });
  assert.deepEqual((await w.call("linkVerify", { ...verify, email: "x" })).body, { error: "bad_email" });
  assert.deepEqual((await w.call("linkVerify", { ...verify, code: "" })).body, { error: "bad_request" });
});
