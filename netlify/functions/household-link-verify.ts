import type { Context } from "@netlify/functions";
import { productionHandlers } from "./lib/household-prod.js";

// POST /api/household/link/verify: the code links the address to the app user id -> {linked:true}.
// Contract: docs/household-licence.md (RankUp Chess repo) section 5. Logic: lib/household.ts.
// Answers 404 {"error":"off"} until HOUSEHOLD_ENABLED is "1". Notes: docs/household-licence-server.md.
export default function handler(req: Request, context: Context) {
  return productionHandlers().linkVerify(req, context.ip);
}
