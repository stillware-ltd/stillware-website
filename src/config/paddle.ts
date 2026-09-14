// Paddle Billing client-side configuration.
//
// The token is a "client-side token" from Paddle Dashboard → Developer Tools
// → Authentication. It is designed to be exposed publicly — it can only
// initiate checkouts, not modify, refund, or read sensitive data.
//
// Price IDs MUST also be present in the server-side
// `netlify/functions/lib/products.ts` PRICE_ID_TO_PRODUCT map so the webhook
// can attribute purchases to the correct product.

export const PADDLE_CLIENT_TOKEN = "live_856dd9f9d28761a6baa63024711";

/**
 * Licence product a checkout grants. Must stay in sync with `ProductSlug` in
 * `netlify/functions/lib/products.ts`, since that is what ends up in the
 * `licenses.product` column.
 */
export type ProductSlug = "zeroed" | "rankup";

/**
 * URL segment under `/buy/`. There is one checkout page per Paddle *price*,
 * not per product: RankUp Chess is priced differently on macOS than on
 * Windows/Linux, so it has two pages that both grant a `rankup` licence.
 *
 * A dedicated page per price is deliberate — a missing page 404s visibly,
 * whereas a `?price=` parameter an existing page ignored would quietly charge
 * the wrong amount.
 */
export type CheckoutSlug = "zeroed" | "rankup" | "rankup-mac";

export interface PaddleProductConfig {
  /** Licence product this checkout grants. Not necessarily the URL slug. */
  slug: ProductSlug;
  name: string;
  tagline: string;
  priceId: string;
  /** When `true`, the buy page shows a "coming soon" message instead of
   * opening the Paddle overlay. Use this for products whose Paddle price
   * hasn't been created yet, so the deploy can go out before the price ID
   * is known. */
  comingSoon?: boolean;
  /** App Store listing, shown on the buy page so iPhone/iPad users buy
   * inside the app (Apple requires in-app purchase there; a Paddle licence
   * does not unlock the iOS build). */
  appStoreUrl?: string;
}

export const PADDLE_PRODUCTS: Record<CheckoutSlug, PaddleProductConfig> = {
  zeroed: {
    slug: "zeroed",
    name: "Zeroed",
    tagline: "Software you own.",
    priceId: "pri_01knnyfj5zezrch30qqbzkc378",
    appStoreUrl: "https://apps.apple.com/app/id6804301133",
  },
  // RankUp Chess — Windows/Linux, $14.99.
  rankup: {
    slug: "rankup",
    name: "RankUp Chess",
    tagline: "Software you own.",
    priceId: "pri_01knztpnwdqxx8ecnbrjt4zkzq",
  },
  // RankUp Chess — macOS, $19.99. The macOS app links here directly; the
  // price must match `fallbackDisplayPrice` in the app's purchase_config.dart,
  // because the app never queries Paddle for a live price.
  "rankup-mac": {
    slug: "rankup",
    name: "RankUp Chess for macOS",
    tagline: "Software you own.",
    priceId: "pri_01m194cc17phxmgqdqs737mw2p",
  },
};

export function isComingSoon(config: PaddleProductConfig): boolean {
  return config.comingSoon === true || config.priceId.includes("PLACEHOLDER");
}
