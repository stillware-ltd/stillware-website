import test from "node:test";
import assert from "node:assert/strict";
import { addLink } from "../../netlify/functions/lib/household-store.js";
import { addStorePurchase, dumpHouseholdTables, makeWorld, testEmailHash, type World } from "./helpers.js";

// email/remove/start and email/remove/verify (KL.8): a parent takes consent back. A code goes only
// to a linked address; an unlinked one gets a decoy and the same answers; a right code deletes the
// address's links, codes and limits, and a confirmation follows.

const EMAIL = "parent@example.com";

const removeStart = (w: World, email = EMAIL, ip?: string) => w.call("removeStart", { product: "rankup", email }, { ip });
const removeVerify = (w: World, code: string, email = EMAIL) => w.call("removeVerify", { product: "rankup", email, code });

/** A household with EMAIL linked to two app user ids, and another household's address linked too. */
async function linked() {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: "u1" });
  await addStorePurchase(w, { appUserId: "u2" });
  await addStorePurchase(w, { appUserId: "u3" });
  await addLink(w.db, "rankup", testEmailHash(EMAIL), "u1", "2026-11-01");
  await addLink(w.db, "rankup", testEmailHash(EMAIL), "u2", "2026-11-01");
  await addLink(w.db, "rankup", testEmailHash("other@example.com"), "u3", "2026-11-01");
  return w;
}

const linksOf = async (w: World, email: string) =>
  Number(
    (await w.db.execute({ sql: "SELECT COUNT(*) AS n FROM household_email_links WHERE email_hash = ?", args: [testEmailHash(email)] }))
      .rows[0].n
  );

test("remove: a linked address gets a code; the right code deletes every link of it, and a confirmation follows", async () => {
  const w = await linked();
  const start = await removeStart(w);
  assert.equal(start.status, 200);
  assert.deepEqual(start.body, { ok: true });
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].purpose, "remove");

  const done = await removeVerify(w, w.lastCode(EMAIL));
  assert.equal(done.status, 200);
  assert.deepEqual(done.body, { removed: true });
  assert.equal(await linksOf(w, EMAIL), 0, "both links went");
  assert.equal(await linksOf(w, "other@example.com"), 1, "another household's link stays");
  assert.deepEqual(
    w.confirmations.map((c) => [c.to, c.kind]),
    [[EMAIL, "remove"]]
  );
  // its code rows and its rate-limit hits went too: nothing of the address is left
  const left = await w.db.execute({ sql: "SELECT COUNT(*) AS n FROM household_codes WHERE email_hash = ?", args: [testEmailHash(EMAIL)] });
  assert.equal(Number(left.rows[0].n), 0);
  const hits = await w.db.execute({ sql: "SELECT COUNT(*) AS n FROM household_hits WHERE bucket = ?", args: [`email:${testEmailHash(EMAIL)}`] });
  assert.equal(Number(hits.rows[0].n), 0);
});

test("remove: after it, the address no longer signs in; the purchase and every issued record stay", async () => {
  const w = await linked();
  const issued = await w.call("fetch", { product: "rankup", appUserId: "u1", platform: "ios" });
  assert.equal(issued.status, 200);
  await removeStart(w);
  await removeVerify(w, w.lastCode(EMAIL));
  const before = w.sent.length;
  await w.call("signinStart", { product: "rankup", email: EMAIL });
  assert.equal(w.sent.length, before, "no sign-in code: nothing is linked any more");
  assert.equal((await w.call("fetch", { product: "rankup", appUserId: "u1", platform: "ios" })).status, 200, "the purchase stays");
});

test("remove: an unlinked address gets the same answer and a decoy, never a mail, and its codes never work", async () => {
  const w = await linked();
  const known = await removeStart(w, EMAIL);
  const unknown = await removeStart(w, "stranger@example.org");
  assert.equal(unknown.status, known.status);
  assert.equal(unknown.text, known.text);
  assert.equal(w.sent.length, 1, "only the linked address was mailed");
  const guess = await removeVerify(w, "000000", "stranger@example.org");
  assert.equal(guess.status, 400);
  assert.deepEqual(guess.body, { error: "wrong_code", triesLeft: 4 });
  assert.equal(w.confirmations.length, 0);
});

test("remove: wrong codes, five tries, expiry and reuse behave as at sign-in", async () => {
  const w = await linked();
  await removeStart(w);
  const code = w.lastCode(EMAIL);
  const wrong = code === "000000" ? "111111" : "000000";
  assert.deepEqual((await removeVerify(w, wrong)).body, { error: "wrong_code", triesLeft: 4 });
  for (let i = 0; i < 3; i++) await removeVerify(w, wrong);
  assert.deepEqual((await removeVerify(w, wrong)).body, { error: "too_many_tries" });
  assert.deepEqual((await removeVerify(w, code)).body, { error: "too_many_tries" }, "used up");
  assert.equal(await linksOf(w, EMAIL), 2, "nothing was removed");

  await removeStart(w);
  w.clock.minutes(11);
  assert.deepEqual((await removeVerify(w, w.lastCode(EMAIL))).body, { error: "expired" });
  assert.equal(await linksOf(w, EMAIL), 2);
});

test("remove: a sign-in or link code does not remove, and a remove code does not sign in", async () => {
  const w = await linked();
  await w.call("signinStart", { product: "rankup", email: EMAIL });
  const signinCode = w.lastCode(EMAIL);
  assert.deepEqual((await removeVerify(w, signinCode)).body, { error: "expired" }, "no live remove code");
  await removeStart(w);
  const removeCode = w.lastCode(EMAIL);
  const asSignin = await w.call("signinVerify", { product: "rankup", email: EMAIL, code: removeCode, platform: "ios" });
  assert.equal(asSignin.status, 400);
  assert.equal(await linksOf(w, EMAIL), 2);
});

test("remove/start shares the 5 codes an hour per address with sign-in and link", async () => {
  const w = await linked();
  for (let i = 0; i < 3; i++) await w.call("signinStart", { product: "rankup", email: EMAIL });
  await removeStart(w);
  await removeStart(w);
  assert.equal(w.sent.length, 5);
  await removeStart(w);
  assert.equal(w.sent.length, 5, "the sixth code in the hour is not sent");
});

test("remove: bad fields are 400; the endpoints are behind the flag, the method and the IP limit", async () => {
  const w = await linked();
  assert.deepEqual((await w.call("removeStart", { product: "rankup", email: "nope" })).body, { error: "bad_email" });
  assert.deepEqual((await w.call("removeVerify", { product: "rankup", email: EMAIL })).body, { error: "bad_request" });
  assert.deepEqual((await w.call("removeVerify", { product: "rankup", email: "x", code: "123456" })).body, { error: "bad_email" });
  assert.equal((await w.call("removeStart", { product: "rankup", email: EMAIL }, { method: "GET" })).status, 405);
  for (let i = 0; i < 20; i++) await removeStart(w, `p${i}@example.com`, "198.51.100.7");
  assert.equal((await removeStart(w, "late@example.com", "198.51.100.7")).status, 429);

  const off = await makeWorld({ env: { HOUSEHOLD_ENABLED: "0" } });
  assert.deepEqual((await off.call("removeStart", { product: "rankup", email: EMAIL })).body, { error: "off" });
});

test("remove: a failed confirmation mail still removes, and still answers {removed:true}", async () => {
  const w = await linked();
  await removeStart(w);
  w.mail.failConfirm = true;
  const err = console.error;
  console.error = () => {};
  try {
    const done = await removeVerify(w, w.lastCode(EMAIL));
    assert.deepEqual(done.body, { removed: true });
  } finally {
    console.error = err;
  }
  assert.equal(await linksOf(w, EMAIL), 0);
});

test("remove: nothing readable is stored at any point", async () => {
  const w = await linked();
  await removeStart(w);
  const { text } = await dumpHouseholdTables(w.db);
  assert.equal(text.toLowerCase().includes("example.com"), false);
});
