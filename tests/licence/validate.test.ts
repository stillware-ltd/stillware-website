import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Client } from "@libsql/client";
import { getDb } from "../../netlify/functions/lib/db.js";
import { hashLicenseKey } from "../../netlify/functions/lib/crypto.js";
import { verifySignedRecord } from "../../netlify/functions/lib/household-record.js";
import { ensureLicenseKeysTable } from "../../netlify/functions/lib/licenses.js";
import { freshDb, lastDbUrl, makeKey } from "./helpers.js";

// license-validate: the desktop app revalidates now and then, so an Every device licence (or one due
// the free upgrade) gets its signed record in that answer, as license-activate's carries it. With
// the flag off, and for every other licence, the answer is what it always was. The handler is the
// real one, against a local database file that its getDb() finds through TURSO_DATABASE_URL.

const key = makeKey("rk-test-1");
const KEYS = ["HOUSEHOLD_ENABLED", "HOUSEHOLD_DEVICE_CAP", "HOUSEHOLD_UPGRADE_BEFORE", "HOUSEHOLD_SIGNING_KEY", "HOUSEHOLD_SIGNING_KID"];
const saved: Record<string, string | undefined> = {};
let db: Client;
let validate: (req: Request, ctx: never) => Promise<Response>;
let activate: (req: Request, ctx: never) => Promise<Response>;
let counter = 0;

before(async () => {
  for (const k of [...KEYS, "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"]) saved[k] = process.env[k];
  db = await freshDb();
  process.env.TURSO_DATABASE_URL = lastDbUrl();
  process.env.TURSO_AUTH_TOKEN = "test-token-not-real";
  validate = (await import("../../netlify/functions/license-validate.js")).default as never;
  activate = (await import("../../netlify/functions/license-activate.js")).default as never;
});

after(() => {
  try {
    getDb().close();
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

async function check(licenceKey: string, extra: Record<string, unknown> = {}) {
  const res = await validate(
    new Request("https://www.stillwareltd.com/api/licenses/validate", {
      method: "POST",
      body: JSON.stringify({ license_key: licenceKey, product: "rankup", ...extra }),
    }),
    {} as never
  );
  return { status: res.status, body: (await res.json()) as any };
}

test("flag off: the answer is exactly what it always was, for every kind of licence", async () => {
  process.env.HOUSEHOLD_UPGRADE_BEFORE = "2026-10-20"; // set, but the flag is off
  const every = await addLicence({ tier: "every_device" });
  const old = await addLicence({ platform: "windows", created: "2026-10-01 00:00:00" });
  const plain = await addLicence({ platform: "macos", created: "2026-10-25 00:00:00" });
  for (const l of [every, old, plain]) {
    const res = await check(l.licenceKey);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { valid: true });
  }
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM household_issued")).rows[0].n, 0);
});

test("flag on: an Every device licence returns its signed record, the same one activate returns", async () => {
  process.env.HOUSEHOLD_ENABLED = "1";
  const { licenceKey, id } = await addLicence({ tier: "every_device", created: "2026-10-12 08:00:00" });
  const res = await check(licenceKey);
  assert.equal(res.status, 200);
  assert.equal(res.body.valid, true);
  const h = res.body.household;
  assert.deepEqual(Object.keys(h).sort(), ["kid", "record", "sig"]);
  assert.deepEqual(h.record, {
    v: 1, product: "rankup", lid: id, tier: "every_device", via: "paddle", purchased: "2026-10-12",
    issued: h.record.issued,
  });
  assert.equal(h.kid, "rk-test-1");
  assert.equal(verifySignedRecord(h, key.publicKey), true);
  assert.deepEqual(Object.keys(res.body).sort(), ["household", "valid"]);

  // the same record the desktop app gets when it activates, and again at the next check
  const act = await activate(
    new Request("https://x/", { method: "POST", body: JSON.stringify({ license_key: licenceKey, machine_id: "m1", product: "rankup" }) }),
    {} as never
  );
  assert.deepEqual((await act.json() as any).household, h);
  assert.deepEqual((await check(licenceKey)).body.household, h);
});

test("flag on: an older licence due the free upgrade returns a record via upgrade", async () => {
  process.env.HOUSEHOLD_ENABLED = "1";
  process.env.HOUSEHOLD_UPGRADE_BEFORE = "2026-10-20";
  const { licenceKey, id } = await addLicence({ platform: "windows", created: "2026-10-01 09:00:00" });
  const res = await check(licenceKey);
  assert.equal(res.status, 200);
  assert.equal(res.body.valid, true);
  assert.deepEqual(res.body.household.record, {
    v: 1, product: "rankup", lid: id, tier: "every_device", via: "upgrade", purchased: "2026-10-01",
    issued: res.body.household.record.issued,
  });
  assert.equal(verifySignedRecord(res.body.household, key.publicKey), true);
});

test("flag on: a per-platform licence bought on or after the switch date gets no record", async () => {
  process.env.HOUSEHOLD_ENABLED = "1";
  process.env.HOUSEHOLD_UPGRADE_BEFORE = "2026-10-20";
  for (const created of ["2026-10-20 00:00:00", "2026-11-03 10:00:00"]) {
    const { licenceKey } = await addLicence({ platform: "macos", created });
    assert.deepEqual((await check(licenceKey)).body, { valid: true }, created);
  }
  // and with no switch date at all, nobody is upgraded
  delete process.env.HOUSEHOLD_UPGRADE_BEFORE;
  const { licenceKey } = await addLicence({ platform: "windows", created: "2026-01-01 00:00:00" });
  assert.deepEqual((await check(licenceKey)).body, { valid: true });
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM household_issued")).rows[0].n, 0);
});

test("flag on: a revoked licence is invalid, with no record, whatever its tier", async () => {
  process.env.HOUSEHOLD_ENABLED = "1";
  process.env.HOUSEHOLD_UPGRADE_BEFORE = "2026-10-20";
  for (const tier of ["every_device", null]) {
    const { licenceKey } = await addLicence({ tier, revoked: 1, created: "2026-10-01 00:00:00" });
    const res = await check(licenceKey);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { valid: false, reason: "License has been revoked." });
  }
  assert.equal((await db.execute("SELECT COUNT(*) AS n FROM household_issued")).rows[0].n, 0);
});

test("flag on: an unknown key, a bad request and a wrong activation stay as they were", async () => {
  process.env.HOUSEHOLD_ENABLED = "1";
  assert.deepEqual((await check("NO-SUCH-KEY")).body, { valid: false, reason: "Invalid license key." });
  const missing = await validate(new Request("https://x/", { method: "POST", body: JSON.stringify({ product: "rankup" }) }), {} as never);
  assert.equal(missing.status, 400);
  const { licenceKey } = await addLicence({ tier: "every_device" });
  const wrongInstance = await check(licenceKey, { instance_id: "not-an-activation" });
  assert.deepEqual(wrongInstance.body, { valid: false, reason: "Activation not found or deactivated." });
  assert.equal("household" in wrongInstance.body, false);
});

test("flag on: with a good activation the record comes with the answer", async () => {
  process.env.HOUSEHOLD_ENABLED = "1";
  const { licenceKey } = await addLicence({ tier: "every_device" });
  const act = await activate(
    new Request("https://x/", { method: "POST", body: JSON.stringify({ license_key: licenceKey, machine_id: "m1", product: "rankup" }) }),
    {} as never
  );
  const instanceId = ((await act.json()) as any).instance_id;
  const res = await check(licenceKey, { instance_id: instanceId });
  assert.equal(res.body.valid, true);
  assert.equal(verifySignedRecord(res.body.household, key.publicKey), true);
});

test("flag on: a re-issued key finds the same licence and the same record", async () => {
  process.env.HOUSEHOLD_ENABLED = "1";
  const { licenceKey, id } = await addLicence({ tier: "every_device" });
  await ensureLicenseKeysTable(db);
  const reissued = "ABCD-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD";
  await db.execute({ sql: "INSERT INTO license_keys (key_hash, license_id) VALUES (?, ?)", args: [hashLicenseKey(reissued), id] });
  const a = await check(licenceKey);
  const b = await check(reissued);
  assert.equal(b.body.valid, true);
  assert.deepEqual(b.body.household, a.body.household);
});

test("flag on, no signing key: still valid, without a record", async () => {
  process.env.HOUSEHOLD_ENABLED = "1";
  delete process.env.HOUSEHOLD_SIGNING_KEY;
  const { licenceKey } = await addLicence({ tier: "every_device" });
  const err = console.error;
  console.error = () => {};
  try {
    assert.deepEqual((await check(licenceKey)).body, { valid: true });
  } finally {
    console.error = err;
  }
});

test("flag on: another product's licence never gets a record", async () => {
  process.env.HOUSEHOLD_ENABLED = "1";
  process.env.HOUSEHOLD_UPGRADE_BEFORE = "2027-01-01";
  const { licenceKey } = await addLicence({ product: "zeroed", tier: "every_device" });
  const res = await check(licenceKey, { product: "zeroed" });
  assert.deepEqual(res.body, { valid: true });
});
