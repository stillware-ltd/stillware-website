import test from "node:test";
import assert from "node:assert/strict";
import { verifySignedRecord } from "../../netlify/functions/lib/household-record.js";
import { addLink } from "../../netlify/functions/lib/household-store.js";
import { householdSettings } from "../../netlify/functions/lib/household-config.js";
import {
  DEFAULT_LEGACY_ENTITLEMENT,
  LOOKUP_TIMEOUT_MS,
  REVENUECAT_SUBSCRIBERS_URL,
  legacyPurchaseFrom,
  lookupLegacyPurchase,
  type LegacyPurchase,
} from "../../netlify/functions/lib/revenuecat-lookup.js";
import { handleRevenueCatWebhook } from "../../netlify/functions/lib/revenuecat.js";
import { makeWorld, type World, type WorldOptions, testEmailHash } from "./helpers.js";

// Earlier store buyers: `fetch` asks RevenueCat's REST API once, when it finds no entitlement,
// and stores a purchase made before HOUSEHOLD_UPGRADE_BEFORE as an "upgrade". The HTTP call is
// faked everywhere here; the response shape is the one RevenueCat documents (see the fixture).

const USER = "$RCAnonymousID:legacy1";
const FETCH = { product: "rankup", appUserId: USER, platform: "ios" };
const ENV = { HOUSEHOLD_UPGRADE_BEFORE: "2026-10-20" };

const purchase = (over: Partial<LegacyPurchase> = {}): LegacyPurchase => ({
  productId: "rankupchess_premium_unlock",
  store: "app_store",
  purchased: "2026-03-14",
  transactionId: "2000000555",
  sandbox: false,
  ...over,
});

async function legacyWorld(opts: WorldOptions = {}) {
  const w = await makeWorld({ env: ENV, ...opts });
  w.legacy.enabled = true;
  return w;
}
const rows = async (w: World) => (await w.db.execute("SELECT * FROM household_store_entitlements ORDER BY id")).rows;
const doFetch = (w: World, appUserId = USER) => w.call("fetch", { ...FETCH, appUserId });

test("a pre-switch buyer gets an upgrade record, and the second fetch makes no call", async () => {
  const w = await legacyWorld();
  w.legacy.result = { status: "purchase", purchase: purchase() };

  const first = await doFetch(w);
  assert.equal(first.status, 200);
  assert.equal(first.body.record.via, "upgrade");
  assert.equal(first.body.record.purchased, "2026-03-14");
  assert.equal(first.body.record.tier, "every_device");
  assert.equal(verifySignedRecord(first.body, w.key.publicKey), true);
  assert.deepEqual(w.legacy.calls, [{ appUserId: USER, entitlementId: "rankupchess_premium_unlock", platform: "ios" }]);

  const [row] = await rows(w);
  assert.equal(row.via, "upgrade");
  assert.equal(row.store, "app_store");
  assert.equal(row.product_id, "rankupchess_premium_unlock");
  assert.equal(row.purchased, "2026-03-14");
  assert.equal(row.transaction_id, "2000000555");
  assert.equal(row.environment, "PRODUCTION");
  assert.equal(row.app_user_id, USER);
  assert.equal(row.lid, first.body.record.lid);

  const second = await doFetch(w);
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal(w.legacy.calls.length, 1, "RevenueCat was not asked again");
  assert.equal((await rows(w)).length, 1);
});

test("a Play purchase is stored as Play, and the entitlement id can be set", async () => {
  const w = await legacyWorld({ env: { ...ENV, HOUSEHOLD_LEGACY_ENTITLEMENT: "my_unlock" } });
  w.legacy.result = { status: "purchase", purchase: purchase({ store: "play" }) };
  assert.equal((await doFetch(w)).status, 200);
  assert.equal(w.legacy.calls[0].entitlementId, "my_unlock");
  assert.equal((await rows(w))[0].store, "play");
  assert.equal(householdSettings({}).legacyEntitlement, DEFAULT_LEGACY_ENTITLEMENT);
  assert.equal(householdSettings({ HOUSEHOLD_LEGACY_ENTITLEMENT: "  " }).legacyEntitlement, "rankupchess_premium_unlock");
});

test("the upgrade record also works through a linked address", async () => {
  const w = await legacyWorld();
  w.legacy.result = { status: "purchase", purchase: purchase() };
  const fetched = await doFetch(w);
  await addLink(w.db, "rankup", testEmailHash("parent@example.com"), USER);
  await w.call("signinStart", { product: "rankup", email: "parent@example.com" });
  const signed = await w.call("signinVerify", {
    product: "rankup", email: "parent@example.com", code: w.lastCode("parent@example.com"), platform: "android",
  });
  assert.equal(signed.status, 200);
  assert.equal(signed.body.record.lid, fetched.body.record.lid);
  assert.equal(signed.body.record.via, "upgrade");
});

test("a purchase on or after the switch date is 404 none, like never having bought, and stores nothing", async () => {
  const w = await legacyWorld();
  for (const purchased of ["2026-10-20", "2026-10-21", "2027-01-01"]) {
    w.legacy.result = { status: "purchase", purchase: purchase({ purchased, transactionId: `t-${purchased}` }) };
    const res = await doFetch(w, `user-${purchased}`);
    assert.equal(res.status, 404, purchased);
    assert.deepEqual(res.body, { error: "none" });
  }
  assert.equal((await rows(w)).length, 0);
  // the day before is the last day that counts
  w.legacy.result = { status: "purchase", purchase: purchase({ purchased: "2026-10-19" }) };
  assert.equal((await doFetch(w, "user-last-day")).status, 200);
});

test("no purchase in RevenueCat (no entitlement, or a 404): 404 none, nothing stored", async () => {
  const w = await legacyWorld();
  w.legacy.result = { status: "none" };
  const res = await doFetch(w);
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: "none" });
  assert.equal(w.legacy.calls.length, 1);
  assert.equal((await rows(w)).length, 0);
});

test("a sandbox purchase is stored as a sandbox one, and still earns the record", async () => {
  const w = await legacyWorld();
  w.legacy.result = { status: "purchase", purchase: purchase({ sandbox: true }) };
  const res = await doFetch(w);
  assert.equal(res.status, 200);
  assert.equal((await rows(w))[0].environment, "SANDBOX");
});

test("RevenueCat unreachable (timeout, 5xx): 503 try_later, nothing stored, and it can be tried again", async () => {
  const w = await legacyWorld();
  w.legacy.result = { status: "unavailable" };
  const res = await doFetch(w);
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: "try_later" });
  assert.equal((await rows(w)).length, 0);
  const issued = await w.db.execute("SELECT COUNT(*) AS n FROM household_issued");
  assert.equal(issued.rows[0].n, 0);

  w.legacy.result = { status: "purchase", purchase: purchase() };
  assert.equal((await doFetch(w)).status, 200);
});

test("a lookup function that throws is a 503 too, not a crash", async () => {
  const w = await legacyWorld();
  const handlers = (await import("../../netlify/functions/lib/household-http.js")).householdHandlers({
    env: () => w.env,
    build: (settings) => ({
      household: {
        ...w.depsNow(),
        settings,
        legacyLookup: async () => {
          throw new Error("boom");
        },
      },
      sleep: async () => {},
      startMinMs: 0,
      perIpLimit: 20,
    }),
  });
  const res = await handlers.fetch(new Request("https://x/", { method: "POST", body: JSON.stringify(FETCH) }));
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "try_later" });
});

test("no RevenueCat key (no lookup function): the answer is today's 404 none, with no call", async () => {
  const w = await legacyWorld();
  w.legacy.enabled = false;
  const res = await doFetch(w);
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: "none" });
  assert.equal(w.legacy.calls.length, 0);
});

test("no switch date: RevenueCat is never asked, even with a key", async () => {
  for (const date of [undefined, "", "soon", "2026-13-45x"]) {
    const w = await makeWorld({ env: { HOUSEHOLD_UPGRADE_BEFORE: date } });
    w.legacy.enabled = true;
    w.legacy.result = { status: "purchase", purchase: purchase() };
    const res = await doFetch(w);
    assert.equal(res.status, 404, String(date));
    assert.equal(w.legacy.calls.length, 0, String(date));
  }
});

test("an app user id that already has an entitlement is never looked up", async () => {
  const w = await legacyWorld();
  const wh = {
    event: {
      type: "NON_RENEWING_PURCHASE", app_user_id: USER, product_id: "test_every_device", store: "APP_STORE",
      transaction_id: "T1", purchased_at_ms: Date.parse("2026-10-22T10:00:00Z"),
    },
  };
  await handleRevenueCatWebhook(
    new Request("https://x/", { method: "POST", headers: { Authorization: "Bearer s" }, body: JSON.stringify(wh) }),
    { getDb: () => w.db, now: w.clock.now, env: { REVENUECAT_WEBHOOK_AUTH: "Bearer s" }, storeProducts: { test_every_device: "rankup" } }
  );
  w.legacy.result = { status: "purchase", purchase: purchase() };
  const res = await doFetch(w);
  assert.equal(res.status, 200);
  assert.equal(res.body.record.via, "app_store");
  assert.equal(w.legacy.calls.length, 0);
});

test("a refunded upgrade is not brought back by the lookup", async () => {
  const w = await legacyWorld();
  w.legacy.result = { status: "purchase", purchase: purchase() };
  assert.equal((await doFetch(w)).status, 200);

  // the One platform purchase is refunded: the webhook revokes the row by its transaction id
  const refund = {
    event: { type: "CANCELLATION", cancel_reason: "CUSTOMER_SUPPORT", transaction_id: "2000000555", app_user_id: USER },
  };
  const wh = await handleRevenueCatWebhook(
    new Request("https://x/", { method: "POST", headers: { Authorization: "Bearer s" }, body: JSON.stringify(refund) }),
    { getDb: () => w.db, now: w.clock.now, env: { REVENUECAT_WEBHOOK_AUTH: "Bearer s" } }
  );
  assert.deepEqual(await wh.json(), { ok: true, revoked: 1, unlinked: 0 });

  // even if the lookup still reported the purchase, the same transaction does not become valid again
  const res = await doFetch(w);
  assert.equal(res.status, 404);
  assert.equal((await rows(w)).length, 1);
  assert.equal((await rows(w))[0].revoked, 1);
});

test("the lookup cap: 3 an hour per app user id; the fourth is 429 with no call; others and later are fine", async () => {
  const w = await legacyWorld();
  w.legacy.result = { status: "none" };
  for (let i = 0; i < 3; i++) assert.equal((await doFetch(w)).status, 404, `ask ${i + 1}`);
  assert.equal(w.legacy.calls.length, 3);

  const capped = await doFetch(w);
  assert.equal(capped.status, 429);
  assert.deepEqual(capped.body, { error: "rate_limited" });
  assert.equal(w.legacy.calls.length, 3, "the fourth did not reach RevenueCat");

  // another app user id has its own allowance
  assert.equal((await doFetch(w, "someone-else")).status, 404);
  assert.equal(w.legacy.calls.length, 4);

  // an hour later it may ask again
  w.clock.minutes(61);
  w.legacy.result = { status: "purchase", purchase: purchase() };
  assert.equal((await doFetch(w)).status, 200);
  assert.equal(w.legacy.calls.length, 5);
});

test("the lookup cap counts failed asks too, so a loop on an outage cannot hammer RevenueCat", async () => {
  const w = await legacyWorld();
  w.legacy.result = { status: "unavailable" };
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await doFetch(w)).status);
  assert.deepEqual(statuses, [503, 503, 503, 429, 429]);
  assert.equal(w.legacy.calls.length, 3);
});

test("fetch itself stays without an IP limit even when it asks RevenueCat", async () => {
  const w = await legacyWorld();
  w.legacy.result = { status: "none" };
  for (let i = 0; i < 30; i++) {
    const res = await w.call("fetch", { ...FETCH, appUserId: `u${i}` }, { ip: "203.0.113.50" });
    assert.equal(res.status, 404);
  }
});

// ---------------------------------------------------------------------------------------------
// The lookup module: the documented response shape, and the HTTP behaviour (faked fetch)

const KEY = "sk_test_NOT_A_REAL_KEY_0123456789";

/** A subscriber as RevenueCat's v1 documentation shows one, with a lifetime unlock bought in the App Store. */
const subscriber = (over: Record<string, unknown> = {}, entries?: unknown[]) => ({
  request_date: "2026-10-23T09:30:00Z",
  request_date_ms: 1792748000000,
  subscriber: {
    entitlements: {
      rankupchess_premium_unlock: {
        expires_date: null,
        grace_period_expires_date: null,
        product_identifier: "rankupchess_premium_unlock",
        purchase_date: "2026-03-14T18:20:11Z",
      },
    },
    first_seen: "2026-03-14T18:19:00Z",
    last_seen: "2026-10-01T08:00:00Z",
    management_url: null,
    non_subscriptions: {
      rankupchess_premium_unlock: entries ?? [
        {
          id: "5f9d0c1ab2",
          is_sandbox: false,
          original_purchase_date: "2026-03-14T18:20:11Z",
          purchase_date: "2026-03-14T18:20:11Z",
          store: "app_store",
          store_transaction_id: "2000000555",
        },
      ],
    },
    original_app_user_id: "$RCAnonymousID:legacy1",
    original_application_version: "1.0",
    other_purchases: {},
    subscriptions: {},
    ...over,
  },
});

const NOW = new Date("2026-10-23T09:30:00Z");
const parse = (body: unknown, platform?: string) => legacyPurchaseFrom(body, "rankupchess_premium_unlock", USER, platform, NOW);

test("parser: the documented shape gives the date, store, sandbox flag and transaction id", () => {
  assert.deepEqual(parse(subscriber()), {
    productId: "rankupchess_premium_unlock", store: "app_store", purchased: "2026-03-14",
    transactionId: "2000000555", sandbox: false,
  });
});

test("parser: the earliest real purchase counts, the UTC date is used, other stores map as they should", () => {
  const entries = [
    { id: "b", is_sandbox: true, original_purchase_date: "2026-05-01T06:00:00Z", store: "play_store" },
    { id: "a", is_sandbox: false, original_purchase_date: "2026-04-30T23:30:00-05:00", store: "mac_app_store", store_transaction_id: "m1" },
  ];
  // 23:30 at UTC-5 on 30 April is 04:30 UTC on 1 May, earlier than the Play entry at 06:00 UTC
  const p = parse(subscriber({}, entries));
  assert.equal(p?.purchased, "2026-05-01");
  assert.equal(p?.store, "app_store");
  assert.equal(p?.transactionId, "m1");
  assert.equal(p?.sandbox, false);
  // a Play-only buyer, sandbox
  const play = parse(subscriber({}, [entries[0]]));
  assert.equal(play?.store, "play");
  assert.equal(play?.sandbox, true);
  assert.equal(play?.transactionId, "b", "RevenueCat's own id when there is no store transaction id");
});

test("parser: no entitlement, a lapsed one, a promotion or a malformed body is not a buyer", () => {
  assert.equal(parse(subscriber({ entitlements: {} })), null);
  assert.equal(parse(subscriber({ entitlements: { other: { product_identifier: "x" } } })), null);
  assert.equal(parse(subscriber({ entitlements: { __proto__: null } })), null);
  const lapsed = { rankupchess_premium_unlock: { expires_date: "2026-01-01T00:00:00Z", product_identifier: "rankupchess_premium_unlock", purchase_date: "2025-01-01T00:00:00Z" } };
  assert.equal(parse(subscriber({ entitlements: lapsed })), null);
  const promo = [{ id: "p", is_sandbox: false, original_purchase_date: "2026-01-01T00:00:00Z", store: "promotional" }];
  assert.equal(parse(subscriber({}, promo)), null, "a granted entitlement is not a purchase");
  const stripe = [{ id: "s", is_sandbox: false, original_purchase_date: "2026-01-01T00:00:00Z", store: "stripe" }];
  assert.equal(parse(subscriber({}, stripe)), null);
  for (const bad of [null, undefined, "x", 3, [], {}, { subscriber: null }, { subscriber: [] }, { subscriber: {} }]) {
    assert.equal(parse(bad), null);
  }
});

test("parser: with no non_subscriptions entry, the entitlement's own date and the device's platform stand in", () => {
  const bare = subscriber({ non_subscriptions: {} });
  const ios = parse(bare, "ios");
  assert.equal(ios?.purchased, "2026-03-14");
  assert.equal(ios?.store, "app_store");
  assert.equal(ios?.sandbox, false);
  assert.match(ios?.transactionId ?? "", /^rc-lookup:[0-9a-f]{16}:rankupchess_premium_unlock:2026-03-14$/);
  assert.equal(parse(bare, "android")?.store, "play");
  assert.equal(parse(bare, "macos")?.store, "app_store");
  assert.equal(parse(bare, "windows"), null, "no store to name");
  assert.equal(parse(bare), null);
});

test("lookup: GET /v1/subscribers/{id} with the Bearer key, the id URL-encoded, 3 s timeout", async () => {
  assert.equal(LOOKUP_TIMEOUT_MS, 3000);
  let seen: { url: string; init: RequestInit } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify(subscriber()), { status: 200 });
  }) as unknown as typeof fetch;
  const res = await lookupLegacyPurchase({
    key: KEY, appUserId: "$RCAnonymousID:a/b c", entitlementId: "rankupchess_premium_unlock", platform: "ios", fetchImpl, now: NOW,
  });
  assert.equal(res.status, "purchase");
  assert.ok(seen);
  const s = seen as { url: string; init: RequestInit };
  assert.equal(s.url, REVENUECAT_SUBSCRIBERS_URL + "%24RCAnonymousID%3Aa%2Fb%20c");
  assert.equal(s.url.startsWith("https://api.revenuecat.com/v1/subscribers/"), true);
  assert.equal(s.init.method, "GET");
  assert.equal((s.init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
  assert.ok(s.init.signal instanceof AbortSignal);
});

test("lookup: 200 without the entitlement and 404 are both 'none'", async () => {
  const none200 = (async () => new Response(JSON.stringify(subscriber({ entitlements: {} })), { status: 200 })) as unknown as typeof fetch;
  assert.deepEqual(await lookupLegacyPurchase({ key: KEY, appUserId: USER, entitlementId: "rankupchess_premium_unlock", fetchImpl: none200 }), { status: "none" });
  const notFound = (async () => new Response(JSON.stringify({ code: 7225, message: "not found" }), { status: 404 })) as unknown as typeof fetch;
  assert.deepEqual(await lookupLegacyPurchase({ key: KEY, appUserId: USER, entitlementId: "rankupchess_premium_unlock", fetchImpl: notFound }), { status: "none" });
});

test("lookup: a 5xx, a 401, a 429, a broken body and a network failure are 'unavailable'", async () => {
  const errors: unknown[][] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    for (const status of [500, 502, 503, 401, 403, 429]) {
      const f = (async () => new Response("{}", { status })) as unknown as typeof fetch;
      assert.deepEqual(
        await lookupLegacyPurchase({ key: KEY, appUserId: USER, entitlementId: "e", fetchImpl: f }),
        { status: "unavailable" }, String(status)
      );
    }
    const badBody = (async () => new Response("<html>oops</html>", { status: 200 })) as unknown as typeof fetch;
    assert.deepEqual(await lookupLegacyPurchase({ key: KEY, appUserId: USER, entitlementId: "e", fetchImpl: badBody }), { status: "unavailable" });
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    assert.deepEqual(await lookupLegacyPurchase({ key: KEY, appUserId: USER, entitlementId: "e", fetchImpl: down }), { status: "unavailable" });
  } finally {
    console.error = realError;
  }
  assert.ok(errors.length >= 8, "each failure was logged");
});

test("lookup: a call that takes longer than the timeout is 'unavailable'", async () => {
  const hangs = ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })) as unknown as typeof fetch;
  const realError = console.error;
  console.error = () => {};
  const started = Date.now();
  try {
    const res = await lookupLegacyPurchase({ key: KEY, appUserId: USER, entitlementId: "e", fetchImpl: hangs, timeoutMs: 30 });
    assert.deepEqual(res, { status: "unavailable" });
  } finally {
    console.error = realError;
  }
  assert.ok(Date.now() - started < 2000);
});

test("lookup: the secret key never reaches a log or an answer, even when an error message carries it", async () => {
  const logged: string[] = [];
  const realError = console.error;
  const realLog = console.log;
  console.error = (...args: unknown[]) => void logged.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(" "));
  console.log = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  try {
    const leaky = (async (_url: string, init: RequestInit) => {
      throw new TypeError(`Headers.append: "${(init.headers as Record<string, string>).Authorization}" is an invalid header value.`);
    }) as unknown as typeof fetch;
    const res = await lookupLegacyPurchase({ key: KEY, appUserId: USER, entitlementId: "e", fetchImpl: leaky });
    assert.deepEqual(res, { status: "unavailable" });

    // and through the whole of fetch
    const w = await legacyWorld();
    w.legacy.result = { status: "unavailable" };
    const answer = await doFetch(w);
    assert.equal(answer.text.includes(KEY), false);
  } finally {
    console.error = realError;
    console.log = realLog;
  }
  assert.ok(logged.length > 0);
  for (const line of logged) assert.equal(line.includes(KEY), false, line);
  assert.equal(logged.some((l) => l.includes("Bearer")), false);
});

test("the user id of the buyer is not in the logs of a failed lookup either", async () => {
  const logged: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  try {
    const down = (async () => {
      throw new TypeError(`connect failed for ${USER}`);
    }) as unknown as typeof fetch;
    await lookupLegacyPurchase({ key: KEY, appUserId: USER, entitlementId: "e", fetchImpl: down });
  } finally {
    console.error = realError;
  }
  for (const line of logged) assert.equal(line.includes("legacy1"), false, line);
});
