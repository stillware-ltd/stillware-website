import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { householdCodeMessage } from "../../netlify/functions/lib/email.js";
import { PRODUCTS } from "../../netlify/functions/lib/products.js";

// The files Netlify actually runs: each function's default export, the redirects in
// netlify.toml that reach it, and the mail text.

const root = new URL("../../", import.meta.url);
const FILES = {
  fetch: "household-fetch",
  signinStart: "household-signin-start",
  signinVerify: "household-signin-verify",
  linkStart: "household-link-start",
  linkVerify: "household-link-verify",
};
const ENV_KEYS = [
  "HOUSEHOLD_ENABLED", "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "REVENUECAT_WEBHOOK_AUTH",
];
const saved: Record<string, string | undefined> = {};

before(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
after(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const post = (body: unknown = {}) =>
  new Request("https://www.stillwareltd.com/x", { method: "POST", body: JSON.stringify(body) });
const ctx = { ip: "203.0.113.5" } as never;

test("each household function file: 404 {error:off} with no flag, no database and no secret anywhere", async () => {
  for (const file of Object.values(FILES)) {
    const mod = await import(`../../netlify/functions/${file}.js`);
    assert.equal(typeof mod.default, "function", file);
    const res = await mod.default(post({ product: "rankup" }), ctx);
    assert.equal(res.status, 404, file);
    assert.deepEqual(await res.json(), { error: "off" });
  }
});

test("each household function file: with the flag on but no database configured, a 500 and no crash", async () => {
  process.env.HOUSEHOLD_ENABLED = "1";
  try {
    for (const file of Object.values(FILES)) {
      const mod = await import(`../../netlify/functions/${file}.js`);
      const res = await mod.default(post({ product: "rankup", email: "a@b.co", appUserId: "u", platform: "ios", code: "123456" }), ctx);
      assert.equal(res.status, 500, file);
      assert.deepEqual(await res.json(), { error: "server_error" });
    }
  } finally {
    delete process.env.HOUSEHOLD_ENABLED;
  }
});

test("household-prices file: not behind the flag (a bad body is a 400, not a 404 off)", async () => {
  const mod = await import("../../netlify/functions/household-prices.js");
  assert.equal(typeof mod.default, "function");
  delete process.env.HOUSEHOLD_ENABLED;
  const geo = { geo: { country: { code: "GB" } }, ip: "203.0.113.5" } as never;
  const bad = await mod.default(post({ product: "rankup", platform: "ios" }), geo);
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: "bad_request" });
  // and a good body with nothing to ask for (the Every device prices do not exist yet; web has no per-platform one)
  const prices = await import("../../netlify/functions/lib/products.js");
  if (prices.EVERY_DEVICE_PADDLE_PRICE_IDS.length === 0 && prices.EVERY_DEVICE_UPGRADE_PADDLE_PRICE_IDS.length === 0) {
    const web = await mod.default(post({ product: "rankup", platform: "web" }), geo);
    assert.equal(web.status, 200);
    assert.deepEqual(await web.json(), { country: "GB", currency: null, prices: {} });
  }
});

test("revenuecat-webhook file: no secret configured is 500; a request without it is 401", async () => {
  const mod = await import("../../netlify/functions/revenuecat-webhook.js");
  assert.equal(typeof mod.default, "function");
  assert.equal((await mod.default(post({ event: {} }), ctx)).status, 500);
  process.env.REVENUECAT_WEBHOOK_AUTH = "Bearer not-a-real-secret";
  try {
    assert.equal((await mod.default(post({ event: {} }), ctx)).status, 401);
  } finally {
    delete process.env.REVENUECAT_WEBHOOK_AUTH;
  }
});

test("netlify.toml: clean URLs for the five endpoints and the webhook, above the host rules", () => {
  const toml = readFileSync(new URL("netlify.toml", root), "utf8");
  const redirects = [...toml.matchAll(/\[\[redirects\]\]\s+from = "([^"]+)"\s+to = "([^"]+)"\s+status = (\d+)/g)].map(
    (m) => ({ from: m[1], to: m[2], status: Number(m[3]), at: m.index ?? 0 })
  );
  const expected: Array<[string, string]> = [
    ["/api/household/fetch", "household-fetch"],
    ["/api/household/signin/start", "household-signin-start"],
    ["/api/household/signin/verify", "household-signin-verify"],
    ["/api/household/link/start", "household-link-start"],
    ["/api/household/link/verify", "household-link-verify"],
    ["/api/household/prices", "household-prices"],
    ["/webhooks/revenuecat", "revenuecat-webhook"],
  ];
  const firstHostRule = redirects.find((r) => r.from.startsWith("http://") || r.from.startsWith("https://"));
  assert.ok(firstHostRule, "the host rules are still there");
  for (const [from, fn] of expected) {
    const r = redirects.find((x) => x.from === from);
    assert.ok(r, `${from} has a rule`);
    assert.equal(r.to, `/.netlify/functions/${fn}`);
    assert.equal(r.status, 200, "a rewrite, not a redirect (a POST must not be redirected)");
    assert.ok(existsSync(new URL(`netlify/functions/${fn}.ts`, root)), `${fn}.ts exists`);
    assert.ok(r.at < firstHostRule.at, `${from} is above the host rules`);
  }
  // the existing licence URLs are still where they were
  for (const from of ["/webhooks/paddle", "/api/licenses/activate", "/api/licenses/resend-key"]) {
    assert.ok(redirects.some((r) => r.from === from), from);
  }
});

test("the mail: plain words, the code and the 10 minutes, nothing else", () => {
  const signin = householdCodeMessage(PRODUCTS.rankup, "signin", "123456");
  assert.equal(signin.subject, "Your RankUp Chess sign-in code");
  assert.equal(
    signin.text,
    "Your RankUp Chess sign-in code is 123456. It works for 10 minutes.\n\n" +
      "If you did not ask for this, you can ignore this email.\n"
  );
  const link = householdCodeMessage(PRODUCTS.rankup, "link", "654321");
  assert.match(link.text, /^Your RankUp Chess confirmation code is 654321\. It works for 10 minutes\./);
  for (const m of [signin, link]) {
    assert.equal(/https?:|<|price|\$|offer|buy/i.test(m.text), false, "no links, markup or marketing");
  }
});

test("sendHouseholdCodeEmail: sends the text mail through Resend's API, and throws when Resend refuses it", async () => {
  const { sendHouseholdCodeEmail } = await import("../../netlify/functions/lib/email.js");
  const realFetch = globalThis.fetch;
  const savedKey = process.env.RESEND_API_KEY;
  const calls: Array<{ url: string; body: any }> = [];
  let reply: Response = new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
  process.env.RESEND_API_KEY = "re_test_key_not_real";
  globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return reply;
  }) as typeof fetch;
  try {
    await sendHouseholdCodeEmail("parent@example.com", "123456", PRODUCTS.rankup, "signin");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /resend\.com\/emails$/);
    assert.equal(calls[0].body.to, "parent@example.com");
    assert.equal(calls[0].body.subject, "Your RankUp Chess sign-in code");
    assert.match(calls[0].body.text, /^Your RankUp Chess sign-in code is 123456\. It works for 10 minutes\./);
    assert.equal("html" in calls[0].body, false, "plain text only");

    reply = new Response(JSON.stringify({ name: "validation_error", message: "bad", statusCode: 422 }), { status: 422 });
    await assert.rejects(sendHouseholdCodeEmail("parent@example.com", "123456", PRODUCTS.rankup, "link"), /Resend refused/);
  } finally {
    globalThis.fetch = realFetch;
    if (savedKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedKey;
  }
});
