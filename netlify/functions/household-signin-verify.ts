import type { Context } from "@netlify/functions";
import { productionHandlers } from "./lib/household-prod.js";

// POST /api/household/signin/verify: the code -> the signed record (400 wrong_code/expired/too_many_tries, 409 device_cap).
// Contract: docs/household-licence.md (RankUp Chess repo) section 5. Logic: lib/household.ts.
// Answers 404 {"error":"off"} until HOUSEHOLD_ENABLED is "1". Notes: docs/household-licence-server.md.
export default function handler(req: Request, context: Context) {
  return productionHandlers().signinVerify(req, context.ip);
}
