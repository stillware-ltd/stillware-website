import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Client } from "@libsql/client";
import { hashLicenseKey } from "../../netlify/functions/lib/crypto.js";
import { getDb } from "../../netlify/functions/lib/db.js";
import {
  DEFAULT_PRODUCT_FOR_LEGACY_CLIENTS,
  HOUSEHOLD_PRODUCTS,
  PRICE_ID_TO_PLATFORM,
  PRICE_ID_TO_PRODUCT,
  PRODUCTS,
  TRIAL_PRODUCTS,
  isHouseholdProduct,
  isTrialProduct,
  isValidProduct,
  productFromTransactionItems,
} from "../../netlify/functions/lib/products.js";
import { resendKeys, type Purchase } from "../../netlify/functions/lib/resend-key.js";
import { freshDb, lastDbUrl, makeKey } from "./helpers.js";

// The product `qtc` (Quote-to-Cash, 2026-11-13). Before it was known, a request naming `qtc` was
// treated as Zeroed's, so a Zeroed key unlocked Quote-to-Cash. These tests hold the fix: a `qtc`
// request looks only among `qtc` licences. They also hold what must not move: Zeroed, RankUp
// Chess, a request with no product and a request with a product nobody knows.
//
// The handlers are the real ones, run against a local database file that their getDb() finds
// through TURSO_DATABASE_URL (as activate.test.ts and validate.test.ts do).

const key = makeKey("rk-test-1");
const KEYS = ["HOUSEHOLD_ENABLED", "HOUSEHOLD_DEVICE_CAP", "HOUSEHOLD_UPGRADE_BEFORE", "HOUSEHOLD_SIGNING_KEY", "HOUSEHOLD_SIGNING_KID"];
const saved: Record<string, string | undefined> = {};
type Handler = (req: Request, ctx: never) => Promise<Response>;
let db: Client;
let activate: Handler;
let deactivate: Handler;
let validate: Handler;
let trialStart: Handler;
let trialStatus: Handler;
let counter = 0;

before(async () => {
  for (const k of [...KEYS, "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"]) saved[k] = process.env[k];
  db = await freshDb();
  process.env.TURSO_DATABASE_URL = lastDbUrl();
  process.env.TURSO_AUTH_TOKEN = "test-token-not-real";
  activate = (await import("../../netlify/functions/license-activate.js")).default as never;
  deactivate = (await import("../../netlify/functions/license-deactivate.js")).default as never;
  validate = (await import("../../netlify/functions/license-validate.js")).default as never;
  trialStart = (await import("../../netlify/functions/trial-start.js")).default as never;
  trialStatus = (await import("../../netlify/functions/trial-status.js")).default as never;
});

after(() => {
  try {
    getDb().close(); // the handlers' own client (see helpers.ts on why databases are closed)
  } catch {
    /* never opened */
  }
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(async () => {
  for (const t of ["activations", "license_keys", "licenses", "trials", "household_issued", "household_devices"]) {
    await db.execute(`DELETE FROM ${t}`).catch(() => {});
  }
  for (const k of KEYS) delete process.env[k];
  process.env.HOUSEHOLD_SIGNING_KEY = key.privateBase64;
  process.env.HOUSEHOLD_SIGNING_KID = "rk-test-1";
});

/** A licence as the Paddle webhook mints one for `product`: that product's own device limit, no platform. */
async function addLicence(
  product: "zeroed" | "rankup" | "qtc",
  o: { revoked?: number; tier?: string | null; created?: string } = {}
): Promise<{ licenceKey: string; id: string }> {
  const licenceKey = `KEY-${++counter}-${crypto.randomBytes(6).toString("hex")}`;
  const id = crypto.randomBytes(16).toString("hex");
  await db.execute({
    sql: `INSERT INTO licenses (id, key_hash, email, paddle_txn_id, product, max_activations, created_at, revoked, platform, tier)
          VALUES (?, ?, 'not-stored', ?, ?, ?, ?, ?, NULL, ?)`,
    args: [
      id, hashLicenseKey(licenceKey), `txn-${counter}`, product, PRODUCTS[product].maxActivations,
      o.created ?? "2026-11-10 12:00:00", o.revoked ?? 0, o.tier ?? null,
    ],
  });
  return { licenceKey, id };
}

/** POSTs `body` as it is: a test that wants no `product` field simply leaves it out. */
async function post(handler: Handler, body: Record<string, unknown>) {
  const res = await handler(new Request("https://www.stillwareltd.com/api/licenses/x", { method: "POST", body: JSON.stringify(body) }), {} as never);
  return { status: res.status, body: (await res.json()) as any };
}

const activateAs = (product: string | undefined, licenceKey: string, machine: string, extra: Record<string, unknown> = {}) =>
  post(activate, { ...(product === undefined ? {} : { product }), license_key: licenceKey, machine_id: machine, ...extra });
const deactivateAs = (product: string | undefined, licenceKey: string, instanceId: string) =>
  post(deactivate, { ...(product === undefined ? {} : { product }), license_key: licenceKey, instance_id: instanceId });
const validateAs = (product: string | undefined, licenceKey: string, extra: Record<string, unknown> = {}) =>
  post(validate, { ...(product === undefined ? {} : { product }), license_key: licenceKey, ...extra });

const activeCount = async (licenceId: string) =>
  Number((await db.execute({ sql: "SELECT COUNT(*) AS n FROM activations WHERE license_id = ? AND deactivated_at IS NULL", args: [licenceId] })).rows[0].n);
const rowCount = async (table: string) => Number((await db.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);

const INVALID = { success: false, error: "Invalid license key." };

// ------------------------------------------------------------------------------------------
// The product table

test("products: qtc is a known product, and every product in PRODUCTS is one isValidProduct accepts", () => {
  assert.equal(isValidProduct("qtc"), true);
  assert.equal(PRODUCTS.qtc.slug, "qtc");
  for (const [slug, config] of Object.entries(PRODUCTS)) {
    assert.equal(isValidProduct(slug), true, `${slug} is in PRODUCTS but isValidProduct refuses it`);
    assert.equal(config.slug, slug);
    assert.ok(Number.isInteger(config.maxActivations) && config.maxActivations >= 1, slug);
    assert.match(config.pageUrl, /^https:\/\/www\.stillwareltd\.com\/([a-z0-9-]+\/)*$/, slug);
  }
  // exact matches only: nothing near a slug is one
  for (const not of [undefined, "", "QTC", "qtc ", "quote-to-cash", "held", "nonsense", "__proto__", "toString"]) {
    assert.equal(isValidProduct(not as never), false, JSON.stringify(not));
  }
});

test("products: Zeroed and RankUp Chess are exactly as they were", () => {
  assert.deepEqual(PRODUCTS.zeroed, {
    slug: "zeroed", name: "Zeroed", tagline: "Zero stress. Total control.", maxActivations: 5,
    pageUrl: "https://www.stillwareltd.com/zeroed/",
  });
  assert.deepEqual(PRODUCTS.rankup, {
    slug: "rankup", name: "RankUp Chess", tagline: "Software you own.", maxActivations: 3,
    pageUrl: "https://www.stillwareltd.com/rankupchess/",
  });
  assert.equal(DEFAULT_PRODUCT_FOR_LEGACY_CLIENTS, "zeroed");
  assert.deepEqual(PRICE_ID_TO_PRODUCT, {
    pri_01knnyfj5zezrch30qqbzkc378: "zeroed",
    pri_01knztpnwdqxx8ecnbrjt4zkzq: "rankup",
    pri_01m194cc17phxmgqdqs737mw2p: "rankup",
    pri_01m5t1fevddc28paxqbpa4q5ks: "rankup",
    pri_01m5t1gwdqpdt1ewebtjchcpqh: "rankup",
  });
});

test("products: qtc has no Paddle price, no platform price, no household and no server trial", () => {
  // No price exists yet (2026-11-13). When the founder adds one to PRICE_ID_TO_PRODUCT this
  // assertion is the reminder to settle the placeholders in PRODUCTS.qtc first, then update it.
  assert.equal(Object.values(PRICE_ID_TO_PRODUCT).includes("qtc"), false);
  for (const priceId of Object.keys(PRICE_ID_TO_PLATFORM)) assert.notEqual(PRICE_ID_TO_PRODUCT[priceId], "qtc");
  assert.equal(isHouseholdProduct("qtc"), false);
  assert.deepEqual(HOUSEHOLD_PRODUCTS, ["rankup"]);
  assert.equal(isTrialProduct("qtc"), false);
  assert.deepEqual(TRIAL_PRODUCTS, ["zeroed", "rankup"]);
  // Decided by the founder on 2026-11-13: one licence covers three devices.
  assert.equal(PRODUCTS.qtc.maxActivations, 3);
});

// ------------------------------------------------------------------------------------------
// The defect this closes

test("activate as qtc with a Zeroed key: refused as an invalid key, and nothing is written", async () => {
  const zeroed = await addLicence("zeroed");
  const res = await activateAs("qtc", zeroed.licenceKey, "qtc-device-1", { platform: "windows" });
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, INVALID);
  assert.equal(await rowCount("activations"), 0);

  // The key is still a good Zeroed key: asked as Zeroed (by name, and as an old build with no product) it activates.
  assert.equal((await activateAs("zeroed", zeroed.licenceKey, "z-device-1")).status, 200);
  assert.equal((await activateAs(undefined, zeroed.licenceKey, "z-device-2")).status, 200);
  assert.equal(await activeCount(zeroed.id), 2);
});

test("activate as qtc with a RankUp Chess key: refused as an invalid key", async () => {
  const rankup = await addLicence("rankup");
  const res = await activateAs("qtc", rankup.licenceKey, "qtc-device-1", { platform: "android" });
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, INVALID);
  assert.equal(await rowCount("activations"), 0);
});

test("a qtc key unlocks nothing else: refused as Zeroed, as RankUp Chess, with no product and with an unknown one", async () => {
  const qtc = await addLicence("qtc");
  for (const product of ["zeroed", "rankup", undefined, "nonsense", "held"]) {
    const res = await activateAs(product, qtc.licenceKey, "m1");
    assert.equal(res.status, 404, `as ${product}`);
    assert.deepEqual(res.body, INVALID, `as ${product}`);
    assert.deepEqual((await validateAs(product, qtc.licenceKey)).body, { valid: false, reason: "Invalid license key." }, `as ${product}`);
  }
  assert.equal(await rowCount("activations"), 0);
});

// ------------------------------------------------------------------------------------------
// qtc: activate

test("activate as qtc with a qtc licence: succeeds, with the answer the app expects and nothing more", async () => {
  const qtc = await addLicence("qtc");
  const res = await activateAs("qtc", qtc.licenceKey, "device-a", { platform: "windows" });
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ["instance_id", "license_key", "success"]);
  assert.equal(res.body.success, true);
  assert.equal(res.body.license_key, qtc.licenceKey);
  assert.match(res.body.instance_id, /^[0-9a-f]{32}$/);

  // Only the device's random number is kept with the activation: no name, no platform.
  const rows = await db.execute({ sql: "SELECT machine_id, machine_name, deactivated_at FROM activations WHERE license_id = ?", args: [qtc.id] });
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].machine_id, "device-a");
  assert.equal(rows.rows[0].machine_name, null);
  assert.equal(rows.rows[0].deactivated_at, null);
});

test("activate as qtc: the device limit is the product's, and it holds", async () => {
  const cap = PRODUCTS.qtc.maxActivations;
  const qtc = await addLicence("qtc");
  // A licence covers phones and computers alike: it has no platform, so every OS the app names is let through.
  const systems = ["windows", "android", "ios", "macos", "linux"];
  for (let i = 1; i <= cap; i++) {
    const res = await activateAs("qtc", qtc.licenceKey, `device-${i}`, { platform: systems[(i - 1) % systems.length] });
    assert.equal(res.status, 200, `device ${i} of ${cap}`);
  }
  const over = await activateAs("qtc", qtc.licenceKey, `device-${cap + 1}`, { platform: "android" });
  assert.equal(over.status, 403);
  assert.deepEqual(over.body, {
    success: false,
    error: `Activation limit reached (${cap} devices). Deactivate another device first.`,
  });
  assert.equal(await activeCount(qtc.id), cap);
});

test("activate as qtc: the same device twice takes one place and gets the same activation", async () => {
  const qtc = await addLicence("qtc");
  const first = await activateAs("qtc", qtc.licenceKey, "device-a", { platform: "windows" });
  const again = await activateAs("qtc", qtc.licenceKey, "device-a", { platform: "windows" });
  assert.equal(again.status, 200);
  assert.equal(again.body.instance_id, first.body.instance_id);
  assert.equal(await activeCount(qtc.id), 1);
});

test("activate as qtc: a revoked licence, an unknown key and a missing field are refused as for any product", async () => {
  const revoked = await addLicence("qtc", { revoked: 1 });
  const res = await activateAs("qtc", revoked.licenceKey, "device-a");
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { success: false, error: "This license has been revoked." });
  assert.deepEqual((await activateAs("qtc", "NO-SUCH-KEY", "device-a")).body, INVALID);
  const missing = await post(activate, { product: "qtc", license_key: "ANY" });
  assert.equal(missing.status, 400);
  assert.equal(await rowCount("activations"), 0);
});

test("qtc with the household switch on: no record, and the licence keeps its own device limit", async () => {
  process.env.HOUSEHOLD_ENABLED = "1";
  process.env.HOUSEHOLD_UPGRADE_BEFORE = "2027-01-01";
  process.env.HOUSEHOLD_DEVICE_CAP = "10";
  // Even a row somebody tagged every_device by hand: qtc is not a household product.
  const cap = PRODUCTS.qtc.maxActivations;
  for (const tier of [null, "every_device"]) {
    const qtc = await addLicence("qtc", { tier, created: "2026-01-01 00:00:00" });
    for (let i = 1; i <= cap; i++) {
      const res = await activateAs("qtc", qtc.licenceKey, `device-${i}`);
      assert.equal(res.status, 200);
      assert.equal("household" in res.body, false);
    }
    assert.equal((await activateAs("qtc", qtc.licenceKey, "one-too-many")).status, 403);
    assert.deepEqual((await validateAs("qtc", qtc.licenceKey)).body, { valid: true });
  }
  assert.equal(await rowCount("household_issued"), 0);
});

// ------------------------------------------------------------------------------------------
// qtc: deactivate

test("deactivate as qtc: frees the device's place, once", async () => {
  const cap = PRODUCTS.qtc.maxActivations;
  const qtc = await addLicence("qtc");
  const instances: string[] = [];
  for (let i = 1; i <= cap; i++) instances.push((await activateAs("qtc", qtc.licenceKey, `device-${i}`)).body.instance_id);
  assert.equal((await activateAs("qtc", qtc.licenceKey, "new-phone")).status, 403);

  const gone = await deactivateAs("qtc", qtc.licenceKey, instances[0]);
  assert.equal(gone.status, 200);
  assert.deepEqual(gone.body, { success: true, deactivated: true });
  assert.equal(await activeCount(qtc.id), cap - 1);

  // the place is free for another device
  assert.equal((await activateAs("qtc", qtc.licenceKey, "new-phone")).status, 200);

  // a second deactivation of the same activation says so
  const twice = await deactivateAs("qtc", qtc.licenceKey, instances[0]);
  assert.equal(twice.status, 404);
  assert.deepEqual(twice.body, { success: false, error: "Activation not found or already deactivated." });

  // the device that was removed comes back as the same activation, if there is a place
  await deactivateAs("qtc", qtc.licenceKey, instances[1]);
  const back = await activateAs("qtc", qtc.licenceKey, "device-1");
  assert.equal(back.status, 200);
  assert.equal(back.body.instance_id, instances[0]);
});

test("deactivate as qtc: another product's key, or another product's name, frees nothing", async () => {
  const qtc = await addLicence("qtc");
  const zeroed = await addLicence("zeroed");
  const qtcInstance = (await activateAs("qtc", qtc.licenceKey, "device-a")).body.instance_id;
  const zeroedInstance = (await activateAs("zeroed", zeroed.licenceKey, "device-a")).body.instance_id;

  // a Zeroed key named as qtc
  const wrongKey = await deactivateAs("qtc", zeroed.licenceKey, zeroedInstance);
  assert.equal(wrongKey.status, 404);
  assert.deepEqual(wrongKey.body, INVALID);
  // a qtc key named as Zeroed, as nothing (an old Zeroed build), and as a product nobody knows
  for (const product of ["zeroed", undefined, "nonsense"]) {
    const res = await deactivateAs(product, qtc.licenceKey, qtcInstance);
    assert.equal(res.status, 404, `as ${product}`);
    assert.deepEqual(res.body, INVALID, `as ${product}`);
  }
  // a qtc key with a Zeroed licence's activation id
  assert.equal((await deactivateAs("qtc", qtc.licenceKey, zeroedInstance)).status, 404);

  assert.equal(await activeCount(qtc.id), 1);
  assert.equal(await activeCount(zeroed.id), 1);
  assert.equal((await post(deactivate, { product: "qtc", license_key: qtc.licenceKey })).status, 400);
});

// ------------------------------------------------------------------------------------------
// qtc: validate (the app does not call it today; the server must still answer it rightly)

test("validate as qtc: a qtc licence is valid, with and without its activation", async () => {
  const qtc = await addLicence("qtc");
  const plain = await validateAs("qtc", qtc.licenceKey);
  assert.equal(plain.status, 200);
  assert.deepEqual(plain.body, { valid: true });

  const instance = (await activateAs("qtc", qtc.licenceKey, "device-a")).body.instance_id;
  assert.deepEqual((await validateAs("qtc", qtc.licenceKey, { instance_id: instance })).body, { valid: true });
  assert.deepEqual((await validateAs("qtc", qtc.licenceKey, { instance_id: "not-an-activation" })).body, {
    valid: false, reason: "Activation not found or deactivated.",
  });

  await deactivateAs("qtc", qtc.licenceKey, instance);
  assert.deepEqual((await validateAs("qtc", qtc.licenceKey, { instance_id: instance })).body, {
    valid: false, reason: "Activation not found or deactivated.",
  });
  // the licence itself is still good
  assert.deepEqual((await validateAs("qtc", qtc.licenceKey)).body, { valid: true });
});

test("validate as qtc: a Zeroed key, a RankUp Chess key, an unknown key and a revoked licence are not valid", async () => {
  const zeroed = await addLicence("zeroed");
  const rankup = await addLicence("rankup");
  const revoked = await addLicence("qtc", { revoked: 1 });
  for (const k of [zeroed.licenceKey, rankup.licenceKey, "NO-SUCH-KEY"]) {
    const res = await validateAs("qtc", k);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { valid: false, reason: "Invalid license key." });
  }
  assert.deepEqual((await validateAs("qtc", revoked.licenceKey)).body, { valid: false, reason: "License has been revoked." });
  assert.equal((await post(validate, { product: "qtc" })).status, 400);
});

test("a re-issued qtc key unlocks the same licence, and only as qtc", async () => {
  const qtc = await addLicence("qtc");
  const reissued = "ABCD-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD-0001";
  await db.execute({ sql: "INSERT INTO license_keys (key_hash, license_id) VALUES (?, ?)", args: [hashLicenseKey(reissued), qtc.id] });
  const a = await activateAs("qtc", qtc.licenceKey, "device-a");
  const b = await activateAs("qtc", reissued, "device-a");
  assert.equal(b.status, 200);
  assert.equal(b.body.instance_id, a.body.instance_id, "one licence, one place for the device");
  assert.deepEqual((await activateAs(undefined, reissued, "device-b")).body, INVALID);
  assert.deepEqual((await activateAs("zeroed", reissued, "device-b")).body, INVALID);
});

// ------------------------------------------------------------------------------------------
// What must not move

test("no product (a Zeroed build from before products): still Zeroed, on all three endpoints", async () => {
  const zeroed = await addLicence("zeroed");
  const rankup = await addLicence("rankup");

  const act = await activateAs(undefined, zeroed.licenceKey, "old-build-1");
  assert.equal(act.status, 200);
  assert.deepEqual(Object.keys(act.body).sort(), ["instance_id", "license_key", "success"]);
  assert.deepEqual((await validateAs(undefined, zeroed.licenceKey, { instance_id: act.body.instance_id })).body, { valid: true });

  // Zeroed's five devices, not three
  for (let i = 2; i <= 5; i++) assert.equal((await activateAs(undefined, zeroed.licenceKey, `old-build-${i}`)).status, 200);
  const sixth = await activateAs(undefined, zeroed.licenceKey, "old-build-6");
  assert.equal(sixth.status, 403);
  assert.match(sixth.body.error, /Activation limit reached \(5 devices\)/);

  const de = await deactivateAs(undefined, zeroed.licenceKey, act.body.instance_id);
  assert.deepEqual(de.body, { success: true, deactivated: true });
  assert.equal(await activeCount(zeroed.id), 4);

  // and a RankUp Chess key is not a Zeroed key, as before
  assert.deepEqual((await activateAs(undefined, rankup.licenceKey, "m1")).body, INVALID);
  assert.deepEqual((await validateAs(undefined, rankup.licenceKey)).body, { valid: false, reason: "Invalid license key." });
});

test("an unknown product: still treated as Zeroed's, exactly as before, on all three endpoints", async () => {
  // This is the fallback that made `qtc` unsafe while the server did not know it. It stays for
  // every name the server does not know (old Zeroed builds depend on the default), so a new
  // product must be added here BEFORE its app is allowed to activate.
  for (const product of ["nonsense", "held", "QTC", "", 42, null]) {
    const zeroed = await addLicence("zeroed");
    const rankup = await addLicence("rankup");
    const act = await post(activate, { product, license_key: zeroed.licenceKey, machine_id: "m1" });
    assert.equal(act.status, 200, `activate as ${JSON.stringify(product)}`);
    assert.deepEqual(
      (await post(validate, { product, license_key: zeroed.licenceKey, instance_id: act.body.instance_id })).body,
      { valid: true }
    );
    assert.deepEqual(
      (await post(deactivate, { product, license_key: zeroed.licenceKey, instance_id: act.body.instance_id })).body,
      { success: true, deactivated: true }
    );
    assert.deepEqual((await post(activate, { product, license_key: rankup.licenceKey, machine_id: "m1" })).body, INVALID);
  }
});

test("Zeroed and RankUp Chess by name: each key works for its own product and not for the other", async () => {
  const zeroed = await addLicence("zeroed");
  const rankup = await addLicence("rankup");
  assert.equal((await activateAs("zeroed", zeroed.licenceKey, "m1")).status, 200);
  assert.equal((await activateAs("rankup", rankup.licenceKey, "m1", { platform: "macos" })).status, 200);
  assert.deepEqual((await activateAs("rankup", zeroed.licenceKey, "m2")).body, INVALID);
  assert.deepEqual((await activateAs("zeroed", rankup.licenceKey, "m2")).body, INVALID);
  assert.deepEqual((await validateAs("zeroed", zeroed.licenceKey)).body, { valid: true });
  assert.deepEqual((await validateAs("rankup", rankup.licenceKey)).body, { valid: true });

  // RankUp Chess's three devices
  assert.equal((await activateAs("rankup", rankup.licenceKey, "m2")).status, 200);
  assert.equal((await activateAs("rankup", rankup.licenceKey, "m3")).status, 200);
  assert.match((await activateAs("rankup", rankup.licenceKey, "m4")).body.error, /Activation limit reached \(3 devices\)/);
});

// ------------------------------------------------------------------------------------------
// The server-anchored trial: Zeroed and RankUp Chess only

async function startTrial(body: Record<string, unknown>) {
  return post(trialStart, body);
}
async function trialOf(product: string | undefined, deviceId: string) {
  const q = new URLSearchParams({ ...(product === undefined ? {} : { product }), device_id: deviceId });
  const res = await trialStatus(new Request(`https://www.stillwareltd.com/api/licenses/trial/status?${q}`), {} as never);
  return { status: res.status, body: (await res.json()) as any };
}

test("trial: Zeroed and RankUp Chess start once per device and report it, as before", async () => {
  for (const product of ["zeroed", "rankup"]) {
    assert.equal((await trialOf(product, "phone-1")).status, 404);
    const first = await startTrial({ product, device_id: " phone-1 " });
    assert.equal(first.status, 200);
    assert.match(first.body.started_at, /^\d{4}-\d{2}-\d{2}T/);
    const again = await startTrial({ product, device_id: "phone-1" });
    assert.deepEqual(again.body, first.body, "a reinstall gets the original start");
    assert.deepEqual((await trialOf(product, "phone-1")).body, first.body);
  }
  assert.equal(await rowCount("trials"), 2, "one row per product and device");
});

test("trial: qtc is left out on purpose (its trial is on the device), and unknown products are refused as before", async () => {
  for (const product of ["qtc", "nonsense", undefined]) {
    const start = await startTrial({ ...(product === undefined ? {} : { product }), device_id: "phone-1" });
    assert.equal(start.status, 400, `start as ${product}`);
    assert.deepEqual(start.body, { error: "Unknown product" });
    const status = await trialOf(product, "phone-1");
    assert.equal(status.status, 400, `status as ${product}`);
    assert.deepEqual(status.body, { error: "Unknown product" });
  }
  assert.equal(await rowCount("trials"), 0);
});

// ------------------------------------------------------------------------------------------
// Buying and lost keys: nothing can happen for qtc until a Paddle price is mapped to it

test("no Paddle price is qtc's: a purchase is never minted as qtc, and resend-key for qtc sends nothing", async () => {
  for (const priceId of Object.keys(PRICE_ID_TO_PRODUCT)) {
    assert.notEqual(productFromTransactionItems([{ price: { id: priceId } }]), "qtc", priceId);
  }
  assert.equal(productFromTransactionItems([{ price: { id: "pri_not_a_price_we_know" } }]), null);

  const sent: unknown[] = [];
  async function* purchases(): AsyncGenerator<Purchase> {
    let n = 0;
    for (const priceId of Object.keys(PRICE_ID_TO_PRODUCT)) {
      yield { id: `txn_other_${++n}`, items: [{ price: { id: priceId } }], customerEmail: "buyer@example.net" };
    }
    yield { id: "txn_unknown", items: [{ price: { id: "pri_not_a_price_we_know" } }], customerEmail: "buyer@example.net" };
  }
  const outcomes = await resendKeys(
    { db, send: async (...args) => { sent.push(args); }, deviceCap: 10 },
    purchases(),
    "qtc"
  );
  assert.deepEqual(outcomes, []);
  assert.equal(sent.length, 0);
  assert.equal(await rowCount("licenses"), 0, "no licence is minted for another product's purchase");
});
