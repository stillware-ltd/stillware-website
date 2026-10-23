import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Client } from "@libsql/client";
import { hashLicenseKey } from "../../netlify/functions/lib/crypto.js";
import { verifySignedRecord } from "../../netlify/functions/lib/household-record.js";
import { mintLicence } from "../../netlify/functions/lib/paddle-licence.js";
import { PRODUCTS } from "../../netlify/functions/lib/products.js";
import { getDb } from "../../netlify/functions/lib/db.js";
import { freshDb, lastDbUrl, makeKey } from "./helpers.js";

// license-activate: unchanged for today's licences, and for an Every device licence it returns
// the household record too. The handler is the real one, run against a local database file
// that its getDb() finds through TURSO_DATABASE_URL.

const key = makeKey("rk-test-1");
const KEYS = ["HOUSEHOLD_ENABLED", "HOUSEHOLD_DEVICE_CAP", "HOUSEHOLD_UPGRADE_BEFORE", "HOUSEHOLD_SIGNING_KEY", "HOUSEHOLD_SIGNING_KID"];
const saved: Record<string, string | undefined> = {};
let db: Client;
let activate: (req: Request, ctx: never) => Promise<Response>;
let counter = 0;
let dbUrl = "";

before(async () => {
  for (const k of [...KEYS, "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"]) saved[k] = process.env[k];
  // The handler's getDb() caches one client, so the whole file shares one database file.
  db = await freshDb();
  dbUrl = lastDbUrl();
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "test-token-not-real";
  activate = (await import("../../netlify/functions/license-activate.js")).default as never;
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
  for (const t of ["activations", "license_keys", "licenses", "household_issued", "household_devices"]) {
    await db.execute(`DELETE FROM ${t}`).catch(() => {});
  }
  for (const k of KEYS) delete process.env[k];
  process.env.HOUSEHOLD_SIGNING_KEY = key.privateBase64;
  process.env.HOUSEHOLD_SIGNING_KID = "rk-test-1";
});

async function addLicence(o: {
  product?: string; platform?: string | null; tier?: string | null; max?: number; created?: string; revoked?: number;
}): Promise<{ licenceKey: string; id: string }> {
  const licenceKey = `KEY-${++counter}-${crypto.randomBytes(6).toString("hex")}`;
  const id = crypto.randomBytes(16).toString("hex");
  await db.execute({
    sql: `INSERT INTO licenses (id, key_hash, email, paddle_txn_id, product, max_activations, created_at, revoked, platform, tier)
          VALUES (?, ?, 'not-stored', ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, hashLicenseKey(licenceKey), `txn-${counter}`, o.product ?? "rankup", o.max ?? 3,
      o.created ?? "2026-10-10 12:00:00", o.revoked ?? 0, o.platform ?? null, o.tier ?? null,
    ],
  });
  return { licenceKey, id };
}

async function call(licenceKey: string, machine: string, extra: Record<string, unknown> = {}) {
  const res = await activate(
    new Request("https://www.stillwareltd.com/api/licenses/activate", {
      method: "POST",
      body: JSON.stringify({ license_key: licenceKey, machine_id: machine, product: "rankup", ...extra }),
    }),
    {} as never
  );
  return { status: res.status, body: (await res.json()) as any };
}

test("flag off: a per-platform licence behaves as it always did", async () => {
  const { licenceKey } = await addLicence({ platform: "windows" });
  const wrong = await call(licenceKey, "m1", { platform: "macos" });
  assert.equal(wrong.status, 403);
  assert.match(wrong.body.error, /Windows and Linux/);
  const right = await call(licenceKey, "m1", { platform: "windows" });
  assert.equal(right.status, 200);
  assert.deepEqual(Object.keys(right.body).sort(), ["instance_id", "license_key", "success"]);
  // an app that does not say its platform is let through, as before
  assert.equal((await call(licenceKey, "m2")).status, 200);
});

test("flag off: even an Every device licence gets no record and no new rules", async () => {
  const { licenceKey } = await addLicence({ tier: "every_device", max: 10 });
  const res = await call(licenceKey, "m1", { platform: "macos" });
  assert.equal(res.status, 200);
  assert.equal("household" in res.body, false);
  const issued = await db.execute("SELECT COUNT(*) AS n FROM household_issued");
  assert.equal(issued.rows[0].n, 0);
});

test("flag on: an Every device licence returns its signed record with the activation", async () => {
  process.env.HOUSEHOLD_ENABLED = "1";
  const { licenceKey, id } = await addLicence({ tier: "every_device", created: "2026-10-12 08:00:00" });
  const first = await call(licenceKey, "m1", { platform: "macos" });
  assert.equal(first.status, 200);
  assert.equal(first.body.success, true);
  assert.equal(first.body.license_key, licenceKey);
  assert.ok(first.body.instance_id);
  const h = first.body.household;
  assert.deepEqual(Object.keys(h).sort(), ["kid", "record", "sig"]);
  assert.deepEqual(h.record, {
    v: 1, product: "rankup", lid: id, tier: "every_device", via: "paddle", purchased: "2026-10-12",
    issued: h.record.issued,
  });
  assert.match(h.record.issued, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(verifySignedRecord(h, key.publicKey), true);

  // activating the same machine again returns the same record
  const again = await call(licenceKey, "m1");
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.household, h);
});

test("flag on: the free upgrade of an earlier buyer works on any platform and says so", async () => {
  process.env.HOUSEHOLD_ENABLED = "1";
  process.env.HOUSEHOLD_UPGRADE_BEFORE = "2026-10-20";
  const old = await addLicence({ platform: "windows", created: "2026-10-01 00:00:00" });
  const res = await call(old.licenceKey, "m1", { platform: "macos" });
  assert.equal(res.status, 200);
  assert.equal(res.body.household.record.via, "upgrade");
  assert.equal(res.body.household.record.lid, old.id);
  assert.equal(res.body.household.record.purchased, "2026-10-01");
  assert.equal(verifySignedRecord(res.body.household, key.publicKey), true);

  // bought on or after the switch date: no upgrade, still one platform
  const fresh = await addLicence({ platform: "windows", created: "2026-10-20 00:00:00" });
  const refused = await call(fresh.licenceKey, "m1", { platform: "macos" });
  assert.equal(refused.status, 403);
});

test("flag on: a plain licence is untouched (platform check, device limit, no record)", async () => {
  process.env.HOUSEHOLD_ENABLED = "1";
  const { licenceKey } = await addLicence({ platform: "macos", max: 3 });
  assert.equal((await call(licenceKey, "m1", { platform: "windows" })).status, 403);
  for (const m of ["m1", "m2", "m3"]) {
    const res = await call(licenceKey, m, { platform: "macos" });
    assert.equal(res.status, 200);
    assert.equal("household" in res.body, false);
  }
  assert.equal((await call(licenceKey, "m4", { platform: "macos" })).status, 403);
});

test("flag on: an Every device licence gets the household's activations, 10 by default", async () => {
  process.env.HOUSEHOLD_ENABLED = "1";
  const { licenceKey } = await addLicence({ tier: "every_device", max: 3 });
  for (let i = 1; i <= 10; i++) assert.equal((await call(licenceKey, `m${i}`)).status, 200, `machine ${i}`);
  const eleventh = await call(licenceKey, "m11");
  assert.equal(eleventh.status, 403);
  assert.match(eleventh.body.error, /Activation limit reached \(10 devices\)/);
});

test("flag on: HOUSEHOLD_DEVICE_CAP sets that number", async () => {
  process.env.HOUSEHOLD_ENABLED = "1";
  process.env.HOUSEHOLD_DEVICE_CAP = "4";
  const { licenceKey } = await addLicence({ tier: "every_device", max: 3 });
  for (let i = 1; i <= 4; i++) assert.equal((await call(licenceKey, `m${i}`)).status, 200);
  assert.equal((await call(licenceKey, "m5")).status, 403);
});

test("flag on, no signing key: the activation still succeeds, without a record", async () => {
  process.env.HOUSEHOLD_ENABLED = "1";
  delete process.env.HOUSEHOLD_SIGNING_KEY;
  const { licenceKey } = await addLicence({ tier: "every_device" });
  const res = await call(licenceKey, "m1");
  assert.equal(res.status, 200);
  assert.equal("household" in res.body, false);
});

test("flag on: a revoked Every device licence is refused, with no record", async () => {
  process.env.HOUSEHOLD_ENABLED = "1";
  const { licenceKey } = await addLicence({ tier: "every_device", revoked: 1 });
  const res = await call(licenceKey, "m1");
  assert.equal(res.status, 403);
  assert.equal("household" in res.body, false);
});

test("flag on: another product's licence never gets a record", async () => {
  process.env.HOUSEHOLD_ENABLED = "1";
  process.env.HOUSEHOLD_UPGRADE_BEFORE = "2027-01-01";
  const { licenceKey } = await addLicence({ product: "zeroed", tier: "every_device" });
  const res = await call(licenceKey, "m1", { product: "zeroed" });
  assert.equal(res.status, 200);
  assert.equal("household" in res.body, false);
});

// A Paddle upgrade price: the known macOS price stands in for the new one, which exists from KL.3.
const UPGRADE_PRICE = "pri_01m194cc17phxmgqdqs737mw2p";
async function upgradeViaPaddle(licenceKey: string, txn: string) {
  return mintLicence(
    {
      db, deviceCap: 10, sendKey: async () => {}, everyDevicePrices: [], upgradePrices: [UPGRADE_PRICE],
    },
    {
      transactionId: txn, items: [{ price: { id: UPGRADE_PRICE } }], product: PRODUCTS.rankup,
      customerEmail: "buyer@example.net", customData: { licence: hashLicenseKey(licenceKey) },
    }
  );
}

test("flag on: a per-platform key upgraded through Paddle returns the record, on any platform", async () => {
  process.env.HOUSEHOLD_ENABLED = "1";
  const { licenceKey, id } = await addLicence({ platform: "windows", created: "2026-09-01 10:00:00" });
  assert.equal((await call(licenceKey, "m0", { platform: "macos" })).status, 403, "before the upgrade it is Windows only");
  assert.equal(await upgradeViaPaddle(licenceKey, "txn-upgrade-1"), "upgraded");

  const res = await call(licenceKey, "m1", { platform: "macos" });
  assert.equal(res.status, 200);
  assert.equal(res.body.license_key, licenceKey, "the key did not change");
  assert.deepEqual(res.body.household.record, {
    v: 1, product: "rankup", lid: id, tier: "every_device", via: "paddle", purchased: "2026-09-01",
    issued: res.body.household.record.issued,
  });
  assert.equal(verifySignedRecord(res.body.household, key.publicKey), true);
  // the household's activations, not the three it was sold with
  for (let i = 2; i <= 10; i++) assert.equal((await call(licenceKey, `m${i}`, { platform: "linux" })).status, 200);
  assert.equal((await call(licenceKey, "m11")).status, 403);
});

test("flag off: an upgraded key works on any platform, but returns no record yet", async () => {
  const { licenceKey } = await addLicence({ platform: "windows" });
  assert.equal(await upgradeViaPaddle(licenceKey, "txn-upgrade-2"), "upgraded");
  const res = await call(licenceKey, "m1", { platform: "macos" });
  assert.equal(res.status, 200);
  assert.equal("household" in res.body, false);
  const issued = await db.execute("SELECT COUNT(*) AS n FROM household_issued");
  assert.equal(issued.rows[0].n, 0);
});
