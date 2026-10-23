import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { verifySignedRecord } from "../../netlify/functions/lib/household-record.js";
import { getDb } from "../../netlify/functions/lib/db.js";
import { freshDb, lastDbUrl, makeKey } from "./helpers.js";

// The real household-fetch.ts, wired as in production (productionHandlers), against a local
// database file, with only the network stubbed: it checks that REVENUECAT_SECRET_API_KEY and
// HOUSEHOLD_UPGRADE_BEFORE switch the lookup on and off, and that the key goes only into the
// Authorization header of the call to RevenueCat.

const key = makeKey("rk-test-1");
const SECRET = "sk_test_NOT_A_REAL_KEY_for_wiring_test";
const NAMES = [
  "HOUSEHOLD_ENABLED", "HOUSEHOLD_SIGNING_KEY", "HOUSEHOLD_SIGNING_KID", "HOUSEHOLD_UPGRADE_BEFORE",
  "HOUSEHOLD_LEGACY_ENTITLEMENT", "REVENUECAT_SECRET_API_KEY", "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN",
];
const saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
let handler: (req: Request, ctx: never) => Promise<Response>;
const seen: Array<{ url: string; auth: string | null }> = [];
let counter = 0;

const subscriberBody = {
  subscriber: {
    entitlements: {
      rankupchess_premium_unlock: {
        expires_date: null, product_identifier: "rankupchess_premium_unlock", purchase_date: "2026-03-14T18:20:11Z",
      },
    },
    non_subscriptions: {
      rankupchess_premium_unlock: [
        { id: "x1", is_sandbox: false, original_purchase_date: "2026-03-14T18:20:11Z", store: "app_store", store_transaction_id: "2000000555" },
      ],
    },
  },
};

before(async () => {
  for (const k of NAMES) saved[k] = process.env[k];
  await freshDb();
  process.env.TURSO_DATABASE_URL = lastDbUrl();
  process.env.TURSO_AUTH_TOKEN = "test-token-not-real";
  handler = (await import("../../netlify/functions/household-fetch.js")).default as never;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify(subscriberBody), { status: 200 });
  }) as typeof fetch;
});

after(() => {
  try {
    getDb().close(); // the handlers' own client (see helpers.ts on why databases are closed)
  } catch {
    /* never opened */
  }
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(() => {
  seen.length = 0;
  for (const k of NAMES.slice(0, 6)) delete process.env[k];
  process.env.HOUSEHOLD_ENABLED = "1";
  process.env.HOUSEHOLD_SIGNING_KEY = key.privateBase64;
  process.env.HOUSEHOLD_SIGNING_KID = "rk-test-1";
});

const call = async (appUserId: string) => {
  const res = await handler(
    new Request("https://www.stillwareltd.com/api/household/fetch", {
      method: "POST",
      headers: { "x-nf-client-connection-ip": "203.0.113.77" },
      body: JSON.stringify({ product: "rankup", appUserId, platform: "ios" }),
    }),
    { ip: "203.0.113.77" } as never
  );
  return { status: res.status, text: await res.text() };
};

test("with the key and the date set, an earlier buyer is upgraded, and only the first fetch calls RevenueCat", async () => {
  process.env.REVENUECAT_SECRET_API_KEY = ` ${SECRET} `;
  process.env.HOUSEHOLD_UPGRADE_BEFORE = "2026-10-20";
  const id = `wired-${++counter}`;
  const first = await call(id);
  assert.equal(first.status, 200);
  const signed = JSON.parse(first.text);
  assert.equal(signed.record.via, "upgrade");
  assert.equal(signed.record.purchased, "2026-03-14");
  assert.equal(verifySignedRecord(signed, key.publicKey), true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, `https://api.revenuecat.com/v1/subscribers/${id}`);
  assert.equal(seen[0].auth, `Bearer ${SECRET}`);
  assert.equal(first.text.includes(SECRET), false);

  assert.equal((await call(id)).status, 200);
  assert.equal(seen.length, 1, "the second fetch found the stored entitlement");
});

test("without REVENUECAT_SECRET_API_KEY: 404 none and no call", async () => {
  process.env.HOUSEHOLD_UPGRADE_BEFORE = "2026-10-20";
  const res = await call(`wired-${++counter}`);
  assert.equal(res.status, 404);
  assert.equal(res.text, JSON.stringify({ error: "none" }));
  assert.equal(seen.length, 0);
});

test("without HOUSEHOLD_UPGRADE_BEFORE: 404 none and no call, key or not", async () => {
  process.env.REVENUECAT_SECRET_API_KEY = SECRET;
  const res = await call(`wired-${++counter}`);
  assert.equal(res.status, 404);
  assert.equal(seen.length, 0);
});

test("a purchase on the switch date or later is not upgraded", async () => {
  process.env.REVENUECAT_SECRET_API_KEY = SECRET;
  process.env.HOUSEHOLD_UPGRADE_BEFORE = "2026-03-14";
  const res = await call(`wired-${++counter}`);
  assert.equal(res.status, 404);
  assert.equal(seen.length, 1);
});
