import test from "node:test";
import assert from "node:assert/strict";
import { issueRecord } from "../../netlify/functions/lib/household.js";
import { verifySignedRecord, type SignedRecord } from "../../netlify/functions/lib/household-record.js";
import { findLicenseByKey } from "../../netlify/functions/lib/licenses.js";
import { hashLicenseKey } from "../../netlify/functions/lib/crypto.js";
import { mintLicence, type MintDeps } from "../../netlify/functions/lib/paddle-licence.js";
import {
  EVERY_DEVICE_PADDLE_PRICE_IDS,
  EVERY_DEVICE_STORE_PRODUCT_IDS,
  HOUSEHOLD_PRODUCTS,
  PRICE_ID_TO_PLATFORM,
  PRICE_ID_TO_PRODUCT,
  PRODUCTS,
  isHouseholdProduct,
  licenceTermsFromTransactionItems,
  platformFromTransactionItems,
} from "../../netlify/functions/lib/products.js";
import { resendKeys, type Purchase } from "../../netlify/functions/lib/resend-key.js";
import { Clock, freshDb, makeKey } from "./helpers.js";

// Paddle: what an Every device price means for a new licence, and that today's prices still
// mean what they did. The real Paddle SDK and the real mail are not involved.

const WINDOWS = "pri_01knztpnwdqxx8ecnbrjt4zkzq";
const MACOS = "pri_01m194cc17phxmgqdqs737mw2p";
const ZEROED = "pri_01knnyfj5zezrch30qqbzkc378";
const item = (id: string) => [{ price: { id } }];

test("the lists the founder fills in at KL.3 are well formed, whatever they hold", () => {
  for (const id of EVERY_DEVICE_PADDLE_PRICE_IDS) {
    assert.ok(id in PRICE_ID_TO_PRODUCT, `${id} must also be in PRICE_ID_TO_PRODUCT, or the webhook refuses it`);
    assert.equal(id in PRICE_ID_TO_PLATFORM, false, `${id} must not be in PRICE_ID_TO_PLATFORM: Every device is for any platform`);
  }
  for (const [productId, slug] of Object.entries(EVERY_DEVICE_STORE_PRODUCT_IDS)) {
    assert.ok(isHouseholdProduct(slug), `${productId} belongs to a product with no household endpoints`);
    assert.notEqual(productId, "rankupchess_premium_unlock", "the One platform product must not be listed");
  }
  assert.deepEqual(HOUSEHOLD_PRODUCTS, ["rankup"]);
  assert.equal(isHouseholdProduct("rankup"), true);
  assert.equal(isHouseholdProduct("zeroed"), false);
  assert.equal(isHouseholdProduct(undefined), false);
});

test("terms: today's prices give exactly what they gave before", () => {
  assert.deepEqual(licenceTermsFromTransactionItems(item(WINDOWS), PRODUCTS.rankup, 10), {
    platform: "windows", tier: null, maxActivations: 3,
  });
  assert.deepEqual(licenceTermsFromTransactionItems(item(MACOS), PRODUCTS.rankup, 10), {
    platform: "macos", tier: null, maxActivations: 3,
  });
  assert.deepEqual(licenceTermsFromTransactionItems(item(ZEROED), PRODUCTS.zeroed, 10), {
    platform: null, tier: null, maxActivations: 5,
  });
  assert.deepEqual(licenceTermsFromTransactionItems([], PRODUCTS.rankup, 10), {
    platform: null, tier: null, maxActivations: 3,
  });
  assert.equal(platformFromTransactionItems(item(WINDOWS)), "windows");
  assert.equal(platformFromTransactionItems(item(MACOS)), "macos");
  assert.equal(platformFromTransactionItems(undefined), null);
});

test("terms: an Every device price is for any platform, tier every_device, the household's activations", () => {
  // A price that is already known stands in for the new one, which does not exist yet.
  assert.deepEqual(licenceTermsFromTransactionItems(item(MACOS), PRODUCTS.rankup, 10, [MACOS]), {
    platform: null, tier: "every_device", maxActivations: 10,
  });
  assert.equal(licenceTermsFromTransactionItems(item(MACOS), PRODUCTS.rankup, 7, [MACOS]).maxActivations, 7);
  // only the line item that decides the product counts
  const items = [{ price: { id: "pri_unknown" } }, { price: { id: WINDOWS } }, { price: { id: MACOS } }];
  assert.equal(licenceTermsFromTransactionItems(items, PRODUCTS.rankup, 10, [MACOS]).tier, null);
  assert.equal(licenceTermsFromTransactionItems(items, PRODUCTS.rankup, 10, [WINDOWS]).tier, "every_device");
});

function mintWorld(overrides: Partial<MintDeps> = {}) {
  const sent: Array<{ to: string; key: string; platform: string | null }> = [];
  const issued: Array<{ id: string; purchased: string }> = [];
  const deps = async (): Promise<MintDeps & { db: Awaited<ReturnType<typeof freshDb>> }> => ({
    db: await freshDb(),
    deviceCap: 10,
    sendKey: async (to, key, _product, opts) => {
      sent.push({ to, key, platform: opts.platform });
    },
    issueHousehold: async (id, purchased) => {
      issued.push({ id, purchased });
    },
    everyDevicePrices: [MACOS],
    ...overrides,
  });
  return { sent, issued, deps };
}

test("mint: a per-platform price gives the licence it always gave, and no household record", async () => {
  const { sent, issued, deps } = mintWorld();
  const d = await deps();
  const out = await mintLicence(d, {
    transactionId: "txn_1", items: item(WINDOWS), product: PRODUCTS.rankup, customerEmail: "buyer@example.net",
  });
  assert.equal(out, "minted");
  const row = (await d.db.execute("SELECT * FROM licenses WHERE paddle_txn_id = 'txn_1'")).rows[0];
  assert.equal(row.platform, "windows");
  assert.equal(row.tier, null);
  assert.equal(row.max_activations, 3);
  assert.equal(row.email, "not-stored", "the buyer's address is not kept");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "buyer@example.net");
  assert.equal(sent[0].platform, "windows");
  assert.match(sent[0].key, /^([0-9A-F]{4}-){7}[0-9A-F]{4}$/);
  assert.equal(issued.length, 0);
  // the key mailed is the key stored (as a hash)
  const found = await findLicenseByKey(d.db, hashLicenseKey(sent[0].key), "rankup");
  assert.equal(found?.id, row.id);
});

test("mint: an Every device price makes an Every device licence and issues the record alongside the key", async () => {
  const { sent, issued, deps } = mintWorld();
  const d = await deps();
  const out = await mintLicence(d, {
    transactionId: "txn_2", items: item(MACOS), product: PRODUCTS.rankup, customerEmail: "buyer@example.net",
  });
  assert.equal(out, "minted");
  const row = (await d.db.execute("SELECT * FROM licenses WHERE paddle_txn_id = 'txn_2'")).rows[0];
  assert.equal(row.tier, "every_device");
  assert.equal(row.platform, null, "any platform, though this price was the Mac one");
  assert.equal(row.max_activations, 10);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].platform, null);
  assert.equal(issued.length, 1);
  assert.equal(issued[0].id, row.id);
  assert.equal(issued[0].purchased, String(row.created_at).slice(0, 10));
});

test("mint: the record issued is signed, for this licence, via paddle", async () => {
  const key = makeKey();
  const clock = new Clock();
  let signed: SignedRecord | null = null;
  const { deps } = mintWorld();
  const d = await deps();
  d.issueHousehold = async (id, purchased) => {
    signed = await issueRecord({ db: d.db, now: clock.now, signer: () => key.signer }, "rankup", {
      lid: id, via: "paddle", purchased,
    });
  };
  await mintLicence(d, { transactionId: "txn_3", items: item(MACOS), product: PRODUCTS.rankup, customerEmail: "a@b.co" });
  const row = (await d.db.execute("SELECT id FROM licenses WHERE paddle_txn_id = 'txn_3'")).rows[0];
  assert.ok(signed);
  const s = signed as SignedRecord;
  assert.equal(s.record.lid, row.id);
  assert.equal(s.record.via, "paddle");
  assert.equal(s.record.tier, "every_device");
  assert.equal(verifySignedRecord(s, key.publicKey), true);
});

test("mint: no household record while no issuer is given (the flag off)", async () => {
  const { issued, deps } = mintWorld({ issueHousehold: undefined });
  const d = await deps();
  await mintLicence(d, { transactionId: "txn_4", items: item(MACOS), product: PRODUCTS.rankup, customerEmail: "a@b.co" });
  const row = (await d.db.execute("SELECT tier FROM licenses WHERE paddle_txn_id = 'txn_4'")).rows[0];
  assert.equal(row.tier, "every_device", "still tagged, so a record can be signed on demand later");
  assert.equal(issued.length, 0);
});

test("mint: the same transaction twice is a duplicate and sends nothing", async () => {
  const { sent, issued, deps } = mintWorld();
  const d = await deps();
  const input = { transactionId: "txn_5", items: item(MACOS), product: PRODUCTS.rankup, customerEmail: "a@b.co" };
  assert.equal(await mintLicence(d, input), "minted");
  assert.equal(await mintLicence(d, input), "duplicate");
  assert.equal(sent.length, 1);
  assert.equal(issued.length, 1);
  assert.equal((await d.db.execute("SELECT COUNT(*) AS n FROM licenses")).rows[0].n, 1);
});

test("mint: a failed mail or a failed household record never undoes the licence", async () => {
  const { deps } = mintWorld({
    sendKey: async () => {
      throw new Error("Resend is down");
    },
    issueHousehold: async () => {
      throw new Error("no signing key");
    },
  });
  const d = await deps();
  const out = await mintLicence(d, { transactionId: "txn_6", items: item(MACOS), product: PRODUCTS.rankup, customerEmail: "a@b.co" });
  assert.equal(out, "minted");
  assert.equal((await d.db.execute("SELECT COUNT(*) AS n FROM licenses")).rows[0].n, 1);
});

test("mint: any other database error is thrown, so the webhook answers 500 and Paddle retries", async () => {
  const { deps } = mintWorld();
  const d = await deps();
  await d.db.execute("DROP TABLE licenses");
  await assert.rejects(
    mintLicence(d, { transactionId: "txn_7", items: item(MACOS), product: PRODUCTS.rankup, customerEmail: "a@b.co" })
  );
});

test("mint: works on a licenses table from before platform and tier existed", async () => {
  const { deps } = mintWorld();
  const d = await deps();
  await d.db.execute("DROP TABLE licenses");
  await d.db.execute(`CREATE TABLE licenses (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), key_hash TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
    paddle_txn_id TEXT NOT NULL UNIQUE, product TEXT NOT NULL DEFAULT 'zeroed', max_activations INTEGER NOT NULL DEFAULT 3,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), revoked INTEGER NOT NULL DEFAULT 0)`);
  await mintLicence(d, { transactionId: "old_1", items: item(WINDOWS), product: PRODUCTS.rankup, customerEmail: "a@b.co" });
  const row = (await d.db.execute("SELECT platform, tier FROM licenses")).rows[0];
  assert.equal(row.platform, "windows");
  assert.equal(row.tier, null);
});

test("resend-key's late mint still mints what it always did", async () => {
  const db = await freshDb();
  const sent: Array<{ platform: string | null }> = [];
  const send = async (_to: string, _key: string, _p: unknown, opts: { reissue: boolean; platform: string | null }) => {
    sent.push({ platform: opts.platform });
  };
  async function* purchases(): AsyncGenerator<Purchase> {
    yield { id: "late_1", items: item(WINDOWS), customerEmail: "a@b.co" };
    yield { id: "late_2", items: item(MACOS), customerEmail: "a@b.co" };
  }
  const results = await resendKeys({ db, send: send as never, deviceCap: 10 }, purchases(), "rankup");
  assert.deepEqual(results.map((r) => r.outcome), ["minted", "minted"]);
  const rows = (await db.execute("SELECT paddle_txn_id, platform, tier, max_activations FROM licenses ORDER BY paddle_txn_id")).rows;
  assert.deepEqual(rows.map((r) => [r.platform, r.tier, r.max_activations]), [["windows", null, 3], ["macos", null, 3]]);
});

test("a licence row from before the tier column still reads", async () => {
  const db = await freshDb(false);
  await db.execute(`CREATE TABLE licenses (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), key_hash TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
    paddle_txn_id TEXT NOT NULL UNIQUE, product TEXT NOT NULL DEFAULT 'zeroed', max_activations INTEGER NOT NULL DEFAULT 3,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), revoked INTEGER NOT NULL DEFAULT 0)`);
  await db.execute({
    sql: "INSERT INTO licenses (key_hash, email, paddle_txn_id, product) VALUES (?, 'x', 't', 'rankup')",
    args: [hashLicenseKey("AAAA-BBBB")],
  });
  const row = await findLicenseByKey(db, hashLicenseKey("AAAA-BBBB"), "rankup");
  assert.ok(row);
  assert.equal(row.tier, null);
  assert.equal(row.platform, null);
  assert.match(String(row.created_at), /^\d{4}-\d{2}-\d{2} /);
});
