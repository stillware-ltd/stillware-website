import test from "node:test";
import assert from "node:assert/strict";
import type { Client } from "@libsql/client";
import { handleRevenueCatWebhook, sameSecret, storeOf } from "../../netlify/functions/lib/revenuecat.js";
import { EVERY_DEVICE_STORE_PRODUCT_IDS, everyDeviceStoreProduct } from "../../netlify/functions/lib/products.js";
import { verifySignedRecord } from "../../netlify/functions/lib/household-record.js";
import { addLink } from "../../netlify/functions/lib/household-store.js";
import { makeWorld, type World, testEmailHash } from "./helpers.js";

// The RevenueCat webhook: the authorisation header, Every device purchases, refunds, transfers,
// and everything else ignored with a 200.

const AUTH = "Bearer test-only-webhook-secret";
const PRODUCTS = { test_every_device: "rankup", test_every_device_upgrade: "rankup" } as const;

const purchase = (over: Record<string, unknown> = {}) => ({
  api_version: "1.0",
  event: {
    id: "evt-1",
    type: "NON_RENEWING_PURCHASE",
    app_user_id: "$RCAnonymousID:abc123",
    original_app_user_id: "$RCAnonymousID:abc123",
    product_id: "test_every_device",
    store: "APP_STORE",
    environment: "PRODUCTION",
    purchased_at_ms: Date.parse("2026-10-22T23:30:00Z"),
    event_timestamp_ms: Date.parse("2026-10-22T23:30:05Z"),
    transaction_id: "1000000123",
    original_transaction_id: "1000000123",
    ...over,
  },
});

async function send(
  w: World,
  body: unknown,
  o: { auth?: string | null; method?: string; env?: Record<string, string | undefined>; raw?: string; products?: boolean } = {}
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const auth = o.auth === undefined ? AUTH : o.auth;
  if (auth !== null) headers.Authorization = auth;
  const res = await handleRevenueCatWebhook(
    new Request("https://www.stillwareltd.com/webhooks/revenuecat", {
      method: o.method ?? "POST",
      headers,
      body: (o.method ?? "POST") === "GET" ? undefined : (o.raw ?? JSON.stringify(body)),
    }),
    {
      getDb: () => w.db,
      now: w.clock.now,
      env: o.env ?? { REVENUECAT_WEBHOOK_AUTH: AUTH },
      storeProducts: o.products === false ? undefined : { ...PRODUCTS },
    }
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const rows = async (db: Client) => (await db.execute("SELECT * FROM household_store_entitlements ORDER BY id")).rows;

test("authorisation: missing, wrong and right", async () => {
  const w = await makeWorld();
  assert.equal((await send(w, purchase(), { auth: null })).status, 401);
  assert.equal((await send(w, purchase(), { auth: "" })).status, 401);
  assert.equal((await send(w, purchase(), { auth: "Bearer wrong" })).status, 401);
  assert.equal((await send(w, purchase(), { auth: "Bearer test-only-webhook-secre" })).status, 401); // a prefix
  assert.equal((await send(w, purchase(), { auth: AUTH + "x" })).status, 401);
  assert.equal((await send(w, purchase(), { auth: "Bearer  test-only-webhook-secret" })).status, 401); // two spaces
  assert.equal((await send(w, purchase(), { auth: AUTH.toLowerCase() })).status, 401);
  assert.equal((await send(w, purchase(), { auth: "test-only-webhook-secret" })).status, 401); // without "Bearer "
  assert.equal((await rows(w.db)).length, 0, "nothing was recorded for any of them");

  const ok = await send(w, purchase());
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true, recorded: true });
  assert.equal((await rows(w.db)).length, 1);
});

test("authorisation: the secret is compared in constant time, on digests of equal length", () => {
  assert.equal(sameSecret("a", "a"), true);
  assert.equal(sameSecret("a", "b"), false);
  assert.equal(sameSecret("a", "aa"), false);
  assert.equal(sameSecret("", "a"), false);
});

test("authorisation: a request without it never touches the database", async () => {
  let touched = 0;
  const res = await handleRevenueCatWebhook(
    new Request("https://x/", { method: "POST", body: JSON.stringify(purchase()) }),
    {
      getDb: () => {
        touched++;
        throw new Error("no database in this test");
      },
      now: () => new Date(),
      env: { REVENUECAT_WEBHOOK_AUTH: AUTH },
    }
  );
  assert.equal(res.status, 401);
  assert.equal(touched, 0);
});

test("authorisation: with no secret configured nothing is accepted (500, not an open door)", async () => {
  const w = await makeWorld();
  for (const value of [undefined, ""]) {
    const res = await send(w, purchase(), { env: { REVENUECAT_WEBHOOK_AUTH: value }, auth: "" });
    assert.equal(res.status, 500);
    const res2 = await send(w, purchase(), { env: { REVENUECAT_WEBHOOK_AUTH: value }, auth: null });
    assert.equal(res2.status, 500);
  }
  assert.equal((await rows(w.db)).length, 0);
});

test("only POST; bad JSON is 400", async () => {
  const w = await makeWorld();
  assert.equal((await send(w, null, { method: "GET" })).status, 405);
  assert.equal((await send(w, null, { raw: "{nope" })).status, 400);
  assert.equal((await send(w, null, { raw: "" })).status, 400);
});

test("a purchase of an Every device product is recorded: product id, store, date, transaction id", async () => {
  const w = await makeWorld();
  const res = await send(w, purchase());
  assert.equal(res.status, 200);
  const [row] = await rows(w.db);
  assert.equal(row.product, "rankup");
  assert.equal(row.app_user_id, "$RCAnonymousID:abc123");
  assert.equal(row.product_id, "test_every_device");
  assert.equal(row.store, "app_store");
  assert.equal(row.via, "app_store");
  assert.equal(row.purchased, "2026-10-22", "the UTC date of purchased_at_ms");
  assert.equal(row.transaction_id, "1000000123");
  assert.equal(row.environment, "PRODUCTION");
  assert.equal(row.revoked, 0);
  assert.match(String(row.lid), /^[0-9a-f]{32}$/);
});

test("the upgrade product, the Play store, INITIAL_PURCHASE and the Mac App Store all record", async () => {
  const w = await makeWorld();
  await send(w, purchase({ product_id: "test_every_device_upgrade", store: "PLAY_STORE", transaction_id: "GPA.1", original_transaction_id: null }));
  await send(w, purchase({ type: "INITIAL_PURCHASE", app_user_id: "u2", store: "MAC_APP_STORE", transaction_id: "m1" }));
  const all = await rows(w.db);
  assert.equal(all.length, 2);
  assert.equal(all[0].store, "play");
  assert.equal(all[0].via, "play");
  assert.equal(all[0].product_id, "test_every_device_upgrade");
  assert.equal(all[0].original_transaction_id, null);
  assert.equal(all[1].store, "app_store");
});

test("a sandbox purchase is recorded and marked as one", async () => {
  const w = await makeWorld();
  await send(w, purchase({ environment: "SANDBOX" }));
  assert.equal((await rows(w.db))[0].environment, "SANDBOX");
});

test("the same event twice is recorded once", async () => {
  const w = await makeWorld();
  assert.deepEqual((await send(w, purchase())).body, { ok: true, recorded: true });
  assert.deepEqual((await send(w, purchase())).body, { ok: true, recorded: false });
  assert.equal((await rows(w.db)).length, 1);
});

test("a product that is not Every device, an unlisted store or a half event: ignored with a 200", async () => {
  const w = await makeWorld();
  const ignored = { ok: true, ignored: true };
  assert.deepEqual((await send(w, purchase({ product_id: "rankupchess_premium_unlock" }))).body, ignored);
  assert.deepEqual((await send(w, purchase({ product_id: "__proto__" }))).body, ignored);
  assert.deepEqual((await send(w, purchase({ product_id: "toString" }))).body, ignored);
  assert.deepEqual((await send(w, purchase({ product_id: undefined }))).body, ignored);
  assert.deepEqual((await send(w, purchase({ store: "STRIPE" }))).body, ignored);
  assert.deepEqual((await send(w, purchase({ store: "AMAZON" }))).body, ignored);
  assert.deepEqual((await send(w, purchase({ store: undefined }))).body, ignored);
  assert.deepEqual((await send(w, purchase({ app_user_id: "" }))).body, ignored);
  assert.deepEqual((await send(w, purchase({ transaction_id: null, original_transaction_id: null, id: null }))).body, ignored);
  assert.equal((await rows(w.db)).length, 0);
});

test("with the real, still empty product list nothing is recorded", async () => {
  const w = await makeWorld();
  const res = await send(w, purchase(), { products: false });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, ignored: true });
  assert.equal((await rows(w.db)).length, 0);
  assert.equal(everyDeviceStoreProduct("test_every_device"), null);
  assert.equal(everyDeviceStoreProduct("__proto__"), null);
  assert.equal(everyDeviceStoreProduct(undefined), null);
  assert.equal(everyDeviceStoreProduct("x", { x: "rankup" }), "rankup");
  assert.equal(typeof EVERY_DEVICE_STORE_PRODUCT_IDS, "object");
});

test("every other event type is ignored with a 200", async () => {
  const w = await makeWorld();
  for (const type of ["RENEWAL", "EXPIRATION", "BILLING_ISSUE", "TEST", "PRODUCT_CHANGE", "UNCANCELLATION", "SOMETHING_NEW", undefined]) {
    const res = await send(w, purchase({ type }));
    assert.equal(res.status, 200, String(type));
    assert.deepEqual(res.body, { ok: true, ignored: true });
  }
  // a CANCELLATION that is not a refund (the customer switched auto-renew off) is not one
  const res = await send(w, purchase({ type: "CANCELLATION", cancel_reason: "UNSUBSCRIBE" }));
  assert.equal(res.status, 200);
  assert.equal((await rows(w.db)).length, 0);
  // no event at all
  assert.deepEqual((await send(w, { api_version: "1.0" })).body, { ok: true, ignored: true });
  assert.deepEqual((await send(w, { event: "nope" })).body, { ok: true, ignored: true });
  assert.deepEqual((await send(w, [])).body, { ok: true, ignored: true });
});

test("a refund revokes the licence; the record already issued stays valid", async () => {
  const w = await makeWorld();
  await send(w, purchase());
  const fetchBody = { product: "rankup", appUserId: "$RCAnonymousID:abc123", platform: "ios" };
  const issued = await w.call("fetch", fetchBody);
  assert.equal(issued.status, 200);

  const refund = await send(w, purchase({ type: "CANCELLATION", cancel_reason: "CUSTOMER_SUPPORT" }));
  assert.equal(refund.status, 200);
  assert.deepEqual(refund.body, { ok: true, revoked: 1 });
  assert.equal((await rows(w.db))[0].revoked, 1);

  // no new record, no sign-in, for the revoked licence ...
  assert.equal((await w.call("fetch", fetchBody)).status, 404);
  // ... but what was issued is untouched: still stored, and the signature still verifies
  assert.equal(verifySignedRecord(issued.body, w.key.publicKey), true);
  const kept = await w.db.execute("SELECT COUNT(*) AS n FROM household_issued");
  assert.equal(kept.rows[0].n, 1);
});

test("a refund is found by either transaction id, and a refund of something unknown is a harmless 200", async () => {
  const w = await makeWorld();
  await send(w, purchase({ transaction_id: "T2", original_transaction_id: "O1" }));
  await send(w, purchase({ app_user_id: "u2", transaction_id: "T3", original_transaction_id: "O3" }));

  const byOriginal = await send(w, { event: { type: "REFUND", original_transaction_id: "O1" } });
  assert.deepEqual(byOriginal.body, { ok: true, revoked: 1 });

  const unknown = await send(w, purchase({ type: "CANCELLATION", cancel_reason: "CUSTOMER_SUPPORT", transaction_id: "nope", original_transaction_id: "nope2" }));
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.body, { ok: true, revoked: 0 });

  const state = (await rows(w.db)).map((r) => r.revoked);
  assert.deepEqual(state, [1, 0], "only the refunded purchase was revoked");
});

test("a purchase event delivered again after its refund does not bring the licence back", async () => {
  const w = await makeWorld();
  await send(w, purchase());
  await send(w, purchase({ type: "CANCELLATION", cancel_reason: "CUSTOMER_SUPPORT" }));
  await send(w, purchase());
  const all = await rows(w.db);
  assert.equal(all.length, 1);
  assert.equal(all[0].revoked, 1);
});

test("a transfer moves the purchase (and linked addresses) to the new app user id", async () => {
  const w = await makeWorld();
  await send(w, purchase({ app_user_id: "$RCAnonymousID:anon1" }));
  await addLink(w.db, "rankup", testEmailHash("parent@example.com"), "$RCAnonymousID:anon1");

  const res = await send(w, {
    event: { type: "TRANSFER", transferred_from: ["$RCAnonymousID:anon1"], transferred_to: ["$RCAnonymousID:anon2", "parent-account-77"] },
  });
  assert.deepEqual(res.body, { ok: true, moved: 1 });
  assert.equal((await rows(w.db))[0].app_user_id, "parent-account-77", "a signed-in id is preferred to an anonymous one");

  assert.equal((await w.call("fetch", { product: "rankup", appUserId: "$RCAnonymousID:anon1", platform: "ios" })).status, 404);
  assert.equal((await w.call("fetch", { product: "rankup", appUserId: "parent-account-77", platform: "ios" })).status, 200);

  const links = await w.db.execute("SELECT app_user_id FROM household_email_links");
  assert.deepEqual(links.rows.map((r) => r.app_user_id), ["parent-account-77"]);
  // the linked address still signs in
  await w.call("signinStart", { product: "rankup", email: "parent@example.com" });
  assert.equal(w.sent.length, 1);
});

test("a transfer between two ids that both have a link and a purchase keeps both purchases", async () => {
  const w = await makeWorld();
  await send(w, purchase({ app_user_id: "a", transaction_id: "ta" }));
  await send(w, purchase({ app_user_id: "b", transaction_id: "tb" }));
  await addLink(w.db, "rankup", testEmailHash("x@example.com"), "a");
  await addLink(w.db, "rankup", testEmailHash("x@example.com"), "b");
  const res = await send(w, { event: { type: "TRANSFER", transferred_from: ["a"], transferred_to: ["b"] } });
  assert.deepEqual(res.body, { ok: true, moved: 1 });
  assert.deepEqual((await rows(w.db)).map((r) => r.app_user_id), ["b", "b"]);
  const links = await w.db.execute("SELECT app_user_id FROM household_email_links");
  assert.deepEqual(links.rows.map((r) => r.app_user_id), ["b"]);
});

test("a malformed transfer is ignored with a 200", async () => {
  const w = await makeWorld();
  await send(w, purchase());
  for (const event of [
    { type: "TRANSFER" },
    { type: "TRANSFER", transferred_from: "x", transferred_to: "y" },
    { type: "TRANSFER", transferred_from: [], transferred_to: ["y"] },
    { type: "TRANSFER", transferred_from: ["x"], transferred_to: [] },
  ]) {
    const res = await send(w, { event });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, ignored: true });
  }
  assert.equal((await rows(w.db))[0].app_user_id, "$RCAnonymousID:abc123");
});

test("a database failure is a 500, so RevenueCat tries again", async () => {
  const res = await handleRevenueCatWebhook(
    new Request("https://x/", { method: "POST", headers: { Authorization: AUTH }, body: JSON.stringify(purchase()) }),
    {
      getDb: () => {
        throw new Error("database is down");
      },
      now: () => new Date(),
      env: { REVENUECAT_WEBHOOK_AUTH: AUTH },
      storeProducts: { ...PRODUCTS },
    }
  );
  assert.equal(res.status, 500);
});

test("storeOf maps the stores the licence covers and no other", () => {
  assert.equal(storeOf("APP_STORE"), "app_store");
  assert.equal(storeOf("MAC_APP_STORE"), "app_store");
  assert.equal(storeOf("PLAY_STORE"), "play");
  for (const other of ["STRIPE", "AMAZON", "PROMOTIONAL", "app_store", "", null, 3]) assert.equal(storeOf(other), null);
});
