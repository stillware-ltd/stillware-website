import test from "node:test";
import assert from "node:assert/strict";
import { verifySignedRecord } from "../../netlify/functions/lib/household-record.js";
import { addLink } from "../../netlify/functions/lib/household-store.js";
import {
  everyDevicePurchaseFrom,
  lookupLegacyPurchase,
  type LegacyPurchase,
} from "../../netlify/functions/lib/revenuecat-lookup.js";
import { handleRevenueCatWebhook } from "../../netlify/functions/lib/revenuecat.js";
import { makeWorld, type World, type WorldOptions, testEmailHash } from "./helpers.js";

// An Every device store purchase whose webhook never came (not configured yet, or it failed):
// `fetch` already asks RevenueCat when it finds no entitlement, and now records an Every device
// purchase it finds there as the webhook would have. Found 26 October 2026: without this, a
// missing webhook left a buyer waiting for their licence for good, with no way to fix it in
// the app. The HTTP call is faked; the response shape is RevenueCat's v1 subscriber.

const USER = "$RCAnonymousID:every1";
const FETCH = { product: "rankup", appUserId: USER, platform: "android" };
const ENV = { HOUSEHOLD_UPGRADE_BEFORE: "2026-10-28" };

const bought = (over: Partial<LegacyPurchase> = {}): LegacyPurchase => ({
  productId: "rankupchess_every_device",
  store: "play",
  purchased: "2026-11-02",
  transactionId: "GPA.3300-1111-2222-33333",
  sandbox: false,
  ...over,
});

async function fallbackWorld(opts: WorldOptions = {}) {
  const w = await makeWorld({ env: ENV, ...opts });
  w.legacy.enabled = true;
  return w;
}
const rows = async (w: World) => (await w.db.execute("SELECT * FROM household_store_entitlements ORDER BY id")).rows;
const doFetch = (w: World, appUserId = USER) => w.call("fetch", { ...FETCH, appUserId });

test("an Every device buyer with no webhook record gets the record, stored as the webhook would", async () => {
  const w = await fallbackWorld();
  w.legacy.result = { status: "every_device", purchase: bought() };

  const first = await doFetch(w);
  assert.equal(first.status, 200);
  assert.equal(first.body.record.via, "play");
  assert.equal(first.body.record.tier, "every_device");
  assert.equal(first.body.record.purchased, "2026-11-02");
  assert.equal(verifySignedRecord(first.body, w.key.publicKey), true);

  const [row] = await rows(w);
  assert.equal(row.via, "play");
  assert.equal(row.store, "play");
  assert.equal(row.product_id, "rankupchess_every_device");
  assert.equal(row.transaction_id, "GPA.3300-1111-2222-33333");
  assert.equal(row.environment, "PRODUCTION");
  assert.equal(row.app_user_id, USER);

  // Kept: the next fetch finds it without asking RevenueCat.
  const second = await doFetch(w);
  assert.deepEqual(second.body, first.body);
  assert.equal(w.legacy.calls.length, 1);
});

test("the upgrade to Every device counts the same, on the App Store too, sandbox marked", async () => {
  const w = await fallbackWorld();
  w.legacy.result = {
    status: "every_device",
    purchase: bought({ productId: "rankupchess_every_device_upgrade", store: "app_store", sandbox: true }),
  };
  const res = await doFetch(w);
  assert.equal(res.status, 200);
  assert.equal(res.body.record.via, "app_store");
  const [row] = await rows(w);
  assert.equal(row.product_id, "rankupchess_every_device_upgrade");
  assert.equal(row.environment, "SANDBOX");
});

test("it needs no switch date: the date only decides the free upgrade of earlier buyers", async () => {
  for (const date of [undefined, ""]) {
    const w = await makeWorld({ env: { HOUSEHOLD_UPGRADE_BEFORE: date } });
    w.legacy.enabled = true;
    w.legacy.result = { status: "every_device", purchase: bought() };
    assert.equal((await doFetch(w)).status, 200, String(date));
  }
});

test("the webhook arriving later does not record the purchase twice", async () => {
  const w = await fallbackWorld();
  w.legacy.result = { status: "every_device", purchase: bought() };
  const fetched = await doFetch(w);
  assert.equal(fetched.status, 200);

  const wh = {
    event: {
      type: "NON_RENEWING_PURCHASE", app_user_id: USER, product_id: "rankupchess_every_device", store: "PLAY_STORE",
      transaction_id: "GPA.3300-1111-2222-33333", purchased_at_ms: Date.parse("2026-11-02T10:00:00Z"),
    },
  };
  const res = await handleRevenueCatWebhook(
    new Request("https://x/", { method: "POST", headers: { Authorization: "Bearer s" }, body: JSON.stringify(wh) }),
    { getDb: () => w.db, now: w.clock.now, env: { REVENUECAT_WEBHOOK_AUTH: "Bearer s" } }
  );
  assert.equal(res.status, 200);
  assert.equal((await rows(w)).length, 1);
  const again = await doFetch(w);
  assert.equal(again.body.record.lid, fetched.body.record.lid);
});

test("a refunded Every device purchase is not brought back by the lookup", async () => {
  const w = await fallbackWorld();
  w.legacy.result = { status: "every_device", purchase: bought() };
  assert.equal((await doFetch(w)).status, 200);
  const refund = {
    event: { type: "CANCELLATION", cancel_reason: "CUSTOMER_SUPPORT", transaction_id: "GPA.3300-1111-2222-33333", app_user_id: USER },
  };
  await handleRevenueCatWebhook(
    new Request("https://x/", { method: "POST", headers: { Authorization: "Bearer s" }, body: JSON.stringify(refund) }),
    { getDb: () => w.db, now: w.clock.now, env: { REVENUECAT_WEBHOOK_AUTH: "Bearer s" } }
  );
  assert.equal((await doFetch(w)).status, 404);
  assert.equal((await rows(w)).length, 1);
});

test("an email linked to the buyer signs in to the same licence", async () => {
  const w = await fallbackWorld();
  w.legacy.result = { status: "every_device", purchase: bought() };
  const fetched = await doFetch(w);
  await addLink(w.db, "rankup", testEmailHash("parent@example.com"), USER);
  await w.call("signinStart", { product: "rankup", email: "parent@example.com" });
  const signed = await w.call("signinVerify", {
    product: "rankup", email: "parent@example.com", code: w.lastCode("parent@example.com"), platform: "ios",
  });
  assert.equal(signed.status, 200);
  assert.equal(signed.body.record.lid, fetched.body.record.lid);
});

// ---------------------------------------------------------------------------------------------
// The parser

const NOW = new Date("2026-11-03T09:30:00Z");
const subscriber = (nonSubscriptions: Record<string, unknown>, entitlement: Record<string, unknown> = {}) => ({
  request_date: "2026-11-03T09:30:00Z",
  subscriber: {
    entitlements: {
      rankupchess_premium_unlock: {
        expires_date: null,
        grace_period_expires_date: null,
        product_identifier: "rankupchess_every_device",
        purchase_date: "2026-11-02T10:00:00Z",
        ...entitlement,
      },
    },
    non_subscriptions: nonSubscriptions,
    original_app_user_id: USER,
    subscriptions: {},
  },
});
const playEntry = (over: Record<string, unknown> = {}) => ({
  id: "rc1",
  is_sandbox: false,
  original_purchase_date: "2026-11-02T10:00:00Z",
  purchase_date: "2026-11-02T10:00:00Z",
  store: "play_store",
  store_transaction_id: "GPA.3300-1111-2222-33333",
  ...over,
});
const parse = (body: unknown) => everyDevicePurchaseFrom(body, "rankupchess_premium_unlock", USER, NOW);

test("parser: an Every device entry gives the product, store, date, transaction and sandbox flag", () => {
  assert.deepEqual(parse(subscriber({ rankupchess_every_device: [playEntry()] })), {
    productId: "rankupchess_every_device", store: "play", purchased: "2026-11-02",
    transactionId: "GPA.3300-1111-2222-33333", sandbox: false,
  });
});

test("parser: the upgrade counts, found by product even when the entitlement names the first purchase", () => {
  const body = subscriber(
    {
      rankupchess_premium_unlock: [playEntry({ store_transaction_id: "GPA.first", original_purchase_date: "2026-11-01T08:00:00Z" })],
      rankupchess_every_device_upgrade: [playEntry({ store_transaction_id: "GPA.up" })],
    },
    { product_identifier: "rankupchess_premium_unlock" }
  );
  const got = parse(body);
  assert.equal(got?.productId, "rankupchess_every_device_upgrade");
  assert.equal(got?.transactionId, "GPA.up");
});

test("parser: no Every device product, a lapsed entitlement, a promotion or a malformed body is not a buyer", () => {
  assert.equal(parse(subscriber({ rankupchess_premium_unlock: [playEntry()] })), null, "one device only");
  assert.equal(parse(subscriber({ rankupchess_every_device: [playEntry()] }, { expires_date: "2026-11-02T12:00:00Z" })), null, "lapsed");
  assert.equal(parse(subscriber({ rankupchess_every_device: [playEntry({ store: "promotional" })] })), null, "promotion");
  assert.equal(parse({ subscriber: { entitlements: {}, non_subscriptions: { rankupchess_every_device: [playEntry()] } } }), null, "no entitlement");
  assert.equal(parse(null), null);
  assert.equal(parse({ subscriber: "x" }), null);
});

test("lookup: a subscriber with Every device is 'every_device', with one device only it is the legacy purchase", async () => {
  const answer = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });
  const every = await lookupLegacyPurchase({
    key: "sk_test", appUserId: USER, entitlementId: "rankupchess_premium_unlock", now: NOW,
    fetchImpl: answer(subscriber({ rankupchess_every_device: [playEntry()] })) as typeof fetch,
  });
  assert.equal(every.status, "every_device");

  const legacy = await lookupLegacyPurchase({
    key: "sk_test", appUserId: USER, entitlementId: "rankupchess_premium_unlock", now: NOW,
    fetchImpl: answer(subscriber({ rankupchess_premium_unlock: [playEntry()] }, { product_identifier: "rankupchess_premium_unlock" })) as typeof fetch,
  });
  assert.equal(legacy.status, "purchase");
});
