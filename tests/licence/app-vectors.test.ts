import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import {
  assertValidRecord,
  canonicalBytes,
  loadSigner,
  signRecord,
  verifySignedRecord,
} from "../../netlify/functions/lib/household-record.js";

// The app and the server must agree to the byte (contract §3 and §4). The app's KL.1 tool
// (`tools/household_test_keys.dart` in Rank_Up_Chess) writes these vectors with a test key:
// the canonical text of each record, and its wire form signed by the app's Ed25519. Ed25519
// is deterministic, so the server, signing the same record with the same key, must produce
// the same bytes and the same signature, and must accept the app's. If the app's vectors
// change, copy the new file over this one.
// FOR TESTS ONLY: the key in the fixture unlocks nothing outside these tests.

interface Vector {
  name: string;
  canonical: string;
  canonicalHex: string;
  wire: { record: Record<string, unknown>; kid: string; sig: string };
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/app-vectors.json", import.meta.url), "utf8")
) as {
  key: { kid: string; publicKeySpkiBase64: string; privateKeyPkcs8Base64: string };
  vectors: Vector[];
};

const publicKey = crypto.createPublicKey({
  key: Buffer.from(fixture.key.publicKeySpkiBase64, "base64"),
  format: "der",
  type: "spki",
});
const signer = loadSigner(fixture.key.privateKeyPkcs8Base64, fixture.key.kid);

test("the app's vectors are there to check against", () => {
  assert.ok(fixture.vectors.length >= 3);
});

for (const v of fixture.vectors) {
  test(`app vector "${v.name}": the server reads the record the app signed`, () => {
    assertValidRecord(v.wire.record);
  });

  test(`app vector "${v.name}": the same canonical bytes`, () => {
    const bytes = canonicalBytes(v.wire.record);
    assert.equal(bytes.toString("utf8"), v.canonical);
    assert.equal(bytes.toString("hex"), v.canonicalHex);
  });

  test(`app vector "${v.name}": the server's signature is the app's, byte for byte`, () => {
    assertValidRecord(v.wire.record);
    const signed = signRecord(v.wire.record, signer);
    assert.equal(signed.kid, v.wire.kid);
    assert.equal(signed.sig, v.wire.sig);
    assert.deepEqual(signed.record, v.wire.record);
  });

  test(`app vector "${v.name}": the app's signature verifies with the server's check`, () => {
    assertValidRecord(v.wire.record);
    assert.equal(verifySignedRecord({ record: v.wire.record, kid: v.wire.kid, sig: v.wire.sig }, publicKey), true);
  });
}
