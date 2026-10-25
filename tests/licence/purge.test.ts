import { execFileSync } from "node:child_process";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Client } from "@libsql/client";
import { getDb } from "../../netlify/functions/lib/db.js";
import { RETENTION_HOURS, purgeHousehold } from "../../netlify/functions/lib/household-purge.js";
import { addLink, ensureHouseholdTables } from "../../netlify/functions/lib/household-store.js";
import { addStorePurchase, freshDb, lastDbUrl, makeWorld, TEST_EMAIL_KEY, testEmailHash } from "./helpers.js";

// The hourly retention run: what it deletes (codes that stopped working over 24 hours ago, hits
// older than 24 hours) and what it leaves alone (links, entitlements, issued records, devices).

const NOW = new Date("2026-10-23T03:17:00Z");
const H = 3_600_000;
const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();
const DAY = RETENTION_HOURS * H;

let counter = 0;
/** A code row with the given times (ISO strings), written straight into the table. */
async function code(db: Client, label: string, o: { created: string; expires: string; closed?: string | null }) {
  const id = `code-${label}-${++counter}`;
  await db.execute({
    sql: `INSERT INTO household_codes (id, purpose, product, email_hash, app_user_id, salt, code_hash, expires_at, closed_at, created_at)
          VALUES (?, 'signin', 'rankup', ?, '', 'salt', 'hash', ?, ?, ?)`,
    args: [id, testEmailHash(`${label}@example.com`), o.expires, o.closed ?? null, o.created],
  });
  return id;
}
const hit = (db: Client, at: string) =>
  db.execute({ sql: "INSERT INTO household_hits (bucket, at) VALUES (?, ?)", args: ["email:test", at] });
const price = (db: Client, country: string, fetchedAt: string) =>
  db.execute({
    sql: "INSERT OR REPLACE INTO household_price_cache (product, country, platform, body, fetched_at) VALUES ('rankup', ?, 'web', '{}', ?)",
    args: [country, fetchedAt],
  });
const priceCountries = async (db: Client) =>
  (await db.execute("SELECT country FROM household_price_cache ORDER BY country")).rows.map((r) => String(r.country));
const codeIds = async (db: Client) => (await db.execute("SELECT id FROM household_codes ORDER BY id")).rows.map((r) => String(r.id));
const hitTimes = async (db: Client) => (await db.execute("SELECT at FROM household_hits ORDER BY at")).rows.map((r) => String(r.at));

test("the retention figure is 24 hours", () => {
  assert.equal(RETENTION_HOURS, 24);
});

test("codes: ones that expired more than 24 hours ago go; ones just inside the 24 hours stay", async () => {
  const db = await freshDb();
  // expires at NOW-24h-1s: dead for just over a day
  const outside = await code(db, "outside", { created: iso(-DAY - 601_000), expires: iso(-DAY - 1000) });
  // expires at NOW-24h+1s: dead for just under a day
  const inside = await code(db, "inside", { created: iso(-DAY + 1000 - 600_000), expires: iso(-DAY + 1000) });
  // expires exactly at NOW-24h: the cutoff itself is not older than the cutoff
  const edge = await code(db, "edge", { created: iso(-DAY - 600_000), expires: iso(-DAY) });
  // still live
  const live = await code(db, "live", { created: iso(-60_000), expires: iso(540_000) });

  const result = await purgeHousehold(db, NOW);
  assert.equal(result.codes, 1);
  assert.deepEqual(await codeIds(db), [edge, inside, live].sort());
  assert.equal((await codeIds(db)).includes(outside), false);
});

test("codes: a used or replaced code counts from when it was closed, not from when it would have expired", async () => {
  const db = await freshDb();
  // created 24h+1m before now, closed (used) 1s past the 24h line, would only have expired 9 minutes later
  const usedOutside = await code(db, "used-out", {
    created: iso(-DAY - 60_000), expires: iso(-DAY + 540_000), closed: iso(-DAY - 1000),
  });
  // closed (replaced) 1s inside the 24h line
  const replacedInside = await code(db, "replaced-in", {
    created: iso(-DAY + 1000 - 60_000), expires: iso(-DAY + 540_000), closed: iso(-DAY + 1000),
  });
  // closed long ago but the row says it expires later still (cannot happen; the earlier time rules)
  const closedAfterExpiry = await code(db, "late-close", {
    created: iso(-DAY - 700_000), expires: iso(-DAY - 100_000), closed: iso(-DAY + 5000),
  });

  const result = await purgeHousehold(db, NOW);
  assert.equal(result.codes, 2);
  assert.deepEqual(await codeIds(db), [replacedInside]);
  void usedOutside;
  void closedAfterExpiry;
});

test("codes: decoys and link codes go the same way as real ones", async () => {
  const db = await freshDb();
  await ensureHouseholdTables(db);
  await db.execute({
    sql: `INSERT INTO household_codes (id, purpose, product, email_hash, app_user_id, lid, salt, code_hash, expires_at, created_at)
          VALUES ('decoy', 'signin', 'rankup', 'h', '', NULL, 's', 'c', ?, ?)`,
    args: [iso(-DAY - 1000), iso(-DAY - 601_000)],
  });
  await db.execute({
    sql: `INSERT INTO household_codes (id, purpose, product, email_hash, app_user_id, salt, code_hash, expires_at, created_at)
          VALUES ('link', 'link', 'rankup', 'h', 'user-1', 's', 'c', ?, ?)`,
    args: [iso(-DAY - 2000), iso(-DAY - 602_000)],
  });
  assert.equal((await purgeHousehold(db, NOW)).codes, 2);
  assert.deepEqual(await codeIds(db), []);
});

test("hits: older than 24 hours go, 24 hours or less stay", async () => {
  const db = await freshDb();
  await hit(db, iso(-DAY - 1000));
  await hit(db, iso(-DAY - 1));
  await hit(db, iso(-DAY));
  await hit(db, iso(-DAY + 1000));
  await hit(db, iso(-2 * H));
  await hit(db, iso(-1000));
  const result = await purgeHousehold(db, NOW);
  assert.equal(result.hits, 2);
  assert.deepEqual(await hitTimes(db), [iso(-DAY), iso(-DAY + 1000), iso(-2 * H), iso(-1000)].sort());
});

test("cached prices: stored over 24 hours ago go, 24 hours or less stay", async () => {
  const db = await freshDb();
  await price(db, "AA", iso(-DAY - 1000));
  await price(db, "BB", iso(-DAY));
  await price(db, "CC", iso(-DAY + 1000));
  await price(db, "DD", iso(-30 * 60_000));
  const result = await purgeHousehold(db, NOW);
  assert.equal(result.prices, 1);
  assert.deepEqual(await priceCountries(db), ["BB", "CC", "DD"]);
});

test("a run with nothing to delete deletes nothing, and a second run finds nothing new", async () => {
  const db = await freshDb();
  assert.deepEqual(await purgeHousehold(db, NOW), { codes: 0, hits: 0, prices: 0 });
  await code(db, "old", { created: iso(-3 * DAY), expires: iso(-3 * DAY + 600_000) });
  await hit(db, iso(-3 * DAY));
  assert.deepEqual(await purgeHousehold(db, NOW), { codes: 1, hits: 1, prices: 0 });
  assert.deepEqual(await purgeHousehold(db, NOW), { codes: 0, hits: 0, prices: 0 });
});

test("it works on a database that has no household tables yet", async () => {
  const db = await freshDb(false);
  assert.deepEqual(await purgeHousehold(db, NOW), { codes: 0, hits: 0, prices: 0 });
});

test("it leaves the ledger alone: links, entitlements (revoked ones too), issued records and device counts", async () => {
  const w = await makeWorld();
  const lid = await addStorePurchase(w, { appUserId: "u1", purchased: "2026-08-01" });
  const refunded = await addStorePurchase(w, { appUserId: "u2", purchased: "2026-08-02" });
  await addLink(w.db, "rankup", testEmailHash("parent@example.com"), "u1");
  const issued = await w.call("fetch", { product: "rankup", appUserId: "u1", platform: "ios" });
  assert.equal(issued.status, 200);
  await w.db.execute({ sql: "UPDATE household_store_entitlements SET revoked = 1 WHERE lid = ?", args: [refunded] });
  await w.db.execute({ sql: "INSERT INTO household_devices (product, lid, devices, updated_at) VALUES ('rankup', ?, 3, ?)", args: [lid, iso(-30 * DAY)] });
  await w.db.execute({ sql: "INSERT INTO household_upgrades (paddle_txn_id, license_id) VALUES ('txn_x', 'lic_x')", args: [] });

  const snapshot = async () =>
    JSON.stringify(
      await Promise.all(
        ["household_store_entitlements", "household_email_links", "household_issued", "household_devices", "household_upgrades"].map(
          async (t) => (await w.db.execute(`SELECT * FROM ${t} ORDER BY 1, 2`)).rows.map((r) => ({ ...r }))
        )
      )
    );
  const before = await snapshot();
  // a year on: everything with a clock has long since gone, nothing else has moved
  await purgeHousehold(w.db, new Date(NOW.getTime() + 365 * DAY));
  assert.equal(await snapshot(), before);
});

test("a refunded entitlement keeps its row but can no longer issue a record, however long after", async () => {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: "u1", transactionId: "T-REFUND" });
  await addLink(w.db, "rankup", testEmailHash("parent@example.com"), "u1");
  const first = await w.call("fetch", { product: "rankup", appUserId: "u1", platform: "ios" });
  assert.equal(first.status, 200);

  await w.db.execute({ sql: "UPDATE household_store_entitlements SET revoked = 1, revoked_at = ?", args: [iso(0)] });
  await purgeHousehold(w.db, new Date(NOW.getTime() + 400 * DAY));
  w.clock.t = NOW.getTime() + 400 * DAY;

  // the row is still there (the ledger) ...
  const rows = (await w.db.execute("SELECT revoked FROM household_store_entitlements")).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].revoked, 1);
  // ... the link too, but nothing signs, links or fetches for it any more
  assert.equal((await w.db.execute("SELECT COUNT(*) AS n FROM household_email_links")).rows[0].n, 1);
  assert.equal((await w.call("fetch", { product: "rankup", appUserId: "u1", platform: "ios" })).status, 404);
  const sent = w.sent.length;
  await w.call("signinStart", { product: "rankup", email: "parent@example.com" });
  assert.equal(w.sent.length, sent, "no sign-in code for a refunded purchase");
  await w.call("linkStart", { product: "rankup", appUserId: "u1", email: "other@example.com" });
  assert.equal(w.sent.length, sent, "no link code either");
});

test("support's one line deletes a family's linked email, and only theirs", async () => {
  const w = await makeWorld();
  await addStorePurchase(w, { appUserId: "u1" });
  await addStorePurchase(w, { appUserId: "u2" });
  await addLink(w.db, "rankup", testEmailHash("parent@example.com"), "u1");
  await addLink(w.db, "rankup", testEmailHash("other@example.com"), "u2");

  // the hash as the doc tells support to compute it: the script, with the server's key
  const out = execFileSync(process.execPath, ["scripts/household-email-hash.mjs", " Parent@Example.com "], {
    env: { ...process.env, HOUSEHOLD_EMAIL_KEY: TEST_EMAIL_KEY.toString("base64") },
    encoding: "utf8",
  });
  const hash = out.trim();
  assert.equal(hash, testEmailHash("parent@example.com"));
  const res = await w.db.execute({ sql: "DELETE FROM household_email_links WHERE email_hash = ?", args: [hash] });
  assert.equal(res.rowsAffected, 1);

  await w.call("signinStart", { product: "rankup", email: "parent@example.com" });
  assert.equal(w.sent.length, 0, "the deleted address no longer signs in");
  await w.call("signinStart", { product: "rankup", email: "other@example.com" });
  assert.equal(w.sent.length, 1, "the other family does");
  assert.equal((await w.call("fetch", { product: "rankup", appUserId: "u1", platform: "ios" })).status, 200, "the purchase itself is untouched");
});

// ---------------------------------------------------------------------------------------------
// The scheduled function file

const saved: Record<string, string | undefined> = {};
before(() => {
  for (const k of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"]) saved[k] = process.env[k];
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

test("household-purge.ts: an hourly schedule, and a handler that runs the purge on the database", async () => {
  const mod = await import("../../netlify/functions/household-purge.js");
  const schedule = String(mod.config.schedule);
  const fields = schedule.split(" ");
  assert.equal(fields.length, 5, schedule);
  assert.deepEqual(fields.slice(1), ["*", "*", "*", "*"], "every hour");
  assert.match(fields[0], /^\d+$/, "at a fixed minute");

  const db = await freshDb();
  process.env.TURSO_DATABASE_URL = lastDbUrl();
  process.env.TURSO_AUTH_TOKEN = "test-token-not-real";
  const realNow = Date.now();
  await code(db, "old", { created: new Date(realNow - 3 * DAY).toISOString(), expires: new Date(realNow - 3 * DAY + 600_000).toISOString() });
  await code(db, "fresh", { created: new Date(realNow - 60_000).toISOString(), expires: new Date(realNow + 540_000).toISOString() });
  await hit(db, new Date(realNow - 3 * DAY).toISOString());
  await hit(db, new Date(realNow - 60_000).toISOString());
  await price(db, "DE", new Date(realNow - 3 * DAY).toISOString());
  await price(db, "GB", new Date(realNow - 60_000).toISOString());

  const log = console.log;
  console.log = () => {};
  try {
    const res = await mod.default(new Request("https://x/", { method: "POST", body: JSON.stringify({ next_run: "x" }) }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, codes: 1, hits: 1, prices: 1 });
  } finally {
    console.log = log;
  }
  assert.equal((await codeIds(db)).length, 1);
  assert.equal((await hitTimes(db)).length, 1);
});

test("household-purge.ts: a database problem is a 500 that says nothing", async () => {
  const mod = await import("../../netlify/functions/household-purge.js");
  const saveUrl = process.env.TURSO_DATABASE_URL;
  // getDb() has cached its client by now, so make that client fail instead of the environment
  const real = getDb();
  const realExecute = real.execute.bind(real);
  const realMultiple = real.executeMultiple.bind(real);
  (real as { execute: unknown }).execute = async () => {
    throw new Error("database is down");
  };
  (real as { executeMultiple: unknown }).executeMultiple = async () => {
    throw new Error("database is down");
  };
  const err = console.error;
  console.error = () => {};
  try {
    // the tables were created by the previous test, so the run reaches the failing DELETE
    const res = await mod.default(new Request("https://x/", { method: "POST" }));
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { ok: false });
  } finally {
    console.error = err;
    (real as { execute: unknown }).execute = realExecute;
    (real as { executeMultiple: unknown }).executeMultiple = realMultiple;
    process.env.TURSO_DATABASE_URL = saveUrl;
  }
});
