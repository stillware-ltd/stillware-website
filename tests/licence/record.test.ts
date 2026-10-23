import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  assertValidRecord,
  canonicalBytes,
  issuedStamp,
  loadSigner,
  signRecord,
  verifySignedRecord,
  type HouseholdRecord,
} from "../../netlify/functions/lib/household-record.js";
import { makeKey } from "./helpers.js";

// The record's canonical bytes (contract §4) and its Ed25519 signature (§3).

const FIXED: HouseholdRecord = {
  v: 1,
  product: "rankup",
  lid: "0123456789abcdef0123456789abcdef",
  tier: "every_device",
  via: "paddle",
  purchased: "2026-10-01",
  issued: "2026-10-23T09:30:00Z",
};

// Written out by hand, not produced by the code under test: keys in sorted order
// (issued, lid, product, purchased, tier, v, via), no space anywhere, `v` as a bare integer.
const FIXED_TEXT =
  '{"issued":"2026-10-23T09:30:00Z","lid":"0123456789abcdef0123456789abcdef","product":"rankup",' +
  '"purchased":"2026-10-01","tier":"every_device","v":1,"via":"paddle"}';

test("canonical bytes: a fixed record gives exactly the bytes written by hand", () => {
  const bytes = canonicalBytes(FIXED);
  assert.equal(bytes.toString("utf8"), FIXED_TEXT);
  assert.equal(bytes.length, 161); // counted by hand: 33 + 41 + 19 + 25 + 22 + 6 + 15
  // The first fifteen bytes:  {  "  i  s  s  u  e  d  "  :  "  2  0  2  6
  assert.deepEqual(
    [...bytes.subarray(0, 15)],
    [0x7b, 0x22, 0x69, 0x73, 0x73, 0x75, 0x65, 0x64, 0x22, 0x3a, 0x22, 0x32, 0x30, 0x32, 0x36]
  );
  assert.equal(bytes[bytes.length - 1], 0x7d); // }
});

test("canonical bytes: a second fixed record (upgrade, year-end dates)", () => {
  const record: HouseholdRecord = {
    ...FIXED,
    lid: "ffffffffffffffffffffffffffffffff",
    via: "upgrade",
    purchased: "2026-01-02",
    issued: "2026-12-31T23:59:59Z",
  };
  const text =
    '{"issued":"2026-12-31T23:59:59Z","lid":"ffffffffffffffffffffffffffffffff","product":"rankup",' +
    '"purchased":"2026-01-02","tier":"every_device","v":1,"via":"upgrade"}';
  assert.equal(canonicalBytes(record).toString("utf8"), text);
  assert.equal(canonicalBytes(record).length, 162);
});

test("canonical bytes: the order the fields were written in does not matter", () => {
  const scrambled = {
    via: "paddle", v: 1, tier: "every_device", purchased: "2026-10-01", product: "rankup",
    lid: "0123456789abcdef0123456789abcdef", issued: "2026-10-23T09:30:00Z",
  };
  assert.equal(canonicalBytes(scrambled).toString("utf8"), FIXED_TEXT);
});

test("canonical bytes: sorted keys, no whitespace, v is an integer, no escaped slash", () => {
  const text = canonicalBytes(FIXED).toString("utf8");
  assert.equal(/\s/.test(text), false);
  assert.equal(text.includes("\\/"), false);
  assert.match(text, /"v":1,/);
  const keys = [...text.matchAll(/"([a-z]+)":/g)].map((m) => m[1]);
  assert.deepEqual(keys, ["issued", "lid", "product", "purchased", "tier", "v", "via"]);
  assert.deepEqual(keys, [...keys].sort());
});

test("canonical bytes: the record carries nothing personal", () => {
  const text = canonicalBytes(FIXED).toString("utf8");
  const keys = Object.keys(JSON.parse(text));
  for (const word of ["email", "name", "device", "user", "ip"]) {
    assert.equal(keys.some((k) => k.includes(word)), false, word);
  }
  assert.equal(text.includes("@"), false);
});

test("a record that is not exactly version 1 is refused", () => {
  const bad: Array<[string, unknown]> = [
    ["extra field", { ...FIXED, email: "a@b.co" }],
    ["missing field", { ...FIXED, via: undefined }],
    ["v is 2", { ...FIXED, v: 2 }],
    ["v is a string", { ...FIXED, v: "1" }],
    ["v is a float", { ...FIXED, v: 1.5 }],
    ["tier one_platform", { ...FIXED, tier: "one_platform" }],
    ["via other", { ...FIXED, via: "stripe" }],
    ["lid upper case", { ...FIXED, lid: "0123456789ABCDEF0123456789ABCDEF" }],
    ["lid short", { ...FIXED, lid: "0123" }],
    ["purchased not a date", { ...FIXED, purchased: "2026-02-30" }],
    ["purchased with time", { ...FIXED, purchased: "2026-10-01T00:00:00Z" }],
    ["issued with milliseconds", { ...FIXED, issued: "2026-10-23T09:30:00.000Z" }],
    ["issued without Z", { ...FIXED, issued: "2026-10-23T09:30:00" }],
    ["issued hour 24", { ...FIXED, issued: "2026-10-23T24:30:00Z" }],
    ["product empty", { ...FIXED, product: "" }],
    ["null", null],
    ["array", []],
  ];
  for (const [name, record] of bad) assert.throws(() => canonicalBytes(record), name);
  assert.doesNotThrow(() => assertValidRecord(FIXED));
});

test("issuedStamp: UTC, seconds, a trailing Z", () => {
  assert.equal(issuedStamp(new Date("2026-10-23T09:30:00.987Z")), "2026-10-23T09:30:00Z");
});

test("signature: Node's own crypto.verify accepts it, over exactly the canonical bytes", () => {
  const key = makeKey("rk-test-1");
  const signed = signRecord(FIXED, key.signer);
  assert.equal(signed.kid, "rk-test-1");
  assert.deepEqual(signed.record, FIXED);
  // base64url, no padding, 64 bytes
  assert.match(signed.sig, /^[A-Za-z0-9_-]+$/);
  assert.equal(signed.sig.length, 86);
  assert.equal(Buffer.from(signed.sig, "base64url").length, 64);
  assert.equal(
    crypto.verify(null, Buffer.from(FIXED_TEXT, "utf8"), key.publicKey, Buffer.from(signed.sig, "base64url")),
    true
  );
  assert.equal(verifySignedRecord(signed, key.publicKey), true);
});

test("signature: Ed25519 is deterministic, and the wire form has exactly record, kid and sig", () => {
  const key = makeKey();
  const a = signRecord(FIXED, key.signer);
  const b = signRecord(FIXED, key.signer);
  assert.equal(a.sig, b.sig);
  assert.deepEqual(Object.keys(a).sort(), ["kid", "record", "sig"]);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), { record: FIXED, kid: key.signer.kid, sig: a.sig });
});

test("signature: any change to the record, the signature or the key is refused", () => {
  const key = makeKey();
  const other = makeKey();
  const signed = signRecord(FIXED, key.signer);
  const bytes = canonicalBytes(FIXED);
  const sig = Buffer.from(signed.sig, "base64url");

  // a changed field
  for (const change of [
    { via: "play" }, { lid: "0123456789abcdef0123456789abcdee" }, { purchased: "2026-10-02" },
    { issued: "2026-10-23T09:30:01Z" }, { product: "rankup2" },
  ] as Array<Partial<HouseholdRecord>>) {
    const tampered = { ...FIXED, ...change } as HouseholdRecord;
    assert.equal(crypto.verify(null, canonicalBytes(tampered), key.publicKey, sig), false, JSON.stringify(change));
    assert.equal(verifySignedRecord({ ...signed, record: tampered }, key.publicKey), false);
  }
  // one flipped bit of the signature
  const flipped = Buffer.from(sig);
  flipped[10] ^= 0x01;
  assert.equal(crypto.verify(null, bytes, key.publicKey, flipped), false);
  assert.equal(verifySignedRecord({ ...signed, sig: flipped.toString("base64url") }, key.publicKey), false);
  // a truncated or padded signature
  assert.equal(verifySignedRecord({ ...signed, sig: signed.sig.slice(0, -2) }, key.publicKey), false);
  assert.equal(verifySignedRecord({ ...signed, sig: signed.sig + "==" }, key.publicKey), false);
  // another key
  assert.equal(verifySignedRecord(signed, other.publicKey), false);
  // a record with an extra field is not verifiable at all
  assert.equal(verifySignedRecord({ ...signed, record: { ...FIXED, email: "x@y.zz" } as never }, key.publicKey), false);
});

test("loadSigner: PKCS#8 base64 (as HOUSEHOLD_SIGNING_KEY holds it), PEM, and the failures", () => {
  const key = makeKey("rk-2026-1");
  const fromB64 = loadSigner(key.privateBase64, " rk-2026-1 ");
  assert.equal(fromB64.kid, "rk-2026-1");
  assert.equal(verifySignedRecord(signRecord(FIXED, fromB64), key.publicKey), true);

  const pem = key.signer.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  assert.equal(verifySignedRecord(signRecord(FIXED, loadSigner(pem, "k")), key.publicKey), true);

  assert.throws(() => loadSigner(undefined, "k"));
  assert.throws(() => loadSigner(key.privateBase64, undefined));
  assert.throws(() => loadSigner("", "k"));
  assert.throws(() => loadSigner("not a key", "k"));
  const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  assert.throws(
    () => loadSigner(rsa.export({ type: "pkcs8", format: "der" }).toString("base64"), "k"),
    /not Ed25519/
  );
});
