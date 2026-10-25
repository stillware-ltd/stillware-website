import type { Context } from "@netlify/functions";
import { productionHandlers } from "./lib/household-prod.js";

// POST /api/household/email/remove/verify: the code -> the address's links, codes and limits deleted, 200 {removed:true}
// (400 wrong_code/expired/too_many_tries). KL.8. Contract: docs/household-licence.md (RankUp Chess repo) section 5.
// Logic: lib/household.ts. Answers 404 {"error":"off"} until HOUSEHOLD_ENABLED is "1". Notes: docs/household-licence-server.md.
export default function handler(req: Request, context: Context) {
  return productionHandlers().removeVerify(req, context.ip);
}
