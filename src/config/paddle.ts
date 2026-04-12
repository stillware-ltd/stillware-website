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

export type ProductSlug = "zeroed" | "rankup";

export interface PaddleProductConfig {
  slug: ProductSlug;
  name: string;
  tagline: string;
  priceId: string;
  /** When `true`, the buy page shows a "coming soon" message instead of
   * opening the Paddle overlay. Use this for products whose Paddle price
   * hasn't been created yet, so the deploy can go out before the price ID
   * is known. */
  comingSoon?: boolean;
}

export const PADDLE_PRODUCTS: Record<ProductSlug, PaddleProductConfig> = {
  zeroed: {
    slug: "zeroed",
    name: "Zeroed",
    tagline: "Software you own.",
    priceId: "pri_01knnyfj5zezrch30qqbzkc378",
  },
  rankup: {
    slug: "rankup",
    name: "RankUp Chess",
    tagline: "Software you own.",
    priceId: "pri_01knztpnwdqxx8ecnbrjt4zkzq",
  },
};

export function isComingSoon(config: PaddleProductConfig): boolean {
  return config.comingSoon === true || config.priceId.includes("PLACEHOLDER");
}
