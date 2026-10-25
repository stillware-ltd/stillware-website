import type { Context } from "@netlify/functions";
import { productionHandlers } from "./lib/household-prod.js";

// POST /api/household/email/remove/start: mails a 6-digit code when the address is linked; always 200 {ok:true}.
// KL.8 (a parent taking consent back). Contract: docs/household-licence.md (RankUp Chess repo) section 5.
// Logic: lib/household.ts. Answers 404 {"error":"off"} until HOUSEHOLD_ENABLED is "1". Notes: docs/household-licence-server.md.
export default function handler(req: Request, context: Context) {
  return productionHandlers().removeStart(req, context.ip);
}
