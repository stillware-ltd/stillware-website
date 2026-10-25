import crypto from "node:crypto";
import type { Client } from "@libsql/client";
import type { Env } from "./household-config.js";
import {
  ensureHouseholdTables,
  recordPurchase,
  dropLinksOfRefunded,
  revokeByTransaction,
  transferAppUser,
  type StoreName,
} from "./household-store.js";
import { EVERY_DEVICE_STORE_PRODUCT_IDS, everyDeviceStoreProduct, type ProductSlug } from "./products.js";

// RevenueCat's webhook (KL.2): records Every device purchases by app user id, revokes on a
// refund, follows a transfer, and ignores everything else with a 200.
//
// It is not behind HOUSEHOLD_ENABLED. It is the ledger of what was bought: it only writes a
// row when a purchase is for a product in EVERY_DEVICE_STORE_PRODUCT_IDS (lib/products.ts, empty
// until KL.3), and a record is only ever signed by the five household endpoints, which are
// behind the flag. Keeping the ledger running means a purchase made before the switch is
// not lost.

export interface RevenueCatDeps {
  /** Called after the request is authorised, so a request without the secret never touches the database. */
  getDb: () => Client;
  now: () => Date;
  env: Env;
  /** RevenueCat product id -> product. The real list unless a test passes its own. */
  storeProducts?: Record<string, ProductSlug>;
}

const MAX_BODY_BYTES = 256 * 1024;

function json(status: number, body: object): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const ok = (extra: object = {}) => json(200, { ok: true, ...extra });

/** Compares two secrets without leaking where they differ or how long they are. */
export function sameSecret(given: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** The store, in the names the licence uses; null for a store this licence does not cover. */
export function storeOf(value: unknown): StoreName | null {
  if (value === "APP_STORE" || value === "MAC_APP_STORE") return "app_store";
  if (value === "PLAY_STORE") return "play";
  return null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

function utcDate(ms: unknown, fallback: Date): string {
  const d = typeof ms === "number" && Number.isFinite(ms) ? new Date(ms) : fallback;
  return Number.isNaN(d.getTime()) ? fallback.toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

/** An event is a refund when RevenueCat says so (a `CANCELLATION` for "CUSTOMER_SUPPORT", or a `REFUND`). */
function isRefund(event: Record<string, unknown>): boolean {
  return event.type === "REFUND" || (event.type === "CANCELLATION" && event.cancel_reason === "CUSTOMER_SUPPORT");
}

export async function handleRevenueCatWebhook(req: Request, deps: RevenueCatDeps): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const expected = deps.env.REVENUECAT_WEBHOOK_AUTH;
  if (!expected) {
    console.error("revenuecat-webhook: REVENUECAT_WEBHOOK_AUTH is not set");
    return json(500, { error: "server_misconfigured" });
  }
  const given = req.headers.get("authorization");
  if (given === null || !sameSecret(given, expected)) return json(401, { error: "unauthorized" });

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return json(400, { error: "bad_request" });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: "bad_request" });
  }
  const event = (body as { event?: unknown } | null)?.event;
  if (typeof event !== "object" || event === null || Array.isArray(event)) return ok({ ignored: true });
  const ev = event as Record<string, unknown>;

  try {
    const db = deps.getDb();
    await ensureHouseholdTables(db);
    const now = deps.now();

    if (ev.type === "INITIAL_PURCHASE" || ev.type === "NON_RENEWING_PURCHASE") {
      const product = everyDeviceStoreProduct(ev.product_id, deps.storeProducts ?? EVERY_DEVICE_STORE_PRODUCT_IDS);
      const store = storeOf(ev.store);
      const appUserId = str(ev.app_user_id);
      const transactionId = str(ev.transaction_id) ?? str(ev.original_transaction_id) ?? str(ev.id);
      if (!product || !store || !appUserId || !transactionId) return ok({ ignored: true });
      const result = await recordPurchase(db, {
        product,
        appUserId,
        productId: String(ev.product_id),
        store,
        via: store,
        purchased: utcDate(ev.purchased_at_ms ?? ev.event_timestamp_ms, now),
        transactionId,
        originalTransactionId: str(ev.original_transaction_id),
        environment: ev.environment === "SANDBOX" ? "SANDBOX" : "PRODUCTION",
      });
      return ok({ recorded: result === "recorded" });
    }

    if (isRefund(ev)) {
      const ids = [str(ev.transaction_id), str(ev.original_transaction_id)].filter((x): x is string => x !== null);
      const revoked = await revokeByTransaction(db, ids, now);
      // A link exists only to restore a purchase: a household left with none loses its links (KL.8).
      const unlinked = await dropLinksOfRefunded(db, ids);
      return ok({ revoked, unlinked });
    }

    if (ev.type === "TRANSFER") {
      const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => str(x) !== null) : []);
      const from = strings(ev.transferred_from);
      const to = strings(ev.transferred_to);
      // Ids RevenueCat made up for a user who had not signed in are the least specific: prefer a real one.
      const target = to.find((id) => !id.startsWith("$RCAnonymousID:")) ?? to[0];
      if (from.length === 0 || !target) return ok({ ignored: true });
      return ok({ moved: await transferAppUser(db, from, target) });
    }

    return ok({ ignored: true });
  } catch (err) {
    // Non-2xx makes RevenueCat retry later.
    console.error("revenuecat-webhook: failed:", err instanceof Error ? err.message : err);
    return json(500, { error: "server_error" });
  }
}
