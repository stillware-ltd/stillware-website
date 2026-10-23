import crypto from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { householdSettings, type Env, type HouseholdSettings } from "../../netlify/functions/lib/household-config.js";
import { householdHandlers, type HouseholdHandlers } from "../../netlify/functions/lib/household-http.js";
import type { HouseholdDeps, SendCode } from "../../netlify/functions/lib/household.js";
import { type Signer } from "../../netlify/functions/lib/household-record.js";
import { recordPurchase, type CodePurpose } from "../../netlify/functions/lib/household-store.js";

// Shared test scaffolding: a local libsql database file in a temp folder, a signing key made
// for the test, a clock the test moves, and fakes for the mail and for Paddle. No real secret
// and no network call is involved anywhere.

export const SCHEMA_PATH = new URL("../../netlify/functions/lib/schema.sql", import.meta.url);

let latestUrl = "";

/** The `file:` URL of the database freshDb opened last (for code that opens its own client). */
export const lastDbUrl = () => latestUrl;

/** A fresh database file with the repo's schema.sql applied (the licenses table and the rest). */
export async function freshDb(withSchema = true): Promise<Client> {
  const dir = mkdtempSync(join(tmpdir(), "household-test-"));
  latestUrl = "file:" + join(dir, "licences.db").split(sep).join("/");
  const db = createClient({ url: latestUrl });
  if (withSchema) await db.executeMultiple(readFileSync(SCHEMA_PATH, "utf8"));
  return db;
}

export interface TestKey {
  signer: Signer;
  publicKey: crypto.KeyObject;
  /** The private key as HOUSEHOLD_SIGNING_KEY holds it: PKCS#8 DER, base64. */
  privateBase64: string;
}

export function makeKey(kid = "rk-test-1"): TestKey {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    signer: { kid, privateKey },
    publicKey,
    privateBase64: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
  };
}

export class Clock {
  t: number;
  constructor(start = "2026-10-23T09:30:00Z") {
    this.t = Date.parse(start);
  }
  now = () => new Date(this.t);
  advance(ms: number) {
    this.t += ms;
  }
  minutes(n: number) {
    this.advance(n * 60_000);
  }
}

export interface SentMail {
  to: string;
  code: string;
  purpose: CodePurpose;
}

export interface WorldOptions {
  env?: Env;
  startMinMs?: number;
  perIpLimit?: number;
  /** When true the mail fake throws, as a Resend outage would. */
  failSend?: boolean;
  /** When true the /start padding really sleeps (for the timing test); otherwise it is only noted. */
  realSleep?: boolean;
}

/** Everything one test needs: a database, the handlers over fakes, and the knobs. */
export interface World {
  db: Client;
  clock: Clock;
  key: TestKey;
  env: Env;
  sent: SentMail[];
  /** Paddle's side: a lower-cased address -> its completed transaction ids. */
  paddle: Map<string, string[]>;
  paddleCalls: string[];
  paddleFails: { value: boolean };
  sleeps: number[];
  mail: { fail: boolean };
  /** While true the signing key is "not configured": the signer throws. */
  signerFails: { value: boolean };
  handlers: HouseholdHandlers;
  /** The logic's dependencies as the environment is right now (for calling lib/household.ts directly). */
  depsNow: () => HouseholdDeps;
  call: (
    name: keyof HouseholdHandlers,
    body: unknown,
    opts?: { ip?: string; method?: string; raw?: string }
  ) => Promise<{ status: number; body: any; text: string }>;
  lastCode: (to: string) => string;
}

export async function makeWorld(opts: WorldOptions = {}): Promise<World> {
  const db = await freshDb();
  const clock = new Clock();
  const key = makeKey();
  const env: Env = { HOUSEHOLD_ENABLED: "1", ...opts.env };
  const sent: SentMail[] = [];
  const paddle = new Map<string, string[]>();
  const paddleCalls: string[] = [];
  const paddleFails = { value: false };
  const sleeps: number[] = [];
  const mail = { fail: opts.failSend ?? false };
  const signerFails = { value: false };

  const sendCode: SendCode = async (to, code, _product, purpose) => {
    if (mail.fail) throw new Error("fake outage");
    sent.push({ to, code, purpose });
  };

  const buildDeps = (settings: HouseholdSettings): HouseholdDeps => ({
    db,
    now: clock.now,
    settings,
    signer: () => {
      if (signerFails.value) throw new Error("household signing key or kid is not set");
      return key.signer;
    },
    sendCode,
    paddleTransactionIds: async (email) => {
      paddleCalls.push(email);
      if (paddleFails.value) throw new Error("fake Paddle outage");
      return paddle.get(email.trim().toLowerCase()) ?? [];
    },
  });
  const handlers = householdHandlers({
    env: () => env,
    build: (settings) => ({
      household: buildDeps(settings),
      sleep: async (ms) => {
        sleeps.push(ms);
        if (opts.realSleep) await new Promise((resolve) => setTimeout(resolve, ms));
      },
      startMinMs: opts.startMinMs ?? 1500,
      perIpLimit: opts.perIpLimit ?? 20,
    }),
  });
  const depsNow = () => buildDeps(householdSettings(env));

  let ipCounter = 0;
  const call: World["call"] = async (name, body, o = {}) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    // A new address for every call unless the test names one, so the IP limit never gets in the way.
    headers["x-nf-client-connection-ip"] = o.ip ?? `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;
    const req = new Request("https://www.stillwareltd.com/api/household/x", {
      method: o.method ?? "POST",
      headers,
      body: (o.method ?? "POST") === "GET" ? undefined : (o.raw ?? JSON.stringify(body)),
    });
    const res = await handlers[name](req);
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: parsed, text };
  };

  const lastCode = (to: string) => {
    const mails = sent.filter((m) => m.to.toLowerCase() === to.trim().toLowerCase());
    if (mails.length === 0) throw new Error(`no mail was sent to ${to}`);
    return mails[mails.length - 1].code;
  };

  return { db, clock, key, env, sent, paddle, paddleCalls, paddleFails, sleeps, mail, signerFails, handlers, depsNow, call, lastCode };
}

let txnCounter = 0;

/** A store purchase as the RevenueCat webhook would have recorded it. Returns its licence id. */
export async function addStorePurchase(
  w: World,
  o: { appUserId: string; purchased?: string; via?: "app_store" | "play" | "upgrade"; transactionId?: string } = {
    appUserId: "$RCAnonymousID:test",
  }
): Promise<string> {
  const transactionId = o.transactionId ?? `txn-${++txnCounter}`;
  await recordPurchase(w.db, {
    product: "rankup",
    appUserId: o.appUserId,
    productId: "test_every_device",
    store: o.via === "play" ? "play" : "app_store",
    via: o.via ?? "app_store",
    purchased: o.purchased ?? "2026-10-01",
    transactionId,
    originalTransactionId: null,
    environment: "PRODUCTION",
  });
  const row = await w.db.execute({
    sql: "SELECT lid FROM household_store_entitlements WHERE transaction_id = ?",
    args: [transactionId],
  });
  return String(row.rows[0].lid);
}

/** A row of the existing `licenses` table, and (when `email` is given) Paddle's record of the buyer. */
export async function addPaddleLicence(
  w: World,
  o: { txn?: string; email?: string; tier?: "every_device" | null; createdAt?: string; revoked?: number; platform?: string | null }
): Promise<string> {
  const txn = o.txn ?? `txn_paddle_${++txnCounter}`;
  const id = crypto.randomBytes(16).toString("hex");
  await w.db.execute({
    sql: `INSERT INTO licenses (id, key_hash, email, paddle_txn_id, product, max_activations, created_at, revoked, platform, tier)
          VALUES (?, ?, 'not-stored', ?, 'rankup', 3, ?, ?, ?, ?)`,
    args: [
      id, crypto.randomBytes(16).toString("hex"), txn, o.createdAt ?? "2026-10-10 12:00:00", o.revoked ?? 0,
      o.platform ?? null, o.tier ?? null,
    ],
  });
  if (o.email) {
    const key = o.email.trim().toLowerCase();
    w.paddle.set(key, [...(w.paddle.get(key) ?? []), txn]);
  }
  return id;
}

/** Every value of every household table, as one string, for "nothing readable is stored" checks. */
export async function dumpHouseholdTables(db: Client): Promise<{ text: string; rows: Record<string, unknown>[] }> {
  const tables = [
    "household_store_entitlements", "household_email_links", "household_codes", "household_issued",
    "household_devices", "household_hits",
  ];
  const rows: Record<string, unknown>[] = [];
  for (const t of tables) {
    const res = await db.execute(`SELECT * FROM ${t}`);
    for (const r of res.rows) rows.push({ ...r });
  }
  return { text: JSON.stringify(rows), rows };
}
