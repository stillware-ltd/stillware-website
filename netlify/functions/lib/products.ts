// Multi-product config for the shared license backend.
//
// To onboard a new Stillware product:
//  1. Add its Paddle price ID(s) to PRICE_ID_TO_PRODUCT below.
//  2. Add its display config to PRODUCTS below.
//  3. Tell the new app's client to send `product: '<slug>'` on every
//     activate/validate/deactivate request.

export type ProductSlug = "zeroed" | "rankup";

export interface ProductConfig {
  /** Slug stored in the `licenses.product` column. */
  slug: ProductSlug;
  /** Human-readable name used in license emails. */
  name: string;
  /** Marketing tagline used in the email footer. */
  tagline: string;
  /** Default activation device limit for new licenses. */
  maxActivations: number;
  /** Product page, linked when a key is refused for being for another platform. */
  pageUrl: string;
}

export const PRODUCTS: Record<ProductSlug, ProductConfig> = {
  zeroed: {
    slug: "zeroed",
    name: "Zeroed",
    tagline: "Zero stress. Total control.",
    maxActivations: 5,
    pageUrl: "https://www.stillwareltd.com/zeroed/",
  },
  rankup: {
    slug: "rankup",
    name: "RankUp Chess",
    tagline: "Software you own.",
    maxActivations: 3,
    pageUrl: "https://www.stillwareltd.com/rankupchess/",
  },
};

/**
 * Maps Paddle price IDs to product slugs. The webhook handler uses this to
 * decide which product a transaction belongs to, since one Paddle account
 * sells multiple Stillware products.
 *
 * Update this when you add a new price in the Paddle dashboard.
 */
export const PRICE_ID_TO_PRODUCT: Record<string, ProductSlug> = {
  // Zeroed — Standard lifetime
  pri_01knnyfj5zezrch30qqbzkc378: "zeroed",
  // RankUp Chess — Lifetime, Windows/Linux ($14.99)
  pri_01knztpnwdqxx8ecnbrjt4zkzq: "rankup",
  // RankUp Chess — Lifetime, macOS ($19.99). A separate price, but the same
  // licence product: keys are scoped to `rankup`, not to a platform.
  pri_01m194cc17phxmgqdqs737mw2p: "rankup",
};

/**
 * Returns the product slug for the given Paddle price ID, or `null` if
 * unknown. Webhook callers should treat `null` as a hard error and let
 * Paddle retry — silent fall-through to a default product would mis-attribute
 * revenue and let one product's keys unlock another product.
 */
export function productForPriceId(priceId: string): ProductSlug | null {
  return PRICE_ID_TO_PRODUCT[priceId] ?? null;
}

/**
 * Picks the product slug from the first matching line item of a Paddle
 * transaction. Returns `null` if none of the line items map to a known
 * product.
 */
export function productFromTransactionItems(
  items: Array<{ price?: { id?: string } | null } | undefined> | undefined
): ProductSlug | null {
  if (!items) return null;
  for (const item of items) {
    const id = item?.price?.id;
    if (id) {
      const slug = productForPriceId(id);
      if (slug) return slug;
    }
  }
  return null;
}

/**
 * The platform a licence is for. RankUp Chess is sold per platform (founder, 2026-10-14):
 * its Mac price unlocks only the Mac app and its Windows/Linux price only Windows and
 * Linux. Zeroed is not: its price is in no list here, so its licences, and every licence
 * minted before this rule, have no platform and activate on any OS.
 */
export type LicensePlatform = "macos" | "windows";

/** Prices that tie a licence to a platform. Linux shares the Windows price. */
export const PRICE_ID_TO_PLATFORM: Record<string, LicensePlatform> = {
  // RankUp Chess — Lifetime, Windows/Linux ($14.99)
  pri_01knztpnwdqxx8ecnbrjt4zkzq: "windows",
  // RankUp Chess — Lifetime, macOS ($19.99)
  pri_01m194cc17phxmgqdqs737mw2p: "macos",
};

/**
 * The platform of the line item that decides the product (the one
 * productFromTransactionItems picks), or null for a licence that works anywhere.
 */
export function platformFromTransactionItems(
  items: Array<{ price?: { id?: string } | null } | undefined> | undefined
): LicensePlatform | null {
  for (const item of items ?? []) {
    const id = item?.price?.id;
    if (id && productForPriceId(id)) return PRICE_ID_TO_PLATFORM[id] ?? null;
  }
  return null;
}

/**
 * The licence platform an app's OS falls under, from the `platform` it sends on activate
 * ("macos" | "windows" | "linux"). Null when the app did not say: RankUp Chess 0.10.1 and
 * earlier, and every Zeroed build.
 */
export function platformOfClient(os: unknown): LicensePlatform | null {
  if (os === "macos") return "macos";
  if (os === "windows" || os === "linux") return "windows";
  return null;
}

/** How a platform reads in emails and messages. */
export const PLATFORM_LABEL: Record<LicensePlatform, { on: string; devices: string }> = {
  macos: { on: "the Mac", devices: "Macs" },
  windows: { on: "Windows and Linux", devices: "Windows or Linux computers" },
};

/** Why activation refused a key bought for the other platform. */
export function wrongPlatformMessage(product: ProductConfig, licence: LicensePlatform): string {
  const other = licence === "macos" ? "Windows and Linux version" : "Mac version";
  return (
    `This key is for ${product.name} on ${PLATFORM_LABEL[licence].on}. ` +
    `The ${other} is a separate purchase: ${product.pageUrl}`
  );
}

/**
 * Backward-compat default. Used by activate/validate when the client did
 * NOT send a `product` field. The live Zeroed app pre-dates this multi-
 * product change, so it doesn't send `product` — defaulting to 'zeroed'
 * keeps it working until it ships an updated build.
 *
 * New apps (RankUp Chess and beyond) MUST always send `product` explicitly.
 */
export const DEFAULT_PRODUCT_FOR_LEGACY_CLIENTS: ProductSlug = "zeroed";

/**
 * Validates a slug from a client request. Returns the slug if known,
 * otherwise `null`.
 */
export function isValidProduct(slug: string | undefined): slug is ProductSlug {
  return slug === "zeroed" || slug === "rankup";
}
