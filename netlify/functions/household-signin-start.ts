import type { Context } from "@netlify/functions";
import { productionHandlers } from "./lib/household-prod.js";

// POST /api/household/signin/start: mails a 6-digit code when a purchase matches; always 200 {ok:true}.
// Contract: docs/household-licence.md (RankUp Chess repo) section 5. Logic: lib/household.ts.
// Answers 404 {"error":"off"} until HOUSEHOLD_ENABLED is "1". Notes: docs/household-licence-server.md.
export default function handler(req: Request, context: Context) {
  return productionHandlers().signinStart(req, context.ip);
}
