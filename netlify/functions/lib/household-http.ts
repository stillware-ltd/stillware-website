import { householdSettings, type Env, type HouseholdSettings } from "./household-config.js";
import { fetchRecord, isEmail, startLink, startSignin, verifyLink, verifySignin } from "./household.js";
import type { Answer, HouseholdDeps } from "./household.js";
import { ensureHouseholdTables, ipBucket, takeHit } from "./household-store.js";
import { isHouseholdProduct, type ProductSlug } from "./products.js";

// The HTTP side of the five household endpoints (contract §5): the flag, the method, the
// IP limit, the JSON, the product and the fields, then the logic in lib/household.ts. The
// Netlify function files are one-liners over these, and tests drive them with fake deps.

export interface HttpDeps {
  household: HouseholdDeps;
  sleep: (ms: number) => Promise<void>;
  /** The /start endpoints take at least this long (see START_MIN_MS). */
  startMinMs: number;
  /** Requests per IP per hour to the four email-code endpoints. */
  perIpLimit: number;
}

export interface HandlerSource {
  /** The environment, read for every request. */
  env: () => Env;
  /** Builds the dependencies. Called only when the flag is on, so a flag that is off touches nothing. */
  build: (settings: HouseholdSettings) => HttpDeps;
}

export type HouseholdHandler = (req: Request, contextIp?: string) => Promise<Response>;

export interface HouseholdHandlers {
  fetch: HouseholdHandler;
  signinStart: HouseholdHandler;
  signinVerify: HouseholdHandler;
  linkStart: HouseholdHandler;
  linkVerify: HouseholdHandler;
}

const MAX_BODY_BYTES = 8192;
const PLATFORM_RE = /^[a-z0-9_.-]{1,24}$/;

export function json(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const reply = (a: Answer) => json(a.status, a.body);
const bad = (error = "bad_request") => json(400, { error });

const isAppUserId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 200 && !/[\u0000-\u001f]/.test(v);
const isCode = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 16;
const isPlatform = (v: unknown): v is string => typeof v === "string" && PLATFORM_RE.test(v.toLowerCase());

/** The caller's address: Netlify's header first, then the function context's. Null when neither. */
function clientIp(req: Request, contextIp?: string): string | null {
  const h = req.headers.get("x-nf-client-connection-ip")?.trim();
  return h || contextIp?.trim() || null;
}

interface Call {
  deps: HttpDeps;
  product: ProductSlug;
  body: Record<string, unknown>;
}

export function householdHandlers(source: HandlerSource): HouseholdHandlers {
  /**
   * Shared front of every endpoint, in this order: flag off -> 404 off; not POST -> 405; the
   * IP limit (when `limitIp`) -> 429; bad JSON -> 400; unknown product -> 400 unknown_product.
   * Anything unexpected is a 500 that says nothing, and is logged without the request.
   */
  function endpoint(work: (call: Call) => Promise<Response>, opts: { limitIp: boolean }): HouseholdHandler {
    return async (req, contextIp) => {
      const settings = householdSettings(source.env());
      if (!settings.enabled) return json(404, { error: "off" });
      if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
      try {
        const deps = source.build(settings);
        const { db, now } = deps.household;
        await ensureHouseholdTables(db);

        if (opts.limitIp) {
          const ip = clientIp(req, contextIp);
          // No address (never on Netlify) means no IP limit rather than one bucket for everybody.
          if (ip && !(await takeHit(db, ipBucket(ip), deps.perIpLimit, now()))) {
            return json(429, { error: "rate_limited" });
          }
        }

        const text = await req.text();
        if (text.length > MAX_BODY_BYTES) return bad();
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return bad();
        }
        if (typeof body !== "object" || body === null || Array.isArray(body)) return bad();
        const fields = body as Record<string, unknown>;
        if (!isHouseholdProduct(fields.product)) return bad("unknown_product");

        return await work({ deps, product: fields.product, body: fields });
      } catch (err) {
        console.error("household: unexpected error:", err instanceof Error ? err.message : err);
        return json(500, { error: "server_error" });
      }
    };
  }

  /** The /start endpoints: answer no sooner than startMinMs, whatever happened inside. */
  async function padded(deps: HttpDeps, run: () => Promise<Response>): Promise<Response> {
    const started = Date.now();
    const res = await run();
    const left = deps.startMinMs - (Date.now() - started);
    if (left > 0) await deps.sleep(left);
    return res;
  }

  return {
    // fetch is by an unguessable app user id and is not under the email-code limits.
    fetch: endpoint(
      async ({ deps, product, body }) => {
        if (!isAppUserId(body.appUserId) || !isPlatform(body.platform)) return bad();
        return reply(await fetchRecord(deps.household, product, body.appUserId, body.platform.toLowerCase()));
      },
      { limitIp: false }
    ),

    signinStart: endpoint(
      async ({ deps, product, body }) => {
        if (!isEmail(body.email)) return bad("bad_email");
        const email = body.email;
        return padded(deps, async () => reply((await startSignin(deps.household, product, email)).answer));
      },
      { limitIp: true }
    ),

    signinVerify: endpoint(
      async ({ deps, product, body }) => {
        if (!isEmail(body.email)) return bad("bad_email");
        if (!isCode(body.code) || !isPlatform(body.platform)) return bad();
        return reply(await verifySignin(deps.household, product, body.email, body.code));
      },
      { limitIp: true }
    ),

    linkStart: endpoint(
      async ({ deps, product, body }) => {
        if (!isAppUserId(body.appUserId)) return bad();
        if (!isEmail(body.email)) return bad("bad_email");
        const { appUserId, email } = body;
        return padded(deps, async () => reply((await startLink(deps.household, product, appUserId, email)).answer));
      },
      { limitIp: true }
    ),

    linkVerify: endpoint(
      async ({ deps, product, body }) => {
        if (!isAppUserId(body.appUserId)) return bad();
        if (!isEmail(body.email)) return bad("bad_email");
        if (!isCode(body.code)) return bad();
        return reply(await verifyLink(deps.household, product, body.appUserId, body.email, body.code));
      },
      { limitIp: true }
    ),
  };
}
