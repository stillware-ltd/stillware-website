import crypto from "node:crypto";

// The household record and its signature (contract: docs/household-licence.md §3 and §4 in the
// RankUp Chess repo). A record says one thing: this household owns the product on every device.
// It carries nothing personal: no email, no name, no device id.

export const RECORD_VERSION = 1;

export type RecordVia = "app_store" | "play" | "paddle" | "upgrade";
export const RECORD_VIAS: readonly RecordVia[] = ["app_store", "play", "paddle", "upgrade"];

/** The seven signed fields, version 1. Order here is not the wire order: see canonicalBytes. */
export interface HouseholdRecord {
  v: 1;
  product: string;
  /** The licence id: 32 lower-case hex characters, random. */
  lid: string;
  tier: "every_device";
  via: RecordVia;
  /** The original purchase's UTC date, YYYY-MM-DD. */
  purchased: string;
  /** When the server signed it, UTC, YYYY-MM-DDTHH:MM:SSZ. */
  issued: string;
}

/** What goes on the wire: {"record": {...}, "kid": "...", "sig": "<base64url, no padding>"}. */
export interface SignedRecord {
  record: HouseholdRecord;
  kid: string;
  sig: string;
}

const LID_RE = /^[0-9a-f]{32}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISSUED_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
const PRODUCT_RE = /^[a-z][a-z0-9-]{1,31}$/;
const KEYS = ["issued", "lid", "product", "purchased", "tier", "v", "via"] as const;

function isRealDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Throws when `record` is not exactly a version 1 record. Nothing else is ever signed. */
export function assertValidRecord(record: unknown): asserts record is HouseholdRecord {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    throw new Error("record: not an object");
  }
  const r = record as Record<string, unknown>;
  const keys = Object.keys(r).sort();
  if (keys.length !== KEYS.length || keys.some((k, i) => k !== KEYS[i])) {
    throw new Error(`record: fields must be exactly ${KEYS.join(", ")}`);
  }
  if (r.v !== RECORD_VERSION) throw new Error("record: v must be the integer 1");
  if (typeof r.product !== "string" || !PRODUCT_RE.test(r.product)) throw new Error("record: bad product");
  if (typeof r.lid !== "string" || !LID_RE.test(r.lid)) throw new Error("record: lid must be 32 hex characters");
  if (r.tier !== "every_device") throw new Error("record: tier must be every_device");
  if (typeof r.via !== "string" || !(RECORD_VIAS as readonly string[]).includes(r.via)) {
    throw new Error("record: bad via");
  }
  const p = typeof r.purchased === "string" ? DATE_RE.exec(r.purchased) : null;
  if (!p || !isRealDate(+p[1], +p[2], +p[3])) throw new Error("record: purchased must be YYYY-MM-DD");
  const i = typeof r.issued === "string" ? ISSUED_RE.exec(r.issued) : null;
  if (!i || !isRealDate(+i[1], +i[2], +i[3]) || +i[4] > 23 || +i[5] > 59 || +i[6] > 59) {
    throw new Error("record: issued must be YYYY-MM-DDTHH:MM:SSZ");
  }
}

/**
 * The bytes that are signed: UTF-8 JSON, keys sorted, no whitespace, integers only, strings
 * as JSON escapes them (JSON.stringify never escapes "/"). Every field of a version 1 record
 * is a plain string except `v`, an integer, so the output is built field by field.
 */
export function canonicalBytes(record: unknown): Buffer {
  assertValidRecord(record);
  const r = record as unknown as Record<string, string | number>;
  const parts = KEYS.map((k) => `${JSON.stringify(k)}:${JSON.stringify(r[k])}`);
  return Buffer.from(`{${parts.join(",")}}`, "utf8");
}

export function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** `YYYY-MM-DDTHH:MM:SSZ` for a date (no milliseconds). */
export function issuedStamp(now: Date): string {
  return now.toISOString().slice(0, 19) + "Z";
}

export interface Signer {
  kid: string;
  privateKey: crypto.KeyObject;
}

/**
 * Loads the Ed25519 private key. `keyText` is HOUSEHOLD_SIGNING_KEY: PKCS#8 DER, base64. A PEM
 * ("-----BEGIN PRIVATE KEY-----") is accepted as well, in case it was pasted that way.
 */
export function loadSigner(keyText: string | undefined, kid: string | undefined): Signer {
  if (!keyText || !kid) throw new Error("household signing key or kid is not set");
  const text = keyText.trim();
  const privateKey = text.includes("BEGIN")
    ? crypto.createPrivateKey(text)
    : crypto.createPrivateKey({ key: Buffer.from(text, "base64"), format: "der", type: "pkcs8" });
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("household signing key is not Ed25519");
  return { kid: kid.trim(), privateKey };
}

/** Signs the canonical bytes of `record` with Ed25519 and returns the wire form. */
export function signRecord(record: HouseholdRecord, signer: Signer): SignedRecord {
  const sig = crypto.sign(null, canonicalBytes(record), signer.privateKey);
  return { record, kid: signer.kid, sig: base64url(sig) };
}

/**
 * Checks a wire-form record against a public key, as the app does. Not used by the server's
 * own paths; it exists so tests (and the orchestrator's cross-check) can verify what was
 * signed with Node's own crypto.
 */
export function verifySignedRecord(signed: SignedRecord, publicKey: crypto.KeyObject): boolean {
  try {
    if (!/^[A-Za-z0-9_-]{86}$/.test(signed.sig)) return false; // 64 bytes, base64url, no padding
    return crypto.verify(null, canonicalBytes(signed.record), publicKey, Buffer.from(signed.sig, "base64url"));
  } catch {
    return false;
  }
}
