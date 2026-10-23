import type { Context } from "@netlify/functions";
import { productionHandlers } from "./lib/household-prod.js";

// POST /api/household/link/start: mails a code to confirm an address for a store buyer; always 200.
// Contract: docs/household-licence.md (RankUp Chess repo) section 5. Logic: lib/household.ts.
// Answers 404 {"error":"off"} until HOUSEHOLD_ENABLED is "1". Notes: docs/household-licence-server.md.
export default function handler(req: Request, context: Context) {
  return productionHandlers().linkStart(req, context.ip);
}
