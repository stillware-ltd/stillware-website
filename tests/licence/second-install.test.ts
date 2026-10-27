import test from "node:test";
import assert from "node:assert/strict";
import { verifySignedRecord } from "../../netlify/functions/lib/household-record.js";
import { addLink } from "../../netlify/functions/lib/household-store.js";
import type { LegacyPurchase } from "../../netlify/functions/lib/revenuecat-lookup.js";
import { handleRevenueCatWebhook } from "../../netlify/functions/lib/revenuecat.js";
import { makeWorld, type World, testEmailHash } from "./helpers.js";

// A second install on the same store account: the app reinstalled, or set up on a new phone or a
// second device. RevenueCat gives it a new app user id and moves the store account's purchases to
// it, but the server stored the purchase under the first install's id, and a transaction is stored
// once. Until RevenueCat's TRANSFER event moved it, `fetch` found the purchase at RevenueCat, could
// not store it again, and answered 404: the new install waited for its licence for good. Found
// 27 October 2026, when build 33 was installed fresh on the founder's phone before the webhook was
// set up. Now `fetch` moves it to the asking id, as that event would. The HTTP call is faked.

const FIRST = "$RCAnonymousID:first-install";
const SECOND = "$RCAnonymousID:second-install";
const ENV = { HOUSEHOLD_UPGRADE_BEFORE: "2026-10-28" };

const earlier = (over: Partial<LegacyPurchase> = {}): LegacyPurchase => ({
  productId: "rankupchess_premium_unlock",
  store: "play",
  purchased: "2026-10-25",
  transactionId: "GPA.3399-0000-1111-22222",
  sandbox: true,
  ...over,
});
const everyDevice = (over: Partial<LegacyPurchase> = {}): LegacyPurchase =>
  earlier({ productId: "rankupchess_every_device", purchased: "2026-11-02", transactionId: "GPA.3300-1111-2222-33333", sandbox: false, ...over });

async function world() {
  const w = await makeWorld({ env: ENV });
  w.legacy.enabled = true;
  return w;
}
const rows = async (w: World) => (await w.db.execute("SELECT * FROM household_store_entitlements ORDER BY id")).rows;
const doFetch = (w: World, appUserId: string) => w.call("fetch", { product: "rankup", appUserId, platform: "android" });
const webhook = (w: World, event: Record<string, unknown>) =>
  handleRevenueCatWebhook(
    new Request("https://x/", { method: "POST", headers: { Authorization: "Bearer s" }, body: JSON.stringify({ event }) }),
    { getDb: () => w.db, now: w.clock.now, env: { REVENUECAT_WEBHOOK_AUTH: "Bearer s" } }
  );

test("an earlier buyer's second install gets the same licence, and the purchase moves to it", async () => {
  const w = await world();
  w.legacy.result = { status: "purchase", purchase: earlier() };
  const first = await doFetch(w, FIRST);
  assert.equal(first.status, 200);

  // RevenueCat now lists the purchase for the second install only.
  const second = await doFetch(w, SECOND);
  assert.equal(second.status, 200);
  assert.equal(second.body.record.lid, first.body.record.lid, "one licence for the household");
  assert.equal(second.body.record.via, "upgrade");
  assert.equal(second.body.record.tier, "every_device");
  assert.equal(verifySignedRecord(second.body, w.key.publicKey), true);
  const all = await rows(w);
  assert.equal(all.length, 1);
  assert.equal(all[0].app_user_id, SECOND);

  // Kept: the next fetch finds it without asking RevenueCat.
  const calls = w.legacy.calls.length;
  assert.deepEqual((await doFetch(w, SECOND)).body, second.body);
  assert.equal(w.legacy.calls.length, calls);
});

test("an Every device buyer's second install gets the purchase the webhook recorded for the first", async () => {
  const w = await world();
  const recorded = await webhook(w, {
    type: "NON_RENEWING_PURCHASE", app_user_id: FIRST, product_id: "rankupchess_every_device", store: "PLAY_STORE",
    transaction_id: "GPA.3300-1111-2222-33333", purchased_at_ms: Date.parse("2026-11-02T10:00:00Z"),
  });
  assert.deepEqual(await recorded.json(), { ok: true, recorded: true });
  const first = await doFetch(w, FIRST);
  assert.equal(first.status, 200);
  assert.equal(w.legacy.calls.length, 0, "the first install's row needs no lookup");

  w.legacy.result = { status: "every_device", purchase: everyDevice() };
  const second = await doFetch(w, SECOND);
  assert.equal(second.status, 200);
  assert.equal(second.body.record.lid, first.body.record.lid);
  assert.equal(second.body.record.via, "play");
  assert.equal((await rows(w))[0].app_user_id, SECOND);
});

test("the email linked on the first install moves too, and still signs in to the same licence", async () => {
  const w = await world();
  w.legacy.result = { status: "purchase", purchase: earlier() };
  const first = await doFetch(w, FIRST);
  await addLink(w.db, "rankup", testEmailHash("parent@example.com"), FIRST);

  assert.equal((await doFetch(w, SECOND)).status, 200);
  const links = (await w.db.execute("SELECT app_user_id FROM household_email_links")).rows;
  assert.deepEqual(links.map((r) => r.app_user_id), [SECOND]);

  await w.call("signinStart", { product: "rankup", email: "parent@example.com" });
  const signed = await w.call("signinVerify", {
    product: "rankup", email: "parent@example.com", code: w.lastCode("parent@example.com"), platform: "windows",
  });
  assert.equal(signed.status, 200);
  assert.equal(signed.body.record.lid, first.body.record.lid);
});

test("an install RevenueCat does not list the purchase for never takes it", async () => {
  const w = await world();
  w.legacy.result = { status: "purchase", purchase: earlier() };
  assert.equal((await doFetch(w, FIRST)).status, 200);

  w.legacy.result = { status: "none" };
  assert.equal((await doFetch(w, SECOND)).status, 404);
  assert.equal((await rows(w))[0].app_user_id, FIRST);
});

test("after the move, the first install asking again does not take it back", async () => {
  const w = await world();
  w.legacy.result = { status: "purchase", purchase: earlier() };
  assert.equal((await doFetch(w, FIRST)).status, 200);
  assert.equal((await doFetch(w, SECOND)).status, 200);

  // RevenueCat moved the purchase away from the first install: it lists nothing for it now.
  w.legacy.result = { status: "none" };
  assert.equal((await doFetch(w, FIRST)).status, 404);
  assert.equal((await rows(w))[0].app_user_id, SECOND);
});

test("a refunded purchase is not moved or brought back", async () => {
  const w = await world();
  w.legacy.result = { status: "purchase", purchase: earlier() };
  assert.equal((await doFetch(w, FIRST)).status, 200);
  await webhook(w, { type: "CANCELLATION", cancel_reason: "CUSTOMER_SUPPORT", transaction_id: "GPA.3399-0000-1111-22222", app_user_id: FIRST });

  assert.equal((await doFetch(w, SECOND)).status, 404);
  const [row] = await rows(w);
  assert.equal(row.app_user_id, FIRST);
  assert.equal(row.revoked, 1);
});

test("RevenueCat's TRANSFER arriving after the move moves nothing, and the licence stays the same", async () => {
  const w = await world();
  w.legacy.result = { status: "purchase", purchase: earlier() };
  const first = await doFetch(w, FIRST);
  assert.equal((await doFetch(w, SECOND)).status, 200);

  const transfer = await webhook(w, { type: "TRANSFER", transferred_from: [FIRST], transferred_to: [SECOND] });
  assert.deepEqual(await transfer.json(), { ok: true, moved: 0 });
  const again = await doFetch(w, SECOND);
  assert.equal(again.body.record.lid, first.body.record.lid);
  assert.equal((await rows(w)).length, 1);
});

test("a purchase on or after the switch date is still not upgraded on a second install", async () => {
  const w = await world();
  w.legacy.result = { status: "purchase", purchase: earlier({ purchased: "2026-10-28" }) };
  assert.equal((await doFetch(w, FIRST)).status, 404);
  assert.equal((await doFetch(w, SECOND)).status, 404);
  assert.equal((await rows(w)).length, 0);
});
