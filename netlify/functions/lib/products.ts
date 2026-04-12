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
}

export const PRODUCTS: Record<ProductSlug, ProductConfig> = {
  zeroed: {
    slug: "zeroed",
    name: "Zeroed",
    tagline: "Zero stress. Total control.",
    maxActivations: 3,
  },
  rankup: {
    slug: "rankup",
    name: "RankUp Chess",
    tagline: "Software you own.",
    maxActivations: 3,
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
  // RankUp Chess — Lifetime ($14.99)
  // TODO: replace with the real price ID once the Paddle product is created.
  pri_RANKUP_LIFETIME_PLACEHOLDER: "rankup",
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
