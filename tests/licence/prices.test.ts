import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { handlePrices, priceIdsFor, productTables, type PriceTables, type PricesDeps } from "../../netlify/functions/lib/household-prices.js";
import { paddlePreview, previewWith, type PreviewFn, type PricingPreviewClient } from "../../netlify/functions/lib/paddle-prices.js";
import { PRICE_ID_TO_PLATFORM, PRICE_ID_TO_PRODUCT } from "../../netlify/functions/lib/products.js";
import { Clock, dumpHouseholdTables, freshDb } from "./helpers.js";

// The `prices` endpoint: the buyer's own country price per tier, from Paddle's pricing preview
// (faked here), cached an hour per country and platform, with the IP address passed on and never
// kept. The Every device price ids do not exist until KL.3, so the tests make some up.

const WINDOWS = "pri_01knztpnwdqxx8ecnbrjt4zkzq";
const MACOS = "pri_01m194cc17phxmgqdqs737mw2p";
const EVERY = "pri_test_every_device";
const UPGRADE = "pri_test_upgrade";
const IP = "203.0.113.97";

const TABLES: PriceTables = {
  perPlatform: { ...PRICE_ID_TO_PLATFORM },
  priceToProduct: { ...PRICE_ID_TO_PRODUCT, [EVERY]: "rankup", [UPGRADE]: "rankup" },
  everyDevice: [EVERY],
  upgrade: [UPGRADE],
};

const GB: Record<string, string> = { [EVERY]: "£19.99", [WINDOWS]: "£11.99", [MACOS]: "£12.49", [UPGRADE]: "£7.99" };
const DE: Record<string, string> = { [EVERY]: "19,99 €", [WINDOWS]: "11,99 €", [MACOS]: "12,49 €", [UPGRADE]: "7,99 €" };

interface Call {
  priceIds: string[];
  ip: string | null;
  country: string;
}

async function setup(over: Partial<PricesDeps> = {}) {
  const db = await freshDb();
  const clock = new Clock();
  const calls: Call[] = [];
  const preview: PreviewFn = async (q) => {
    calls.push({ priceIds: [...q.priceIds], ip: q.ip, country: q.country });
    const table = q.country === "DE" ? DE : GB;
    const totals: Record<string, string> = {};
    for (const id of q.priceIds) if (table[id]) totals[id] = table[id];
    return { currency: q.country === "DE" ? "EUR" : "GBP", totals };
  };
  const deps: PricesDeps = { getDb: () => db, now: clock.now, preview, tables: TABLES, ...over };
  const ask = async (
    body: unknown,
    caller: { country?: string | null; ip?: string | null } = { country: "GB", ip: IP },
    o: { method?: string; raw?: string } = {}
  ) => {
    const method = o.method ?? "POST";
    const res = await handlePrices(
      new Request("https://www.stillwareltd.com/api/household/prices", {
        method,
        body: method === "GET" ? undefined : (o.raw ?? JSON.stringify(body)),
      }),
      deps,
      caller
    );
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: parsed, text, headers: res.headers };
  };
  return { db, clock, calls, deps, ask };
}

const WIN = { product: "rankup", platform: "windows" };

test("the shape: country, currency and the strings Paddle formatted, in the contract's order", async () => {
  const w = await setup();
  const res = await w.ask(WIN);
  assert.equal(res.status, 200);
  assert.equal(
    res.text,
    '{"country":"GB","currency":"GBP","prices":{"every_device":"£19.99","this_device":"£11.99","upgrade":"£7.99"}}'
  );
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  // Paddle's own formatting is passed through untouched, whatever the currency looks like
  const de = await w.ask(WIN, { country: "DE", ip: "198.51.100.5" });
  assert.equal(de.body.currency, "EUR");
  assert.deepEqual(de.body.prices, { every_device: "19,99 €", this_device: "11,99 €", upgrade: "7,99 €" });
  assert.equal(de.body.country, "DE");
});

test("each platform: Windows and Linux the Windows price, Mac its own, web no this_device", async () => {
  const w = await setup();
  const windows = await w.ask({ product: "rankup", platform: "windows" });
  const linux = await w.ask({ product: "rankup", platform: "linux" });
  const mac = await w.ask({ product: "rankup", platform: "macos" });
  const web = await w.ask({ product: "rankup", platform: "web" });

  assert.equal(windows.body.prices.this_device, "£11.99");
  assert.equal(linux.body.prices.this_device, "£11.99");
  assert.equal(mac.body.prices.this_device, "£12.49");
  assert.equal("this_device" in web.body.prices, false);
  assert.deepEqual(web.body.prices, { every_device: "£19.99", upgrade: "£7.99" });
  for (const r of [windows, linux, mac, web]) {
    assert.equal(r.body.prices.every_device, "£19.99");
    assert.equal(r.body.prices.upgrade, "£7.99");
  }
  // only the prices products.ts names were asked for, and web never asked for a per-platform one
  assert.deepEqual(w.calls.map((c) => c.priceIds), [
    [EVERY, WINDOWS, UPGRADE],
    [EVERY, WINDOWS, UPGRADE],
    [EVERY, MACOS, UPGRADE],
    [EVERY, UPGRADE],
  ]);
});

test("priceIdsFor: from the tables, for this product only", () => {
  assert.deepEqual(priceIdsFor("rankup", "windows", TABLES), { every_device: EVERY, this_device: WINDOWS, upgrade: UPGRADE });
  assert.deepEqual(priceIdsFor("rankup", "macos", TABLES), { every_device: EVERY, this_device: MACOS, upgrade: UPGRADE });
  assert.deepEqual(priceIdsFor("rankup", "web", TABLES), { every_device: EVERY, upgrade: UPGRADE });
  // a price id that belongs to another product is not asked for
  const other: PriceTables = { ...TABLES, priceToProduct: { ...TABLES.priceToProduct, [EVERY]: "zeroed", [WINDOWS]: "zeroed" } };
  assert.deepEqual(priceIdsFor("rankup", "windows", other), { upgrade: UPGRADE });
  // the real tables, as they are today: the two per-platform prices and nothing invented
  const real = productTables();
  assert.equal(priceIdsFor("rankup", "windows", real).this_device, WINDOWS);
  assert.equal(priceIdsFor("rankup", "linux", real).this_device, WINDOWS);
  assert.equal(priceIdsFor("rankup", "macos", real).this_device, MACOS);
  assert.equal("this_device" in priceIdsFor("rankup", "web", real), false);
});

test("a price with no id is left out: nothing invented, and nothing to ask means no call", async () => {
  const w = await setup({ tables: { ...TABLES, everyDevice: [], upgrade: [] } });
  const win = await w.ask(WIN);
  assert.equal(win.status, 200);
  assert.deepEqual(win.body.prices, { this_device: "£11.99" });
  assert.deepEqual(w.calls[0].priceIds, [WINDOWS]);

  const web = await w.ask({ product: "rankup", platform: "web" });
  assert.equal(web.status, 200);
  assert.deepEqual(web.body, { country: "GB", currency: null, prices: {} });
  assert.equal(w.calls.length, 1, "web with no Every device prices yet asks Paddle nothing");

  // only the upgrade price missing
  const w2 = await setup({ tables: { ...TABLES, upgrade: [] } });
  assert.deepEqual((await w2.ask({ product: "rankup", platform: "macos" })).body.prices, { every_device: "£19.99", this_device: "£12.49" });
});

test("a price Paddle does not return is left out of the answer", async () => {
  const w = await setup({
    preview: async (q) => ({ currency: "GBP", totals: Object.fromEntries(q.priceIds.filter((id) => id !== UPGRADE).map((id) => [id, GB[id]])) }),
  });
  const res = await w.ask(WIN);
  assert.deepEqual(res.body.prices, { every_device: "£19.99", this_device: "£11.99" });
  assert.equal(res.text.includes("null"), false);
});

test("the cache: a second ask makes no Paddle call; another country or platform does", async () => {
  const w = await setup();
  const first = await w.ask(WIN);
  const second = await w.ask(WIN, { country: "GB", ip: "198.51.100.200" }); // another visitor, same country
  assert.equal(second.text, first.text);
  assert.equal(w.calls.length, 1);

  await w.ask(WIN, { country: "DE", ip: IP });
  assert.equal(w.calls.length, 2, "another country");
  await w.ask({ product: "rankup", platform: "macos" });
  assert.equal(w.calls.length, 3, "another platform");
  await w.ask({ product: "rankup", platform: "linux" });
  assert.equal(w.calls.length, 4, "linux has its own entry");
  await w.ask(WIN);
  await w.ask({ product: "rankup", platform: "macos" });
  assert.equal(w.calls.length, 4);

  const rows = (await w.db.execute("SELECT product, country, platform FROM household_price_cache ORDER BY country, platform")).rows;
  assert.deepEqual(rows.map((r) => `${r.country}/${r.platform}`), ["DE/windows", "GB/linux", "GB/macos", "GB/windows"]);
});

test("the cache lasts an hour: used at 59 minutes, refreshed after 61", async () => {
  const w = await setup();
  await w.ask(WIN);
  w.clock.minutes(59);
  await w.ask(WIN);
  assert.equal(w.calls.length, 1);

  // Paddle changed a price meanwhile: the refresh shows it
  GB[WINDOWS] = "£12.99";
  try {
    w.clock.minutes(2); // 61 minutes after the first ask
    const refreshed = await w.ask(WIN);
    assert.equal(w.calls.length, 2);
    assert.equal(refreshed.body.prices.this_device, "£12.99");
    // and the refresh starts a new hour
    w.clock.minutes(30);
    assert.equal((await w.ask(WIN)).body.prices.this_device, "£12.99");
    assert.equal(w.calls.length, 2);
  } finally {
    GB[WINDOWS] = "£11.99";
  }
  assert.equal((await w.db.execute("SELECT COUNT(*) AS n FROM household_price_cache")).rows[0].n, 1, "one row per key, replaced");
});

test("the IP address goes to Paddle's preview, and is never stored, logged or returned", async () => {
  const lines: string[] = [];
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  console.log = console.warn = console.error = console.info = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    const w = await setup();
    const ok = await w.ask(WIN);
    await w.ask(WIN); // a cache hit
    assert.equal(w.calls[0].ip, IP, "Paddle was given the address");
    assert.equal(w.calls[0].country, "GB");
    assert.equal(ok.text.includes(IP), false);

    const { text } = await dumpHouseholdTables(w.db);
    assert.equal(text.includes(IP), false, "nothing stored");
    const cache = await w.db.execute("SELECT * FROM household_price_cache");
    assert.equal(JSON.stringify(cache.rows).includes(IP), false);
    assert.deepEqual(Object.keys(cache.rows[0]).sort(), ["body", "country", "fetched_at", "platform", "product"]);

    // a failure whose error message carries the address
    const failing = await setup({
      preview: async (q) => {
        throw new Error(`invalid customer_ip_address ${q.ip}`);
      },
    });
    const down = await failing.ask(WIN);
    assert.equal(down.status, 503);
    assert.equal(down.text.includes(IP), false);
    assert.equal((await dumpHouseholdTables(failing.db)).text.includes(IP), false);
  } finally {
    Object.assign(console, saved);
  }
  assert.ok(lines.length > 0, "the failure was logged");
  for (const line of lines) assert.equal(line.includes(IP), false, line);
});

test("with no IP address Paddle is given the country alone", async () => {
  const w = await setup();
  await w.ask(WIN, { country: "gb", ip: null });
  assert.deepEqual(w.calls[0], { priceIds: [EVERY, WINDOWS, UPGRADE], ip: null, country: "GB" });
  const blank = await setup();
  await blank.ask(WIN, { country: "GB", ip: "  " });
  assert.equal(blank.calls[0].ip, null);
});

test("Paddle down (an error, or no answer within the timeout): 503 try_later, nothing cached, and it recovers", async () => {
  let mode: "down" | "hang" | "up" = "down";
  const w = await setup({
    timeoutMs: 40,
    preview: async (q) => {
      if (mode === "down") throw new Error("Paddle is down");
      if (mode === "hang") return new Promise(() => {});
      return { currency: "GBP", totals: Object.fromEntries(q.priceIds.map((id) => [id, GB[id]])) };
    },
  });
  const err = console.error;
  console.error = () => {};
  try {
    const down = await w.ask(WIN);
    assert.equal(down.status, 503);
    assert.deepEqual(down.body, { error: "try_later" });
    mode = "hang";
    const started = Date.now();
    const slow = await w.ask(WIN);
    assert.equal(slow.status, 503);
    assert.deepEqual(slow.body, { error: "try_later" });
    assert.ok(Date.now() - started < 1500, "answered at the timeout, not when Paddle gave up");
  } finally {
    console.error = err;
  }
  assert.equal((await w.db.execute("SELECT COUNT(*) AS n FROM household_price_cache")).rows[0].n, 0);
  mode = "up";
  assert.equal((await w.ask(WIN)).status, 200);
});

test("the timeout is 3 seconds by default", async () => {
  const mod = await import("../../netlify/functions/lib/household-prices.js");
  assert.equal(mod.PREVIEW_TIMEOUT_MS, 3000);
  assert.equal(mod.PRICE_CACHE_MINUTES, 60);
});

test("a bad platform or product is 400 bad_request, and a bad body too", async () => {
  const w = await setup();
  const bad: unknown[] = [
    { product: "rankup", platform: "ios" },
    { product: "rankup", platform: "android" },
    { product: "rankup", platform: "WINDOWS" },
    { product: "rankup", platform: "" },
    { product: "rankup", platform: 5 },
    { product: "rankup", platform: ["web"] },
    { product: "rankup" },
    { platform: "web" },
    { product: "zeroed", platform: "web" },
    { product: "chess", platform: "windows" },
    { product: 7, platform: "windows" },
    {},
    [],
    null,
    "web",
  ];
  for (const body of bad) {
    const res = await w.ask(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual(res.body, { error: "bad_request" });
  }
  for (const raw of ["", "{not json", "x".repeat(5000)]) {
    assert.equal((await w.ask(null, undefined, { raw })).status, 400);
  }
  assert.equal(w.calls.length, 0, "Paddle was asked about none of them");
  assert.equal((await w.ask(null, undefined, { method: "GET" })).status, 405);
});

test("no country from the geolocation: 503 try_later, not a guess", async () => {
  const w = await setup();
  for (const country of [undefined, null, "", "X", "GBR", "1A"]) {
    const res = await w.ask(WIN, { country, ip: IP });
    assert.equal(res.status, 503, String(country));
    assert.deepEqual(res.body, { error: "try_later" });
  }
  assert.equal(w.calls.length, 0);
});

test("a database that is not there costs only the cache", async () => {
  const w = await setup({
    getDb: () => {
      throw new Error("Missing TURSO_DATABASE_URL");
    },
  });
  const err = console.error;
  console.error = () => {};
  try {
    const res = await w.ask(WIN);
    assert.equal(res.status, 200);
    assert.equal(res.body.prices.this_device, "£11.99");
    await w.ask(WIN);
    assert.equal(w.calls.length, 2, "no cache, so Paddle is asked each time");
  } finally {
    console.error = err;
  }
});

// ---------------------------------------------------------------------------------------------
// The SDK side: what is sent to Paddle, and how its answer is read

function fakeClient(answer: unknown, seen: unknown[]): PricingPreviewClient {
  return {
    pricingPreview: {
      async preview(body) {
        seen.push(body);
        return answer as never;
      },
    },
  };
}

const lineItem = (id: string, total: string) => ({ price: { id }, formattedTotals: { total, subtotal: "x", tax: "y", discount: "z" }, formattedUnitTotals: { total: "wrong" } });

test("previewWith: the IP address goes in customerIpAddress, else the country in address; totals are Paddle's formatted ones", async () => {
  const seen: any[] = [];
  const client = fakeClient({ currencyCode: "GBP", details: { lineItems: [lineItem(EVERY, "£19.99"), lineItem(WINDOWS, "£11.99")] } }, seen);

  const withIp = await previewWith(client, { priceIds: [EVERY, WINDOWS], ip: IP, country: "GB" });
  assert.deepEqual(seen[0], { items: [{ priceId: EVERY, quantity: 1 }, { priceId: WINDOWS, quantity: 1 }], customerIpAddress: IP });
  assert.deepEqual(withIp, { currency: "GBP", totals: { [EVERY]: "£19.99", [WINDOWS]: "£11.99" } });

  await previewWith(client, { priceIds: [EVERY], ip: null, country: "GB" });
  assert.deepEqual(seen[1], { items: [{ priceId: EVERY, quantity: 1 }], address: { countryCode: "GB" } });

  const empty = await previewWith(fakeClient({ currencyCode: "USD", details: { lineItems: [{ price: { id: "p" }, formattedTotals: { total: "" } }] } }, []), {
    priceIds: ["p"], ip: null, country: "US",
  });
  assert.deepEqual(empty, { currency: "USD", totals: {} });
});

/** A stand-in for Paddle's API: records each request, answers with a canned status and body. */
async function fakePaddleApi(reply: (req: { url: string; method: string; headers: http.IncomingHttpHeaders; body: any }) => { status: number; body: unknown }) {
  const requests: Array<{ url: string; method: string; headers: http.IncomingHttpHeaders; body: any }> = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const seen = { url: String(req.url), method: String(req.method), headers: req.headers, body: raw ? JSON.parse(raw) : null };
      requests.push(seen);
      const out = reply(seen);
      res.writeHead(out.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, requests, close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }) };
}

const wireLine = (id: string, total: string) => ({
  price: {
    id, product_id: "pro_1", description: "test", type: "standard", name: null, billing_cycle: null, trial_period: null,
    tax_mode: "account_setting", unit_price: { amount: "1999", currency_code: "GBP" }, unit_price_overrides: [],
    quantity: { minimum: 1, maximum: 1 }, status: "active", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
    custom_data: null, import_meta: null,
  },
  quantity: 1,
  tax_rate: "0.2",
  unit_totals: { subtotal: "1666", discount: "0", tax: "333", total: "1999" },
  formatted_unit_totals: { subtotal: "£16.66", discount: "£0.00", tax: "£3.33", total: "£19.99" },
  totals: { subtotal: "1666", discount: "0", tax: "333", total: "1999" },
  formatted_totals: { subtotal: "£16.66", discount: "£0.00", tax: "£3.33", total },
  product: {
    id: "pro_1", name: "RankUp Chess", type: "standard", description: null, tax_category: "standard", image_url: null,
    custom_data: null, status: "active", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", import_meta: null,
  },
  discounts: [],
});

test("the real SDK against a stand-in Paddle API: the request carries the IP, the answer is read, the SDK logs nothing", async () => {
  const api = await fakePaddleApi(() => ({
    status: 200,
    body: {
      data: {
        currency_code: "GBP", customer_ip_address: IP, address: { country_code: "GB", postal_code: null },
        details: { line_items: [wireLine(EVERY, "£19.99"), wireLine(WINDOWS, "£11.99")] }, available_payment_methods: ["card"],
      },
      meta: { request_id: "req_1" },
    },
  }));
  const logged: string[] = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  try {
    const w = await setup({ preview: paddlePreview("test_api_key_not_real", api.url) });
    const res = await w.ask(WIN);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { country: "GB", currency: "GBP", prices: { every_device: "£19.99", this_device: "£11.99" } });

    assert.equal(api.requests.length, 1);
    const r = api.requests[0];
    assert.equal(r.method, "POST");
    assert.equal(r.url, "/pricing-preview");
    assert.equal(r.headers.authorization, "bearer test_api_key_not_real");
    assert.equal(r.body.customer_ip_address, IP);
    assert.deepEqual(r.body.items, [
      { price_id: EVERY, quantity: 1 }, { price_id: WINDOWS, quantity: 1 }, { price_id: UPGRADE, quantity: 1 },
    ]);
    assert.equal("address" in r.body, false, "the IP is what localises; no address is sent with it");

    // and with no IP, the country goes in the address
    const noIp = await setup({ preview: paddlePreview("test_api_key_not_real", api.url) });
    await noIp.ask(WIN, { country: "DE", ip: null });
    assert.deepEqual(api.requests[1].body.address, { country_code: "DE" });
    assert.equal("customer_ip_address" in api.requests[1].body, false);
  } finally {
    Object.assign(console, saved);
    await api.close();
  }
  for (const line of logged) assert.equal(line.includes(IP), false, line);
  assert.equal(logged.some((l) => l.includes("[Paddle]")), false, "the SDK's request log is off");
});

test("the real SDK: Paddle refuses the request (an error body with detail naming the address): 503, and the detail is not logged", async () => {
  const api = await fakePaddleApi(() => ({
    status: 400,
    body: { error: { type: "request_error", code: "invalid_field", detail: `customer_ip_address ${IP} is not routable`, documentation_url: "x" }, meta: { request_id: "r" } },
  }));
  const lines: string[] = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    const w = await setup({ preview: paddlePreview("test_api_key_not_real", api.url) });
    const res = await w.ask(WIN);
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { error: "try_later" });
    assert.equal((await w.db.execute("SELECT COUNT(*) AS n FROM household_price_cache")).rows[0].n, 0);
  } finally {
    Object.assign(console, saved);
    await api.close();
  }
  assert.ok(lines.some((l) => l.includes("invalid_field")), "the short error code is logged");
  for (const line of lines) assert.equal(line.includes(IP), false, line);
});

test("the real SDK with no API key configured: 503 try_later", async () => {
  const w = await setup({ preview: paddlePreview(undefined) });
  const err = console.error;
  console.error = () => {};
  try {
    assert.equal((await w.ask(WIN)).status, 503);
  } finally {
    console.error = err;
  }
});
