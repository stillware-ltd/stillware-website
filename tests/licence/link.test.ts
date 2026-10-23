import test from "node:test";
import assert from "node:assert/strict";
import { verifySignedRecord } from "../../netlify/functions/lib/household-record.js";
import { emailHash } from "../../netlify/functions/lib/household-store.js";
import { addStorePurchase, dumpHouseholdTables, makeWorld, type World } from "./helpers.js";

// link/start and link/verify: a store buyer confirms an address with a code; that address then
// signs in (signin/start and signin/verify).

const EMAIL = "Parent@Example.com";
const USER = "$RCAnonymousID:buyer1";

const linkStart = (w: World, appUserId = USER, email = EMAIL) =>
  w.call("linkStart", { product: "rankup", appUserId, email });
const linkVerify = (w: World, code: string, appUserId = USER, email = EMAIL) =>
  w.call("linkVerify", { product: "rankup", appUserId, email, code });
const signinStart = (w: World, email = EMAIL) => w.call("signinStart", { product: "rankup", email });
const signinVerify = (w: World, code: string, email = EMAIL) =>
  w.call("signinVerify", { product: "rankup", email, code, platform: "ios" });

test("link: the code confirms the address, and the linked address then signs in", async () => {
  const w = await makeWorld();
  const lid = await addStorePurchase(w, { appUserId: USER, purchased: "2026-10-05", via: "play" });

  // before the link, the address matches nothing
  await signinStart(w);
  assert.equal(w.sent.length, 0);

  const start = await linkStart(w);
  assert.equal(start.status, 200);
  assert.deepEqual(start.body, { ok: true });
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].purpose, "link");
  assert.match(w.sent[0].code, /^\d{6}$/);

  const done = await linkVerify(w, w.lastCode(EMAIL));
  assert.equal(done.status, 200);
  assert.deepEqual(done.body, { linked: true });

  // now the same address signs in and gets the household's record
  assert.deepEqual((await signinStart(w)).body, { ok: true });
  assert.equal(w.sent.length, 2);
  assert.equal(w.sent[1].purpose, "signin");
  const res = await signinVerify(w, w.sent[1].code);
  assert.equal(res.status, 200);
  assert.equal(res.body.record.lid, lid);
  assert.equal(res.body.record.via, "play");
  assert.equal(res.body.record.purchased, "2026-10-05");
  assert.equal(verifySignedRecord(res.body, w.key.publicKey), true);
});

test("link: the same record comes back by fetch and by the linked address", async () => {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: USER });
  await linkStart(w);
  await linkVerify(w, w.lastCode(EMAIL));
  await signinStart(w);
  const bySignin = await signinVerify(w, w.sent[1].code);
  const byFetch = await w.call("fetch", { product: "rankup", appUserId: USER, platform: "ios" });
  assert.deepEqual(bySignin.body, byFetch.body);
});

test("link: the address is kept only as a SHA-256 of its normalised form", async () => {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: USER });
  await linkStart(w);
  await linkVerify(w, w.lastCode(EMAIL));
  const { rows, text } = await dumpHouseholdTables(w.db);
  const link = rows.find((r) => "email_hash" in r && !("code_hash" in r))!;
  assert.equal(link.email_hash, emailHash("parent@example.com"));
  assert.match(String(link.email_hash), /^[0-9a-f]{64}$/);
  assert.equal(link.app_user_id, USER);
  assert.equal(text.toLowerCase().includes("example.com"), false);
});

test("link/start: an app user id with no purchase gets {ok:true} and no mail, like one with a purchase", async () => {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: USER });
  const owner = await linkStart(w, USER, "a@example.com");
  const stranger = await linkStart(w, "someone-else", "b@example.com");
  assert.equal(stranger.status, owner.status);
  assert.equal(stranger.text, owner.text);
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].to, "a@example.com");
  assert.equal(w.sleeps.length, 2, "both waited the same");
});

test("link/verify: an app user id with no purchase answers like one that has a wrong code", async () => {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: USER });
  await linkStart(w, USER, "a@example.com");
  await linkStart(w, "someone-else", "b@example.com");
  const real = await linkVerify(w, "000001", USER, "a@example.com");
  const decoy = await linkVerify(w, "000001", "someone-else", "b@example.com");
  assert.equal(real.status, 400);
  assert.equal(decoy.text, real.text);
  assert.equal(real.body.triesLeft, 4);
  // and nothing was linked for the stranger
  assert.equal((await w.db.execute("SELECT COUNT(*) AS n FROM household_email_links")).rows[0].n, 0);
});

test("link/verify: wrong code, five tries, expiry and reuse behave as at sign-in", async () => {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: USER });

  await linkStart(w);
  const code = w.lastCode(EMAIL);
  const wrong = code === "000000" ? "111111" : "000000";
  const bodies = [];
  for (let i = 0; i < 5; i++) bodies.push((await linkVerify(w, wrong)).body);
  assert.deepEqual(bodies, [
    { error: "wrong_code", triesLeft: 4 },
    { error: "wrong_code", triesLeft: 3 },
    { error: "wrong_code", triesLeft: 2 },
    { error: "wrong_code", triesLeft: 1 },
    { error: "too_many_tries" },
  ]);
  assert.deepEqual((await linkVerify(w, code)).body, { error: "too_many_tries" });

  await linkStart(w);
  w.clock.advance(10 * 60_000 + 1000);
  assert.deepEqual((await linkVerify(w, w.lastCode(EMAIL))).body, { error: "expired" });

  await linkStart(w);
  const good = w.lastCode(EMAIL);
  assert.equal((await linkVerify(w, good)).status, 200);
  assert.deepEqual((await linkVerify(w, good)).body, { error: "expired" });
});

test("link/verify: a code is for one app user id, one address and one purpose", async () => {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: USER });
  await addStorePurchase(w, { appUserId: "other-user" });
  await linkStart(w);
  const code = w.lastCode(EMAIL);
  // another app user id has no code outstanding
  assert.deepEqual((await linkVerify(w, code, "other-user")).body, { error: "expired" });
  // another address has none either
  assert.deepEqual((await linkVerify(w, code, USER, "else@example.com")).body, { error: "expired" });
  // a link code is no sign-in code
  assert.deepEqual((await signinVerify(w, code)).body, { error: "expired" });
  assert.equal((await linkVerify(w, code)).status, 200);
});

test("link/verify: a purchase refunded before the code is entered links nothing", async () => {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: USER });
  await linkStart(w);
  await w.db.execute("UPDATE household_store_entitlements SET revoked = 1");
  const res = await linkVerify(w, w.lastCode(EMAIL));
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: "none" });
  assert.equal((await w.db.execute("SELECT COUNT(*) AS n FROM household_email_links")).rows[0].n, 0);
});

test("link/start counts toward the 5 codes an hour per address, shared with sign-in", async () => {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: USER });
  for (let i = 0; i < 3; i++) await linkStart(w);
  await linkVerify(w, w.lastCode(EMAIL));
  for (let i = 0; i < 2; i++) await signinStart(w);
  assert.equal(w.sent.length, 5);
  await linkStart(w);
  assert.equal(w.sent.length, 5, "the sixth code in the hour was not sent");
  assert.deepEqual((await linkStart(w)).body, { ok: true });
});

test("link: linking twice, or from two app user ids, is harmless; both reach the earliest purchase", async () => {
  const w = await makeWorld();
  const first = await addStorePurchase(w, { appUserId: "u1", purchased: "2026-10-01" });
  await addStorePurchase(w, { appUserId: "u2", purchased: "2026-10-09" });
  for (const user of ["u1", "u1", "u2"]) {
    await linkStart(w, user);
    assert.equal((await linkVerify(w, w.lastCode(EMAIL), user)).status, 200);
  }
  assert.equal((await w.db.execute("SELECT COUNT(*) AS n FROM household_email_links")).rows[0].n, 2);
  w.clock.minutes(61);
  await signinStart(w);
  const res = await signinVerify(w, w.lastCode(EMAIL));
  assert.equal(res.body.record.lid, first);
});
