import test from "node:test";
import assert from "node:assert/strict";
import { hashLicenseKey } from "../../netlify/functions/lib/crypto.js";
import { issueRecord } from "../../netlify/functions/lib/household.js";
import { verifySignedRecord, type SignedRecord } from "../../netlify/functions/lib/household-record.js";
import { ensureLicenseKeysTable, findLicenseByKey } from "../../netlify/functions/lib/licenses.js";
import {
  customDataFrom,
  licenceHashFromCustomData,
  mintLicence,
  type MintDeps,
} from "../../netlify/functions/lib/paddle-licence.js";
import {
  EVERY_DEVICE_PADDLE_PRICE_IDS,
  EVERY_DEVICE_UPGRADE_PADDLE_PRICE_IDS,
  PRICE_ID_TO_PLATFORM,
  PRICE_ID_TO_PRODUCT,
  PRODUCTS,
  isUpgradePaddlePrice,
  licenceTermsFromTransactionItems,
} from "../../netlify/functions/lib/products.js";
import { Clock, freshDb, makeKey } from "./helpers.js";

// The Every device upgrade for a desktop key holder, bought through Paddle with the key's hash in
// the checkout's custom data. A price that is already known stands in for the new one (which is
// created at KL.3): MACOS plays "the upgrade price", WINDOWS plays "a per-platform price".

const WINDOWS = "pri_01knztpnwdqxx8ecnbrjt4zkzq";
const MACOS = "pri_01m194cc17phxmgqdqs737mw2p";
const ZEROED = "pri_01knnyfj5zezrch30qqbzkc378";
const UPGRADE = MACOS;
const item = (id: string) => [{ price: { id } }];

interface Mail {
  to: string;
  key: string;
}

async function world(extra: Partial<MintDeps> = {}) {
  const db = await freshDb();
  const mails: Mail[] = [];
  const issued: Array<{ id: string; purchased: string }> = [];
  const deps: MintDeps = {
    db,
    deviceCap: 10,
    sendKey: async (to, key) => {
      mails.push({ to, key });
    },
    issueHousehold: async (id, purchased) => {
      issued.push({ id, purchased });
    },
    everyDevicePrices: [],
    upgradePrices: [UPGRADE],
    ...extra,
  };
  let n = 0;
  /** Sells a licence the old way (a per-platform price by default) and returns its key and id. */
  const buy = async (price = WINDOWS, product = PRODUCTS.rankup, over: Partial<MintDeps> = {}) => {
    const txn = `txn_buy_${++n}`;
    await mintLicence({ ...deps, ...over }, { transactionId: txn, items: item(price), product, customerEmail: "first@example.net" });
    const key = mails[mails.length - 1].key;
    const row = (await db.execute({ sql: "SELECT id FROM licenses WHERE paddle_txn_id = ?", args: [txn] })).rows[0];
    return { key, id: String(row.id), hash: hashLicenseKey(key) };
  };
  const upgrade = (txn: string, customData: unknown, over: Partial<MintDeps> = {}) =>
    mintLicence({ ...deps, ...over }, {
      transactionId: txn, items: item(UPGRADE), product: PRODUCTS.rankup, customerEmail: "buyer@example.net", customData,
    });
  const licence = async (id: string) => (await db.execute({ sql: "SELECT * FROM licenses WHERE id = ?", args: [id] })).rows[0];
  const count = async (table: string) => Number((await db.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);
  return { db, deps, mails, issued, buy, upgrade, licence, count };
}

/** Collects console.warn lines while `run` works. */
async function warnings<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const real = console.warn;
  console.warn = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    return { result: await run(), lines };
  } finally {
    console.warn = real;
  }
}

test("an upgrade of a per-platform key makes the same licence Every device, with the same key and no new mail", async () => {
  const w = await world();
  const old = await w.buy(WINDOWS);
  assert.equal((await w.licence(old.id)).platform, "windows");
  assert.equal((await w.licence(old.id)).max_activations, 3);

  const out = await w.upgrade("txn_up_1", { licence: old.hash });
  assert.equal(out, "upgraded");

  const row = await w.licence(old.id);
  assert.equal(row.tier, "every_device");
  assert.equal(row.platform, null, "any platform now");
  assert.equal(row.max_activations, 10);
  assert.equal(row.revoked, 0);
  assert.equal(await w.count("licenses"), 1, "no new licence was made");
  assert.equal(w.mails.length, 1, "no email: the key is the same, and the first mail was its only one");
  assert.equal((await findLicenseByKey(w.db, old.hash, "rankup"))?.id, old.id, "the same key still opens it");
  const claim = (await w.db.execute("SELECT * FROM household_upgrades")).rows[0];
  assert.equal(claim.paddle_txn_id, "txn_up_1");
  assert.equal(claim.license_id, old.id);
});

test("a licence that already allows more than the cap keeps its own limit", async () => {
  const w = await world();
  const old = await w.buy(WINDOWS);
  await w.db.execute({ sql: "UPDATE licenses SET max_activations = 12 WHERE id = ?", args: [old.id] });
  assert.equal(await w.upgrade("txn_up_2", { licence: old.hash }), "upgraded");
  assert.equal((await w.licence(old.id)).max_activations, 12);
});

test("an upgrade through a re-issued key finds the same licence", async () => {
  const w = await world();
  const old = await w.buy(WINDOWS);
  await ensureLicenseKeysTable(w.db);
  const reissued = hashLicenseKey("AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-0000-1111");
  await w.db.execute({ sql: "INSERT INTO license_keys (key_hash, license_id) VALUES (?, ?)", args: [reissued, old.id] });

  assert.equal(await w.upgrade("txn_up_3", { licence: reissued }), "upgraded");
  assert.equal((await w.licence(old.id)).tier, "every_device");
  assert.equal(await w.count("licenses"), 1);
  assert.equal(w.mails.length, 1);
});

test("the hash is accepted in either case of hex", async () => {
  const w = await world();
  const old = await w.buy(WINDOWS);
  assert.equal(await w.upgrade("txn_up_4", { licence: old.hash.toUpperCase() }), "upgraded");
});

test("missing or malformed custom data: a new Every device licence and its key, never a lost purchase", async () => {
  const w = await world();
  const old = await w.buy(WINDOWS);
  const cases: Array<[string, unknown, string]> = [
    ["undefined", undefined, "no licence in the custom data"],
    ["null", null, "no licence in the custom data"],
    ["empty object", {}, "no licence in the custom data"],
    ["licence null", { licence: null }, "no licence in the custom data"],
    ["other keys only", { license: old.hash, key: old.hash }, "no licence in the custom data"],
    ["a string", old.hash, "malformed licence in the custom data"],
    ["a number", 5, "malformed licence in the custom data"],
    ["an array", [old.hash], "malformed licence in the custom data"],
    ["licence a number", { licence: 5 }, "malformed licence in the custom data"],
    ["licence the key itself", { licence: old.key }, "malformed licence in the custom data"],
    ["licence too short", { licence: old.hash.slice(1) }, "malformed licence in the custom data"],
    ["licence too long", { licence: old.hash + "0" }, "malformed licence in the custom data"],
    ["licence not hex", { licence: "z".repeat(64) }, "malformed licence in the custom data"],
    ["licence an object", { licence: { hash: old.hash } }, "malformed licence in the custom data"],
  ];
  let i = 0;
  for (const [name, customData, reason] of cases) {
    const txn = `txn_bad_${++i}`;
    const before = w.mails.length;
    const { result, lines } = await warnings(() => w.upgrade(txn, customData));
    assert.equal(result, "minted", name);
    assert.equal(w.mails.length, before + 1, `${name}: the buyer got a key`);
    assert.equal(w.mails[w.mails.length - 1].to, "buyer@example.net");
    const fresh = (await w.db.execute({ sql: "SELECT * FROM licenses WHERE paddle_txn_id = ?", args: [txn] })).rows[0];
    assert.equal(fresh.tier, "every_device", name);
    assert.equal(fresh.platform, null, name);
    assert.equal(fresh.max_activations, 10, name);
    assert.equal(lines.length, 1, name);
    assert.ok(lines[0].includes(txn) && lines[0].includes(reason), `${name}: ${lines[0]}`);
    assert.equal(lines[0].includes(old.hash), false, "the log never carries the key hash");
  }
  // the key holder's own licence was not touched by any of them
  const untouched = await w.licence(old.id);
  assert.equal(untouched.tier, null);
  assert.equal(untouched.platform, "windows");
  assert.equal(untouched.max_activations, 3);
  assert.equal(await w.count("household_upgrades"), 0);
});

test("a hash that matches no licence, or a licence of another product: a new licence", async () => {
  const w = await world();
  const { result, lines } = await warnings(() => w.upgrade("txn_unknown", { licence: hashLicenseKey("NOT-A-KEY") }));
  assert.equal(result, "minted");
  assert.match(lines[0], /no licence matches the key/);

  const zeroed = await w.buy(ZEROED, PRODUCTS.zeroed);
  const other = await warnings(() => w.upgrade("txn_zeroed", { licence: zeroed.hash }));
  assert.equal(other.result, "minted", "a Zeroed key cannot be upgraded with a RankUp price");
  assert.match(other.lines[0], /no licence matches the key/);
  assert.equal((await w.licence(zeroed.id)).tier, null);
});

test("a licence that is already Every device: a new licence, the first is left as it was", async () => {
  const w = await world();
  const full = await w.buy(WINDOWS, PRODUCTS.rankup, { everyDevicePrices: [WINDOWS] });
  assert.equal((await w.licence(full.id)).tier, "every_device");
  const { result, lines } = await warnings(() => w.upgrade("txn_again", { licence: full.hash }));
  assert.equal(result, "minted");
  assert.match(lines[0], /already Every device/);
  assert.equal(await w.count("licenses"), 2);

  // upgrading the same per-platform key twice: the second purchase is a new licence
  const old = await w.buy(WINDOWS);
  assert.equal(await w.upgrade("txn_first", { licence: old.hash }), "upgraded");
  const second = await warnings(() => w.upgrade("txn_second", { licence: old.hash }));
  assert.equal(second.result, "minted");
  assert.match(second.lines[0], /already Every device/);
});

test("a revoked licence is not upgraded: a new licence, the revoked one stays revoked", async () => {
  const w = await world();
  const old = await w.buy(WINDOWS);
  await w.db.execute({ sql: "UPDATE licenses SET revoked = 1 WHERE id = ?", args: [old.id] });
  const { result, lines } = await warnings(() => w.upgrade("txn_revoked", { licence: old.hash }));
  assert.equal(result, "minted");
  assert.match(lines[0], /revoked/);
  const row = await w.licence(old.id);
  assert.equal(row.revoked, 1);
  assert.equal(row.tier, null);
  assert.equal(await w.count("licenses"), 2);
  assert.equal(w.mails.length, 2, "the buyer got the new key");
});

test("the same webhook twice: the second is a duplicate and does nothing", async () => {
  const w = await world();
  const old = await w.buy(WINDOWS);
  assert.equal(await w.upgrade("txn_dup", { licence: old.hash }), "upgraded");
  assert.equal(w.issued.length, 1);
  assert.equal(await w.upgrade("txn_dup", { licence: old.hash }), "duplicate");
  assert.equal(await w.upgrade("txn_dup", undefined), "duplicate", "even if the repeat carries different custom data");
  assert.equal(w.issued.length, 1, "no second record");
  assert.equal(w.mails.length, 1);
  assert.equal(await w.count("household_upgrades"), 1);
  assert.equal(await w.count("licenses"), 1);
});

test("the same webhook twice after a fallback: still one new licence, one mail", async () => {
  const w = await world();
  const first = await warnings(() => w.upgrade("txn_dup2", undefined));
  assert.equal(first.result, "minted");
  const mails = w.mails.length;
  assert.equal(await w.upgrade("txn_dup2", undefined), "duplicate");
  assert.equal(w.mails.length, mails);
  assert.equal(await w.count("licenses"), 1);
});

test("two deliveries at the same moment: one upgrade, one duplicate", async () => {
  const w = await world();
  const old = await w.buy(WINDOWS);
  const results = await Promise.all([w.upgrade("txn_race", { licence: old.hash }), w.upgrade("txn_race", { licence: old.hash })]);
  assert.deepEqual([...results].sort(), ["duplicate", "upgraded"]);
  assert.equal(w.issued.length, 1);
  assert.equal(await w.count("household_upgrades"), 1);
});

test("the household record is issued only when an issuer is given (the flag on)", async () => {
  const off = await world({ issueHousehold: undefined });
  const a = await off.buy(WINDOWS, PRODUCTS.rankup, { issueHousehold: undefined });
  assert.equal(await off.upgrade("txn_off", { licence: a.hash }), "upgraded");
  assert.equal(off.issued.length, 0);
  assert.equal((await off.licence(a.id)).tier, "every_device", "still upgraded; the record is signed on demand later");

  const on = await world();
  const b = await on.buy(WINDOWS, PRODUCTS.rankup, { issueHousehold: undefined });
  await on.db.execute({ sql: "UPDATE licenses SET created_at = '2026-09-01 10:00:00' WHERE id = ?", args: [b.id] });
  assert.equal(await on.upgrade("txn_on", { licence: b.hash }), "upgraded");
  assert.deepEqual(on.issued, [{ id: b.id, purchased: "2026-09-01" }]);
});

test("the record issued for an upgrade is signed, for the same licence, via paddle, dated from the key's purchase", async () => {
  const key = makeKey();
  const clock = new Clock();
  let signed: SignedRecord | null = null;
  const w = await world();
  const old = await w.buy(WINDOWS, PRODUCTS.rankup, { issueHousehold: undefined });
  await w.db.execute({ sql: "UPDATE licenses SET created_at = '2026-09-01 10:00:00' WHERE id = ?", args: [old.id] });
  const out = await w.upgrade("txn_signed", { licence: old.hash }, {
    issueHousehold: async (id, purchased) => {
      signed = await issueRecord({ db: w.db, now: clock.now, signer: () => key.signer }, "rankup", { lid: id, via: "paddle", purchased });
    },
  });
  assert.equal(out, "upgraded");
  assert.ok(signed);
  const s = signed as SignedRecord;
  assert.equal(s.record.lid, old.id);
  assert.equal(s.record.via, "paddle");
  assert.equal(s.record.purchased, "2026-09-01");
  assert.equal(s.record.tier, "every_device");
  assert.equal(verifySignedRecord(s, key.publicKey), true);
});

test("a failed record never undoes the upgrade; a fallback licence gets its record too", async () => {
  const w = await world({
    issueHousehold: async () => {
      throw new Error("no signing key");
    },
  });
  const old = await w.buy(WINDOWS, PRODUCTS.rankup, { issueHousehold: undefined });
  const realError = console.error;
  console.error = () => {};
  try {
    assert.equal(await w.upgrade("txn_noissue", { licence: old.hash }), "upgraded");
  } finally {
    console.error = realError;
  }
  assert.equal((await w.licence(old.id)).tier, "every_device");

  const w2 = await world();
  const { result } = await warnings(() => w2.upgrade("txn_fresh", undefined));
  assert.equal(result, "minted");
  const fresh = (await w2.db.execute("SELECT id FROM licenses WHERE paddle_txn_id = 'txn_fresh'")).rows[0];
  assert.deepEqual(w2.issued, [{ id: String(fresh.id), purchased: w2.issued[0].purchased }]);
});

test("customDataFrom and licenceHashFromCustomData", () => {
  const hash = hashLicenseKey("X");
  assert.deepEqual(customDataFrom({ customData: { licence: hash } }), { licence: hash });
  assert.deepEqual(customDataFrom({ custom_data: { licence: hash } }), { licence: hash });
  assert.equal(customDataFrom({}), null);
  assert.equal(customDataFrom(undefined), null);
  assert.deepEqual(licenceHashFromCustomData({ licence: hash }), { hash });
  assert.deepEqual(licenceHashFromCustomData({ licence: hash.toUpperCase() }), { hash });
  assert.deepEqual(licenceHashFromCustomData(null), { problem: "missing" });
  assert.deepEqual(licenceHashFromCustomData(undefined), { problem: "missing" });
  assert.deepEqual(licenceHashFromCustomData({}), { problem: "missing" });
  assert.deepEqual(licenceHashFromCustomData("x"), { problem: "malformed" });
  assert.deepEqual(licenceHashFromCustomData({ licence: "x" }), { problem: "malformed" });
});

test("the upgrade price list: empty until KL.3, well formed whatever it holds", () => {
  for (const id of EVERY_DEVICE_UPGRADE_PADDLE_PRICE_IDS) {
    assert.ok(id in PRICE_ID_TO_PRODUCT, `${id} must also be in PRICE_ID_TO_PRODUCT`);
    assert.equal(id in PRICE_ID_TO_PLATFORM, false, `${id} must not be in PRICE_ID_TO_PLATFORM`);
    assert.equal(EVERY_DEVICE_PADDLE_PRICE_IDS.includes(id), false, `${id} is on both Every device lists`);
  }
  // an upgrade price that cannot upgrade is worth a whole Every device licence
  const product = PRODUCTS.rankup;
  assert.deepEqual(licenceTermsFromTransactionItems(item(MACOS), product, 10, [MACOS]), {
    platform: null, tier: "every_device", maxActivations: 10,
  });
  assert.equal(isUpgradePaddlePrice(item(MACOS), [MACOS]), true);
  assert.equal(isUpgradePaddlePrice(item(WINDOWS), [MACOS]), false);
  assert.equal(isUpgradePaddlePrice(item("pri_unknown"), ["pri_unknown"]), false, "an unknown price is never an upgrade");
  assert.equal(isUpgradePaddlePrice(undefined, [MACOS]), false);
  assert.equal(isUpgradePaddlePrice(item(MACOS)), EVERY_DEVICE_UPGRADE_PADDLE_PRICE_IDS.includes(MACOS));
});

test("a normal sale is untouched by the upgrade code (no claim row, tier and platform as before)", async () => {
  const w = await world();
  const bought = await w.buy(WINDOWS);
  const row = await w.licence(bought.id);
  assert.equal(row.tier, null);
  assert.equal(row.platform, "windows");
  assert.equal(await w.count("household_upgrades"), 0);
  assert.equal(w.mails.length, 1);
});
