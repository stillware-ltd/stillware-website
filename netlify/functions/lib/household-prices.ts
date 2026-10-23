import type { Client } from "@libsql/client";
import { ensureHouseholdTables, getCachedPrices, putCachedPrices } from "./household-store.js";
import type { PreviewFn } from "./paddle-prices.js";
import {
  EVERY_DEVICE_PADDLE_PRICE_IDS,
  EVERY_DEVICE_UPGRADE_PADDLE_PRICE_IDS,
  PRICE_ID_TO_PLATFORM,
  PRICE_ID_TO_PRODUCT,
  isHouseholdProduct,
  platformOfClient,
  type LicensePlatform,
  type ProductSlug,
} from "./products.js";

// The `prices` endpoint (contract section 5, "Local prices"): the buyer's own country price for
// each tier, as Paddle formats it. POST /api/household/prices {product, platform}.
//
// It reads public prices only, so it is NOT behind HOUSEHOLD_ENABLED. The country is the one
// Netlify's geolocation gives; the buyer's IP address goes to Paddle's pricing preview (so tax and
// currency are right) and is never stored or logged. Answers are cached per product, country and
// platform for an hour. A price that does not exist yet is left out, never invented.

export const PRICE_PLATFORMS = ["windows", "macos", "linux", "web"] as const;
export type PricePlatform = (typeof PRICE_PLATFORMS)[number];

/** How long a cached answer is used. */
export const PRICE_CACHE_MINUTES = 60;
/** How long Paddle gets to answer before the buyer is told to try later. */
export const PREVIEW_TIMEOUT_MS = 3000;

export interface PriceTables {
  /** Paddle price id -> the platform it unlocks (Windows and Linux share one). */
  perPlatform: Record<string, LicensePlatform>;
  priceToProduct: Record<string, ProductSlug>;
  /** Every device price ids, and the upgrade price ids. */
  everyDevice: readonly string[];
  upgrade: readonly string[];
}

/** What products.ts names today. */
export const productTables = (): PriceTables => ({
  perPlatform: PRICE_ID_TO_PLATFORM,
  priceToProduct: PRICE_ID_TO_PRODUCT,
  everyDevice: EVERY_DEVICE_PADDLE_PRICE_IDS,
  upgrade: EVERY_DEVICE_UPGRADE_PADDLE_PRICE_IDS,
});

export interface PriceIds {
  every_device?: string;
  this_device?: string;
  upgrade?: string;
}

/**
 * The Paddle price ids the answer may ask for, from the tables products.ts holds:
 *  - `this_device`: the per-platform price that platform buys today (Windows and Linux share one,
 *    the Mac has its own). For `web` it is the Windows and Linux price: P8 gives "Only on one kind
 *    of device" one price on every platform, so after KL.3 that is the price the page's second card shows.
 *  - `every_device` and `upgrade`: the first id on the Every device lists, for this product.
 * A kind with no id is left out.
 */
export function priceIdsFor(product: ProductSlug, platform: PricePlatform, tables: PriceTables = productTables()): PriceIds {
  const forProduct = (ids: readonly string[]) => ids.find((id) => tables.priceToProduct[id] === product);
  const ids: PriceIds = {};
  const every = forProduct(tables.everyDevice);
  if (every) ids.every_device = every;
  const licencePlatform = platform === "web" ? "windows" : platformOfClient(platform);
  if (licencePlatform) {
    const own = Object.entries(tables.perPlatform).find(
      ([id, p]) => p === licencePlatform && tables.priceToProduct[id] === product
    );
    if (own) ids.this_device = own[0];
  }
  const upgrade = forProduct(tables.upgrade);
  if (upgrade) ids.upgrade = upgrade;
  return ids;
}

export interface PricesDeps {
  /** The database, asked for lazily: a failure here only costs the cache. */
  getDb: () => Client;
  now: () => Date;
  preview: PreviewFn;
  tables?: PriceTables;
  /** For tests; PREVIEW_TIMEOUT_MS otherwise. */
  timeoutMs?: number;
}

/** What the request itself says about the buyer. Neither is stored or logged. */
export interface Caller {
  /** Netlify's geolocation: `context.geo?.country?.code`. */
  country?: string | null;
  ip?: string | null;
}

function json(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** A failure named for the log: the error class, and Paddle's short error code when it has one. Never the message. */
function describe(err: unknown): string {
  const name = err instanceof Error ? err.name : "error";
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[a-z_]{1,40}$/.test(code) ? `${name} ${code}` : name;
}

export async function handlePrices(req: Request, deps: PricesDeps, caller: Caller): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 4096) return json(400, { error: "bad_request" });
    body = JSON.parse(text);
  } catch {
    return json(400, { error: "bad_request" });
  }
  const fields = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const platform = fields?.platform;
  if (!fields || !isHouseholdProduct(fields.product) || !(PRICE_PLATFORMS as readonly unknown[]).includes(platform)) {
    return json(400, { error: "bad_request" });
  }
  const product: ProductSlug = fields.product;
  const kind = platform as PricePlatform;

  // Without a country there is nothing to localise to (and nothing to key the cache on).
  const country = (caller.country ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return json(503, { error: "try_later" });

  const ids = priceIdsFor(product, kind, deps.tables);
  const wanted = Object.values(ids);
  // Nothing to ask for (no price id is named for this product and platform): no price, no
  // currency. Nothing is invented.
  if (wanted.length === 0) return json(200, { country, currency: null, prices: {} });

  const now = deps.now();
  let db: Client | null = null;
  try {
    db = deps.getDb();
    await ensureHouseholdTables(db);
    const cached = await getCachedPrices(db, product, country, kind, new Date(now.getTime() - PRICE_CACHE_MINUTES * 60_000));
    if (cached !== null) return new Response(cached, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (err) {
    // The cache is a convenience. Without it every request asks Paddle.
    console.error("household prices: cache unavailable:", describe(err));
    db = null;
  }

  let answer;
  try {
    answer = await withTimeout(deps.preview({ priceIds: wanted, ip: caller.ip?.trim() || null, country }), deps.timeoutMs ?? PREVIEW_TIMEOUT_MS);
  } catch (err) {
    console.error("household prices: Paddle preview failed:", describe(err));
    return json(503, { error: "try_later" });
  }

  // In the contract's order; a price Paddle did not return is left out.
  const prices: Record<string, string> = {};
  for (const name of ["every_device", "this_device", "upgrade"] as const) {
    const id = ids[name];
    const total = id ? answer.totals[id] : undefined;
    if (total) prices[name] = total;
  }
  const out = JSON.stringify({ country, currency: answer.currency, prices });

  if (db) {
    try {
      await putCachedPrices(db, product, country, kind, out, now);
    } catch (err) {
      console.error("household prices: could not cache:", describe(err));
    }
  }
  return new Response(out, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
