import crypto from "node:crypto";
import type { StoreName } from "./household-store.js";
import { EVERY_DEVICE_STORE_PRODUCT_IDS, everyDeviceStoreProduct, type ProductSlug } from "./products.js";

// Earlier store buyers (KL.2, round 2). Their One platform purchase was made before this server
// heard of RevenueCat's webhook, so `fetch` asks RevenueCat's REST API once, when it finds no
// entitlement for an app user id: GET /v1/subscribers/{app_user_id}. If the legacy entitlement was
// first bought before HOUSEHOLD_UPGRADE_BEFORE, the purchase is stored (via "upgrade") and never
// looked up again.
//
// The response shape below is the one RevenueCat documents for the v1 subscriber endpoint:
//   subscriber.entitlements[<id>] = { product_identifier, purchase_date, expires_date (null for a lifetime unlock) }
//   subscriber.non_subscriptions[<product id>] = [{ id, store, purchase_date, original_purchase_date,
//                                                    is_sandbox, store_transaction_id }]
// A sandbox purchase at KL.3 confirms it (docs/household-licence-server.md says so too).
//
// The same answer also lists Every device purchases. When the webhook's row is missing (the
// webhook not set up yet, or a delivery that failed), an Every device purchase found there is
// "every_device", and `fetch` records it as the webhook would have (found 26 October 2026: a
// missing webhook otherwise left a buyer waiting for their licence for good).
//
// The secret API key is only ever put in the Authorization header. It is not logged, and an
// error is logged by its class name alone: a message could carry the key.

export const REVENUECAT_SUBSCRIBERS_URL = "https://api.revenuecat.com/v1/subscribers/";
export const LOOKUP_TIMEOUT_MS = 3000;
/** The entitlement of the One platform purchase (PurchaseConfig.revenueCatEntitlementId). */
export const DEFAULT_LEGACY_ENTITLEMENT = "rankupchess_premium_unlock";

export interface LegacyPurchase {
  /** The store product id the entitlement came from. */
  productId: string;
  store: StoreName;
  /** The UTC date of the first purchase, YYYY-MM-DD. */
  purchased: string;
  transactionId: string;
  sandbox: boolean;
}

export type LegacyLookupResult =
  | { status: "every_device"; purchase: LegacyPurchase }
  | { status: "purchase"; purchase: LegacyPurchase }
  | { status: "none" }
  | { status: "unavailable" };

/** Asks RevenueCat about an app user id. Built only when REVENUECAT_SECRET_API_KEY is set. */
export type LegacyLookup = (appUserId: string, entitlementId: string, platform?: string) => Promise<LegacyLookupResult>;

const STORE_BY_REVENUECAT: Record<string, StoreName> = {
  app_store: "app_store",
  mac_app_store: "app_store",
  play_store: "play",
};

const asObject = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The store a device's platform name implies, for the fallback below. */
function storeFromPlatform(platform: string | undefined): StoreName | null {
  const p = (platform ?? "").toLowerCase();
  if (p === "ios" || p === "macos") return "app_store";
  if (p === "android") return "play";
  return null;
}

/**
 * The earliest real store purchase behind a subscriber's legacy entitlement, or null when the
 * subscriber does not hold it (or only holds it by a promotion, or it has lapsed).
 *
 * The purchase comes from `non_subscriptions[product_identifier]`: the earliest entry from a
 * supported store gives the date, the store, the sandbox flag and the transaction id. If
 * RevenueCat lists no such entry at all, the entitlement's own `purchase_date` is used, with
 * the store taken from the platform the asking device reported.
 */
/** The subscriber and its active entitlement [entitlementId], or null. */
function activeEntitlement(
  body: unknown,
  entitlementId: string,
  now: Date
): { subscriber: Record<string, unknown>; entitlement: Record<string, unknown> } | null {
  const subscriber = asObject(asObject(body)?.subscriber);
  if (!subscriber) return null;
  const entitlements = asObject(subscriber.entitlements);
  const entitlement =
    entitlements && Object.hasOwn(entitlements, entitlementId) ? asObject(entitlements[entitlementId]) : null;
  if (!entitlement) return null;

  // A one-time unlock has no expiry. One that has expired is not active.
  if (entitlement.expires_date !== null && entitlement.expires_date !== undefined) {
    const expires = Date.parse(String(entitlement.expires_date));
    if (!Number.isFinite(expires) || expires <= now.getTime()) return null;
  }
  return { subscriber, entitlement };
}

/** A `non_subscriptions` entry from a supported store, with its store and time. */
interface StoreEntry {
  entry: Record<string, unknown>;
  store: StoreName;
  ms: number;
}

/** The entries of [productId] from a supported store, earliest first. */
function storeEntries(nonSubscriptions: Record<string, unknown> | null, productId: string): StoreEntry[] {
  const entries =
    nonSubscriptions && Object.hasOwn(nonSubscriptions, productId) && Array.isArray(nonSubscriptions[productId])
      ? (nonSubscriptions[productId] as unknown[])
      : [];
  return entries
    .map((raw) => {
      const entry = asObject(raw);
      if (!entry) return null;
      const store = STORE_BY_REVENUECAT[String(entry.store ?? "").toLowerCase()];
      const ms = Date.parse(String(entry.original_purchase_date ?? entry.purchase_date));
      return store && Number.isFinite(ms) ? { entry, store, ms } : null;
    })
    .filter((c): c is StoreEntry => c !== null)
    .sort((a, b) => a.ms - b.ms);
}

/**
 * The earliest real store purchase of an Every device product (Every device, or the upgrade to
 * it) by a subscriber whose entitlement [entitlementId] is active, or null. The products are
 * found by id in `non_subscriptions`, not through the entitlement's `product_identifier`: a
 * household that upgraded holds the entitlement from its first, one-device purchase.
 */
export function everyDevicePurchaseFrom(
  body: unknown,
  entitlementId: string,
  appUserId: string,
  now: Date = new Date(),
  ids: Record<string, ProductSlug> = EVERY_DEVICE_STORE_PRODUCT_IDS
): LegacyPurchase | null {
  const active = activeEntitlement(body, entitlementId, now);
  if (!active) return null;
  const nonSubscriptions = asObject(active.subscriber.non_subscriptions);
  if (!nonSubscriptions) return null;
  const found = Object.keys(nonSubscriptions)
    .filter((productId) => everyDeviceStoreProduct(productId, ids) !== null)
    .flatMap((productId) => storeEntries(nonSubscriptions, productId).map((c) => ({ ...c, productId })))
    .sort((a, b) => a.ms - b.ms);
  const first = found[0];
  if (!first) return null;
  const stamp = utcDate(first.ms);
  return {
    productId: first.productId,
    store: first.store,
    purchased: stamp,
    transactionId:
      text(first.entry.store_transaction_id) ??
      text(first.entry.id) ??
      `rc-lookup:${crypto.createHash("sha256").update(appUserId).digest("hex").slice(0, 16)}:${first.productId}:${stamp}`,
    sandbox: first.entry.is_sandbox === true,
  };
}

export function legacyPurchaseFrom(
  body: unknown,
  entitlementId: string,
  appUserId: string,
  platform?: string,
  now: Date = new Date()
): LegacyPurchase | null {
  const active = activeEntitlement(body, entitlementId, now);
  if (!active) return null;
  const { subscriber, entitlement } = active;
  const productId = text(entitlement.product_identifier);
  if (!productId) return null;

  const nonSubscriptions = asObject(subscriber.non_subscriptions);
  const entries =
    nonSubscriptions && Object.hasOwn(nonSubscriptions, productId) && Array.isArray(nonSubscriptions[productId])
      ? (nonSubscriptions[productId] as unknown[])
      : [];

  const firstSeen = (appUserId: string, stamp: string) =>
    `rc-lookup:${crypto.createHash("sha256").update(appUserId).digest("hex").slice(0, 16)}:${productId}:${stamp}`;

  if (entries.length > 0) {
    const candidates = entries
      .map((raw) => {
        const entry = asObject(raw);
        if (!entry) return null;
        const store = STORE_BY_REVENUECAT[String(entry.store ?? "").toLowerCase()];
        const ms = Date.parse(String(entry.original_purchase_date ?? entry.purchase_date));
        return store && Number.isFinite(ms) ? { entry, store, ms } : null;
      })
      .filter((c): c is { entry: Record<string, unknown>; store: StoreName; ms: number } => c !== null)
      .sort((a, b) => a.ms - b.ms);
    const first = candidates[0];
    // Entries exist but none is a real store purchase (a promotional grant, say): not a buyer.
    if (!first) return null;
    return {
      productId,
      store: first.store,
      purchased: utcDate(first.ms),
      transactionId: text(first.entry.store_transaction_id) ?? text(first.entry.id) ?? firstSeen(appUserId, utcDate(first.ms)),
      sandbox: first.entry.is_sandbox === true,
    };
  }

  const ms = Date.parse(String(entitlement.purchase_date));
  const store = storeFromPlatform(platform);
  if (!Number.isFinite(ms) || !store) return null;
  return { productId, store, purchased: utcDate(ms), transactionId: firstSeen(appUserId, utcDate(ms)), sandbox: false };
}

export interface LookupOptions {
  /** REVENUECAT_SECRET_API_KEY. */
  key: string;
  appUserId: string;
  entitlementId: string;
  platform?: string;
  /** For tests: a fake in place of the global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: Date;
}

/**
 * One call to RevenueCat's subscriber endpoint. A timeout, a network failure, a 5xx or any
 * answer but 200 and 404 is "unavailable" (store nothing, tell the app to try later); a 404 is
 * "none".
 */
export async function lookupLegacyPurchase(o: LookupOptions): Promise<LegacyLookupResult> {
  let body: unknown;
  try {
    const res = await (o.fetchImpl ?? fetch)(REVENUECAT_SUBSCRIBERS_URL + encodeURIComponent(o.appUserId), {
      method: "GET",
      headers: { Authorization: `Bearer ${o.key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(o.timeoutMs ?? LOOKUP_TIMEOUT_MS),
    });
    if (res.status === 404) return { status: "none" };
    if (!res.ok) {
      console.error("household: RevenueCat lookup answered", res.status);
      return { status: "unavailable" };
    }
    body = await res.json();
  } catch (err) {
    console.error("household: RevenueCat lookup failed:", err instanceof Error ? err.name : "error");
    return { status: "unavailable" };
  }
  const everyDevice = everyDevicePurchaseFrom(body, o.entitlementId, o.appUserId, o.now);
  if (everyDevice) return { status: "every_device", purchase: everyDevice };
  const purchase = legacyPurchaseFrom(body, o.entitlementId, o.appUserId, o.platform, o.now);
  return purchase ? { status: "purchase", purchase } : { status: "none" };
}
