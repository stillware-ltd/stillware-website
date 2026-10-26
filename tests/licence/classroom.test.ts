import test from "node:test";
import assert from "node:assert/strict";
import { householdTierOfLicence } from "../../netlify/functions/lib/household.js";
import { anyPaddleHouseholdLicence, ensureHouseholdTables } from "../../netlify/functions/lib/household-store.js";
import { ensureLicenceTierColumn } from "../../netlify/functions/lib/licenses.js";
import { freshDb } from "./helpers.js";

// Classroom licences (RankUp DECISIONS.md E-26) are free keys minted with the txn id
// "classroom-<label>-<year>": Premium and 30 profiles on the computers they activate on. The
// switch-date rule ("a licence bought before HOUSEHOLD_UPGRADE_BEFORE is Every device") is for
// earlier buyers, so it skips them: otherwise one minted before 28 October 2026 would become a
// household licence whose backups unlock any number of devices (found 26 October 2026; the
// live database then held no classroom key).

const BEFORE = "2026-10-28";
const row = (over: Record<string, unknown> = {}) => ({
  revoked: 0, tier: null, created_at: "2026-10-05 09:00:00", paddle_txn_id: "txn_01abc", ...over,
});

test("rule: an ordinary licence from before the switch date is the free upgrade", () => {
  assert.deepEqual(householdTierOfLicence(row(), BEFORE), { via: "upgrade", purchased: "2026-10-05" });
});

test("rule: a classroom licence from before the switch date is not", () => {
  assert.equal(householdTierOfLicence(row({ paddle_txn_id: "classroom-oakwood-chess-club-2026" }), BEFORE), null);
  assert.equal(householdTierOfLicence(row({ paddle_txn_id: "classroom-x-2025", created_at: "2025-01-01 00:00:00" }), BEFORE), null);
});

test("rule: an Every device tier still counts, and a revoked licence never does", () => {
  assert.deepEqual(householdTierOfLicence(row({ tier: "every_device" }), BEFORE), { via: "paddle", purchased: "2026-10-05" });
  assert.equal(householdTierOfLicence(row({ revoked: 1 }), BEFORE), null);
});

test("rule: a licence with no transaction id is treated as an ordinary one", () => {
  assert.deepEqual(householdTierOfLicence(row({ paddle_txn_id: null }), BEFORE), { via: "upgrade", purchased: "2026-10-05" });
});

test("sign-in's quick check: classroom licences alone are not a reason to ask Paddle", async () => {
  const db = await freshDb();
  await ensureHouseholdTables(db);
  await ensureLicenceTierColumn(db);
  const add = (id: string, txn: string, created: string) =>
    db.execute({
      sql: `INSERT INTO licenses (id, key_hash, email, paddle_txn_id, product, max_activations, created_at, revoked)
            VALUES (?, ?, 'not-stored', ?, 'rankup', 10, ?, 0)`,
      args: [id, `hash-${id}`, txn, created],
    });
  await add("c1", "classroom-oakwood-chess-club-2026", "2026-10-05 09:00:00");
  assert.equal(await anyPaddleHouseholdLicence(db, "rankup", BEFORE), false);
  await add("p1", "txn_01paid", "2026-10-05 09:00:00");
  assert.equal(await anyPaddleHouseholdLicence(db, "rankup", BEFORE), true);
});
