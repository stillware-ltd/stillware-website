import test from "node:test";
import assert from "node:assert/strict";
import { handleRevenueCatWebhook } from "../../netlify/functions/lib/revenuecat.js";
import { makeWorld, type World } from "./helpers.js";

// KD-53 (RankUp 0.11.2): a phone whose store no longer lists its purchase asks `fetch` whether
// that purchase was refunded. A refund leaves the purchase's row, revoked, under the id that held
// it; a purchase the store account moved to another install (a reinstall, a second phone or iPad
// on the same account) leaves no row under the old id. So `fetch` answers
// {"error":"none","refunded":true} only for the first, and a plain `none` for the second, and the
// phone drops its record only after a refund. The HTTP call to RevenueCat is faked.

const FIRST = "$RCAnonymousID:first-install";
const SECOND = "$RCAnonymousID:second-install";
const TXN = "GPA.3300-1111-2222-33333";

async function world() {
  const w = await makeWorld({ env: { HOUSEHOLD_UPGRADE_BEFORE: "2026-10-28" } });
  w.legacy.enabled = true;
  return w;
}
const doFetch = (w: World, appUserId: string) => w.call("fetch", { product: "rankup", appUserId, platform: "android" });
const webhook = (w: World, event: Record<string, unknown>) =>
  handleRevenueCatWebhook(
    new Request("https://x/", { method: "POST", headers: { Authorization: "Bearer s" }, body: JSON.stringify({ event }) }),
    { getDb: () => w.db, now: w.clock.now, env: { REVENUECAT_WEBHOOK_AUTH: "Bearer s" } }
  );
const buy = (w: World, appUserId: string) =>
  webhook(w, {
    type: "NON_RENEWING_PURCHASE", app_user_id: appUserId, product_id: "rankupchess_every_device", store: "PLAY_STORE",
    transaction_id: TXN, purchased_at_ms: Date.parse("2026-11-02T10:00:00Z"),
  });
const refund = (w: World) => webhook(w, { type: "REFUND", transaction_id: TXN });

test("the buying phone's own purchase refunded: none, refunded", async () => {
  const w = await world();
  await buy(w, FIRST);
  assert.equal((await doFetch(w, FIRST)).status, 200);

  await refund(w);
  w.legacy.result = { status: "none" };
  const after = await doFetch(w, FIRST);
  assert.equal(after.status, 404);
  assert.deepEqual(after.body, { error: "none", refunded: true });
});

test("the purchase moved to a second install: the first gets a plain none", async () => {
  const w = await world();
  await buy(w, FIRST);
  assert.equal((await doFetch(w, FIRST)).status, 200);

  // RevenueCat's TRANSFER moves the store account's purchase to the second install.
  await webhook(w, { type: "TRANSFER", transferred_from: [FIRST], transferred_to: [SECOND] });
  assert.equal((await doFetch(w, SECOND)).status, 200);

  w.legacy.result = { status: "none" };
  const first = await doFetch(w, FIRST);
  assert.equal(first.status, 404);
  assert.deepEqual(first.body, { error: "none" }, "a move is not a refund");
});

test("moved, then refunded on the second install: only the second hears it", async () => {
  const w = await world();
  await buy(w, FIRST);
  await webhook(w, { type: "TRANSFER", transferred_from: [FIRST], transferred_to: [SECOND] });
  await refund(w);
  w.legacy.result = { status: "none" };

  assert.deepEqual((await doFetch(w, SECOND)).body, { error: "none", refunded: true });
  // The first phone's record was issued before the refund and stays valid there (KD-40).
  assert.deepEqual((await doFetch(w, FIRST)).body, { error: "none" });
});

test("an id that never bought anything: a plain none", async () => {
  const w = await world();
  w.legacy.result = { status: "none" };
  assert.deepEqual((await doFetch(w, "$RCAnonymousID:never")).body, { error: "none" });
});

test("refunded once, bought again: the new purchase answers, not the refund", async () => {
  const w = await world();
  await buy(w, FIRST);
  await refund(w);
  await webhook(w, {
    type: "NON_RENEWING_PURCHASE", app_user_id: FIRST, product_id: "rankupchess_every_device", store: "PLAY_STORE",
    transaction_id: "GPA.3300-9999-8888-77777", purchased_at_ms: Date.parse("2026-11-05T10:00:00Z"),
  });
  const again = await doFetch(w, FIRST);
  assert.equal(again.status, 200);
  assert.equal(again.body.record.tier, "every_device");
});
