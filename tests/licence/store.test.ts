import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Client } from "@libsql/client";
import {
  checkCode,
  emailHash,
  ensureHouseholdTables,
  newCode,
  newLid,
  normaliseEmail,
  purgeOldCodes,
  storeCode,
  takeDeviceSlot,
  takeHit,
} from "../../netlify/functions/lib/household-store.js";
import { ensureLicenceTierColumn } from "../../netlify/functions/lib/licenses.js";
import { freshDb, SCHEMA_PATH } from "./helpers.js";

// The storage layer on its own: the tables, the rate-limit hits, the device count, the codes.

const squash = (sql: unknown) => String(sql).replace(/\s+/g, " ").trim();

async function household(db: Client) {
  const res = await db.execute(
    "SELECT type, name, sql FROM sqlite_master WHERE name LIKE '%household%' AND name NOT LIKE 'sqlite_%' ORDER BY type, name"
  );
  return res.rows.map((r) => `${r.type} ${r.name}: ${squash(r.sql)}`);
}

test("schema.sql and the tables made on first use are the same", async () => {
  const fromFile = await freshDb(false);
  await fromFile.executeMultiple(readFileSync(SCHEMA_PATH, "utf8"));
  const onFirstUse = await freshDb(false);
  await ensureHouseholdTables(onFirstUse);

  const a = await household(fromFile);
  const b = await household(onFirstUse);
  assert.deepEqual(a, b);
  const names = (await fromFile.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'household_%' ORDER BY name"))
    .rows.map((r) => r.name);
  assert.deepEqual(names, [
    "household_codes", "household_devices", "household_email_links", "household_hits", "household_issued",
    "household_store_entitlements", "household_upgrades",
  ]);
});

test("schema.sql adds the tier column to licenses, and the first-use ALTER does the same for an old table", async () => {
  const fromFile = await freshDb();
  const cols = (await fromFile.execute("PRAGMA table_info(licenses)")).rows.map((r) => r.name);
  assert.ok(cols.includes("tier") && cols.includes("platform"));

  const old = await freshDb(false);
  await old.execute("CREATE TABLE licenses (id TEXT PRIMARY KEY, key_hash TEXT)");
  await ensureLicenceTierColumn(old);
  await ensureLicenceTierColumn(old); // a second call is harmless
  assert.ok((await old.execute("PRAGMA table_info(licenses)")).rows.some((r) => r.name === "tier"));
  // and where the column already exists, the ALTER's "duplicate column" is swallowed
  const again = await freshDb();
  await ensureLicenceTierColumn(again);
});

test("ensureHouseholdTables is idempotent and per database", async () => {
  const one = await freshDb(false);
  const two = await freshDb(false);
  await ensureHouseholdTables(one);
  await ensureHouseholdTables(one);
  await ensureHouseholdTables(two);
  assert.equal((await household(two)).length > 0, true);
});

test("takeHit: the limit is per bucket and per hour", async () => {
  const db = await freshDb();
  const t0 = new Date("2026-10-23T09:00:00Z");
  const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
  assert.deepEqual(
    [await takeHit(db, "b1", 3, at(0)), await takeHit(db, "b1", 3, at(1)), await takeHit(db, "b1", 3, at(2)), await takeHit(db, "b1", 3, at(3))],
    [true, true, true, false]
  );
  assert.equal(await takeHit(db, "b2", 3, at(3)), true, "another bucket is separate");
  assert.equal(await takeHit(db, "b1", 3, at(59)), false, "just under an hour after the first");
  assert.equal(await takeHit(db, "b1", 3, at(61)), true, "the first two hits have aged out");
  assert.equal(await takeHit(db, "b1", 3, at(62)), true);
  assert.equal(await takeHit(db, "b1", 3, at(63)), true);
  assert.equal(await takeHit(db, "b1", 3, at(64)), false, "three in the last hour again");
});

test("takeHit: requests at the same moment cannot take more than the limit", async () => {
  const db = await freshDb();
  const now = new Date("2026-10-23T09:00:00Z");
  const results = await Promise.all(Array.from({ length: 12 }, () => takeHit(db, "race", 5, now)));
  assert.equal(results.filter(Boolean).length, 5);
});

test("takeDeviceSlot: counts up to the cap per licence, then refuses", async () => {
  const db = await freshDb();
  const now = new Date("2026-10-23T09:00:00Z");
  const lid = newLid();
  assert.deepEqual(
    [await takeDeviceSlot(db, "rankup", lid, 2, now), await takeDeviceSlot(db, "rankup", lid, 2, now), await takeDeviceSlot(db, "rankup", lid, 2, now)],
    [true, true, false]
  );
  assert.equal(await takeDeviceSlot(db, "rankup", newLid(), 2, now), true, "another licence");
  assert.equal(await takeDeviceSlot(db, "rankup", lid, 3, now), true, "a higher cap leaves room");
  assert.equal(await takeDeviceSlot(db, "rankup", lid, 3, now), false);
  const row = (await db.execute({ sql: "SELECT devices FROM household_devices WHERE lid = ?", args: [lid] })).rows[0];
  assert.equal(row.devices, 3);
});

test("takeDeviceSlot: at the same moment, never more than the cap", async () => {
  const db = await freshDb();
  const now = new Date("2026-10-23T09:00:00Z");
  const lid = newLid();
  const results = await Promise.all(Array.from({ length: 15 }, () => takeDeviceSlot(db, "rankup", lid, 10, now)));
  assert.equal(results.filter(Boolean).length, 10);
});

test("codes: single use, expiry, and a try counted before the compare", async () => {
  const db = await freshDb();
  await ensureHouseholdTables(db);
  const now = new Date("2026-10-23T09:00:00Z");
  const hash = emailHash("a@b.co");
  const base = { purpose: "signin" as const, product: "rankup", emailHash: hash, appUserId: "", now };
  await storeCode(db, { ...base, code: "424242", lid: "L", lidSource: "store", ttlMinutes: 10 });

  const wrong = await checkCode(db, { ...base, code: "000000" });
  assert.deepEqual(wrong, { ok: false, error: "wrong_code", triesLeft: 4 });
  const good = await checkCode(db, { ...base, code: "424242" });
  assert.deepEqual(good, { ok: true, lid: "L", lidSource: "store" });
  assert.deepEqual(await checkCode(db, { ...base, code: "424242" }), { ok: false, error: "expired" });
});

test("codes: the exact expiry instant is expired; a second before is not", async () => {
  const db = await freshDb();
  await ensureHouseholdTables(db);
  const now = new Date("2026-10-23T09:00:00Z");
  const hash = emailHash("a@b.co");
  const base = { purpose: "signin" as const, product: "rankup", emailHash: hash, appUserId: "" };
  await storeCode(db, { ...base, now, code: "111111", lid: "L", lidSource: "store", ttlMinutes: 10 });
  assert.deepEqual(await checkCode(db, { ...base, code: "111111", now: new Date(now.getTime() + 600_000) }), { ok: false, error: "expired" });
  assert.equal((await checkCode(db, { ...base, code: "111111", now: new Date(now.getTime() + 599_000) })).ok, true);
});

test("codes: a decoy never matches, whatever is guessed", async () => {
  const db = await freshDb();
  await ensureHouseholdTables(db);
  const now = new Date("2026-10-23T09:00:00Z");
  const base = { purpose: "signin" as const, product: "rankup", emailHash: emailHash("x@y.zz"), appUserId: "" };
  await storeCode(db, { ...base, now, code: null, lid: null, lidSource: null, ttlMinutes: 10 });
  for (let i = 0; i < 4; i++) {
    const res = await checkCode(db, { ...base, code: String(i).padStart(6, "0"), now });
    assert.deepEqual(res, { ok: false, error: "wrong_code", triesLeft: 4 - i });
  }
});

test("codes: ones that expired over a day ago are purged, newer ones are kept", async () => {
  const db = await freshDb();
  await ensureHouseholdTables(db);
  const base = { purpose: "signin" as const, product: "rankup", appUserId: "", code: null, lid: null, lidSource: null, ttlMinutes: 10 };
  const day0 = new Date("2026-10-20T09:00:00Z");
  await storeCode(db, { ...base, emailHash: emailHash("old@b.co"), now: day0 });
  await storeCode(db, { ...base, emailHash: emailHash("new@b.co"), now: new Date("2026-10-23T08:00:00Z") });
  // (storeCode may already have purged the old one by chance, so only the end state is certain)
  const purged = await purgeOldCodes(db, new Date("2026-10-23T09:00:00Z"));
  assert.ok(purged <= 1);
  assert.equal(await purgeOldCodes(db, new Date("2026-10-23T09:00:00Z")), 0);
  const left = await db.execute("SELECT email_hash FROM household_codes");
  assert.deepEqual(left.rows.map((r) => r.email_hash), [emailHash("new@b.co")]);
});

test("newCode is always six digits; newLid is 32 lower-case hex characters, and they differ", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const c = newCode();
    assert.match(c, /^\d{6}$/);
    seen.add(c);
  }
  assert.ok(seen.size > 1500, "the codes are spread out");
  const a = newLid();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, newLid());
});

test("emailHash: SHA-256 of the trimmed, lower-cased address", () => {
  assert.equal(normaliseEmail("  Parent@Example.COM "), "parent@example.com");
  assert.equal(emailHash(" Parent@Example.COM"), emailHash("parent@example.com"));
  assert.notEqual(emailHash("a@b.co"), emailHash("a@b.com"));
  assert.match(emailHash("a@b.co"), /^[0-9a-f]{64}$/);
  // a value worked out outside this code (sha256 of "parent@example.com")
  assert.equal(emailHash("Parent@Example.com"), "ee9cd2a3ead6d5cc3b5b0bc3cb19592544d1abf56500a5d9eb87129220ea9236");
});
