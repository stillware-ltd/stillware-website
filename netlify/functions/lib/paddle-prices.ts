import { Environment, LogLevel, Paddle } from "@paddle/paddle-node-sdk";
import type { CountryCode } from "@paddle/paddle-node-sdk";

// Paddle's pricing preview (the `prices` endpoint, KL.2 round 4): what a buyer's own country pays,
// in its own currency, formatted by Paddle. The buyer's IP address goes to Paddle so that currency
// and tax are right. It is passed on and never stored or logged here, and the SDK's own request
// log is switched off for this client (it never prints a body, but this is not left to chance).

/** One question to Paddle: these prices, for this buyer. */
export interface PriceQuery {
  priceIds: string[];
  /** The buyer's IP address, or null when the request carried none. */
  ip: string | null;
  /** The buyer's country from Netlify's geolocation, used when there is no IP address. */
  country: string;
}

/** Paddle's answer: the currency, and the formatted total for each price it knew. */
export interface PriceAnswer {
  currency: string;
  /** price id -> total as Paddle formats it for that currency, for example "£19.99". */
  totals: Record<string, string>;
}

export type PreviewFn = (query: PriceQuery) => Promise<PriceAnswer>;

/** The part of the SDK this uses, so a test can supply its own. */
export interface PricingPreviewClient {
  pricingPreview: {
    preview(body: {
      items: Array<{ priceId: string; quantity: number }>;
      customerIpAddress?: string | null;
      address?: { countryCode: CountryCode } | null;
    }): Promise<{
      currencyCode: string;
      details: { lineItems: Array<{ price: { id: string }; formattedTotals: { total: string } }> };
    }>;
  };
}

/**
 * The real preview, over the Paddle Node SDK. `environment` is for tests only (a local server's
 * URL in place of Paddle's API).
 */
export function paddlePreview(apiKey: string | undefined, environment: string = Environment.production): PreviewFn {
  return async ({ priceIds, ip, country }) => {
    if (!apiKey) throw new Error("missing PADDLE_API_KEY");
    const client = new Paddle(apiKey, { environment: environment as Environment, logLevel: LogLevel.none });
    return previewWith(client as unknown as PricingPreviewClient, { priceIds, ip, country });
  };
}

/** Asks `client` for the prices and reads the answer. Split from paddlePreview so it can be tested alone. */
export async function previewWith(client: PricingPreviewClient, { priceIds, ip, country }: PriceQuery): Promise<PriceAnswer> {
  const items = priceIds.map((priceId) => ({ priceId, quantity: 1 }));
  // The IP address localises currency and tax. Without one, the country from the request will do.
  const preview = await client.pricingPreview.preview(
    ip ? { items, customerIpAddress: ip } : { items, address: { countryCode: country as CountryCode } }
  );
  const totals: Record<string, string> = {};
  for (const line of preview.details.lineItems) {
    const total = line.formattedTotals?.total;
    if (typeof total === "string" && total !== "") totals[line.price.id] = total;
  }
  return { currency: preview.currencyCode, totals };
}
