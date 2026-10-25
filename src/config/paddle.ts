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
export type CheckoutSlug = "zeroed" | "rankup" | "rankup-mac" | "rankup-every-device" | "rankup-upgrade";

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
  /** What the licence covers, shown before checkout when it is tied to a platform.
   * RankUp Chess licences are per platform (founder, 2026-10-14); the licence
   * server enforces it (netlify/functions/lib/products.ts). */
  licenceNote?: string;
  /** Heading and text of the "not available yet" state (no price id, or `comingSoon`), in place of "Coming Soon". */
  unavailableHeading?: string;
  unavailableText?: string;
  /**
   * Only the Every device upgrade page sets this. The desktop app opens it with
   * `?licence=<64 hex>` (the SHA-256 of the buyer's key, as the licence server's hashLicenseKey
   * makes it), and the page passes a well-formed value to Paddle as `customData: { licence }`, so
   * the server upgrades that key in place. Every other page ignores the parameter.
   */
  passesLicence?: boolean;
  /** Where Paddle sends the buyer afterwards. `/buy/success` when left out. */
  successPath?: string;
}

export const PADDLE_PRODUCTS: Record<CheckoutSlug, PaddleProductConfig> = {
  zeroed: {
    slug: "zeroed",
    name: "Zeroed",
    tagline: "Software you own.",
    priceId: "pri_01knnyfj5zezrch30qqbzkc378",
    appStoreUrl: "https://apps.apple.com/app/id6804301133",
  },
  // RankUp Chess — Only on Windows (also Linux), $14.99. SWITCH DAY: the P8 tier name (docs/kl/switch-day-copy.md
  // section 2.6); the price this page opens is unchanged.
  rankup: {
    slug: "rankup",
    name: "RankUp Chess: Only on Windows",
    tagline: "Software you own.",
    priceId: "pri_01knztpnwdqxx8ecnbrjt4zkzq",
    licenceNote: "Only on Windows: this licence unlocks RankUp Chess on up to 3 Windows or Linux computers.",
  },
  // RankUp Chess — Only on Mac, $19.99 (P8 sets the Only-on price at the switch, in Paddle; this page
  // opens whichever price its id names). The macOS app links here directly; the
  // price must match `fallbackDisplayPrice` in the app's purchase_config.dart,
  // because the app never queries Paddle for a live price.
  "rankup-mac": {
    slug: "rankup",
    name: "RankUp Chess: Only on Mac",
    tagline: "Software you own.",
    priceId: "pri_01m194cc17phxmgqdqs737mw2p",
    licenceNote: "Only on Mac: this licence unlocks RankUp Chess on up to 3 Macs.",
  },

  // RankUp Chess — Every device (KL.4 opens this page). SWITCH DAY: the price id is created at KL.3.
  // Until it is filled in here AND added to EVERY_DEVICE_PADDLE_PRICE_IDS in
  // netlify/functions/lib/products.ts (and PRICE_ID_TO_PRODUCT), the page says the purchase is not
  // available yet and opens no checkout.
  "rankup-every-device": {
    slug: "rankup",
    name: "RankUp Chess: Every device",
    tagline: "Software you own.",
    priceId: "pri_01m5t1fevddc28paxqbpa4q5ks",
    unavailableHeading: "Not available yet",
    unavailableText: "Every device isn't available to buy yet. Nothing has been charged.",
    licenceNote:
      "Every device unlocks RankUp Chess on every phone, tablet and computer your family owns: Windows, Mac, Android, iPhone and iPad.",
  },
  // RankUp Chess — the Every device upgrade for a desktop key holder (KL.4 opens this page with
  // ?licence=<64 hex>). Same rules for the price id, in EVERY_DEVICE_UPGRADE_PADDLE_PRICE_IDS.
  "rankup-upgrade": {
    slug: "rankup",
    name: "RankUp Chess: add Every device",
    tagline: "Software you own.",
    priceId: "pri_01m5t1gwdqpdt1ewebtjchcpqh",
    unavailableHeading: "Not available yet",
    unavailableText: "Adding Every device isn't available yet. Nothing has been charged.",
    licenceNote:
      "Adds Every device to the RankUp Chess key you already own, and your key stays the same. If we cannot match your key, we email you a new Every device key instead, so your payment is never lost.",
    passesLicence: true,
    successPath: "/buy/success?upgrade=1",
  },
};

/** No price id yet (or a placeholder), or marked coming soon: the page opens no checkout. */
export function isComingSoon(config: PaddleProductConfig): boolean {
  return config.comingSoon === true || config.priceId.trim() === "" || config.priceId.includes("PLACEHOLDER");
}
