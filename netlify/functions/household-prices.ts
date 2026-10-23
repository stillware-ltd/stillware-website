import type { Context } from "@netlify/functions";
import { getDb } from "./lib/db.js";
import { handlePrices } from "./lib/household-prices.js";
import { paddlePreview } from "./lib/paddle-prices.js";

// POST /api/household/prices {product, platform} -> the buyer's own country price for each tier,
// formatted by Paddle (contract section 5, "Local prices"). Public prices only, so it is not behind
// HOUSEHOLD_ENABLED. The country comes from Netlify's geolocation; the buyer's IP address goes to
// Paddle's pricing preview and is neither stored nor logged. Logic and cache: lib/household-prices.ts.
export default function handler(req: Request, context: Context) {
  return handlePrices(
    req,
    {
      getDb,
      now: () => new Date(),
      preview: paddlePreview(process.env.PADDLE_API_KEY),
    },
    {
      country: context.geo?.country?.code,
      ip: req.headers.get("x-nf-client-connection-ip") || context.ip,
    }
  );
}
