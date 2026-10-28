import type { Context } from "@netlify/functions";
import { Environment, Paddle, type Customer } from "@paddle/paddle-node-sdk";
import { getDb } from "./lib/db.js";
import { sendLicenseEmail } from "./lib/email.js";
import { outboxKeyFromEnv } from "./lib/household-prod.js";
import { keySender, realSleep } from "./lib/mail-prod.js";
import { isValidProduct } from "./lib/products.js";
import { resendKeys, type Purchase } from "./lib/resend-key.js";

// Lost-key recovery: POST /api/licenses/resend-key {email, product} -> 200 {"sent": true}.
// (Client contract: RankUp Chess DECISIONS.md P4, PaddleService.requestKeyRecovery.)
//
// Neither the key nor, since 2026-09-30, the buyer's address is stored here. Paddle, the
// merchant of record, holds the address: we ask it for that customer's completed
// transactions, match them to licences by paddle_txn_id, and email a new key for each
// (lib/resend-key.ts). Keys only ever go to the address Paddle holds for the purchase.
//
// Every well-formed request gets the same answer whether or not the address bought
// anything, so the endpoint cannot be used to find out who is a customer.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req: Request, _context: Context) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = process.env.PADDLE_API_KEY;
  if (!apiKey) {
    console.error("resend-key: missing PADDLE_API_KEY");
    return jsonResponse({ sent: false, error: "Server misconfigured" }, 500);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ sent: false, error: "Invalid JSON" }, 400);
  }

  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const product = body?.product;
  if (!isValidProduct(product)) {
    return jsonResponse({ sent: false, error: "Unknown product." }, 400);
  }
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return jsonResponse({ sent: false, error: "Enter a valid email address." }, 400);
  }

  const paddle = new Paddle(apiKey, { environment: Environment.production });

  // A failure here does not depend on the address, so it can be reported without
  // revealing anything; the app then shows its "could not resend" message.
  const customers: Customer[] = [];
  try {
    // Paddle matches the address exactly; try it as typed and lower-cased.
    const variants = [...new Set([email, email.toLowerCase()])];
    for await (const customer of paddle.customers.list({ email: variants })) {
      customers.push(customer);
    }
  } catch (err) {
    console.error("resend-key: Paddle customer lookup failed:", err);
    return jsonResponse({ sent: false, error: "Could not look up purchases. Try again later." }, 502);
  }

  async function* purchases(): AsyncGenerator<Purchase> {
    for (const customer of customers) {
      const transactions = paddle.transactions.list({
        customerId: [customer.id],
        status: ["completed"],
      });
      for await (const txn of transactions) {
        yield { id: txn.id, items: txn.items, customerEmail: customer.email };
      }
    }
  }

  try {
    const db = getDb();
    // A key mail that fails is tried again at once and then kept for the hourly run (lib/mail-prod.ts).
    const send = keySender({ db, key: outboxKeyFromEnv(), now: () => new Date(), sleep: realSleep, send: sendLicenseEmail });
    const outcomes = await resendKeys({ db, send: (to, key, p, opts) => send(to, key, p, opts) }, purchases(), product);
    // Transaction ids and outcomes only: never the address.
    console.log(`resend-key: ${product}: ${JSON.stringify(outcomes)}`);
  } catch (err) {
    console.error("resend-key: failed after the customer lookup:", err);
  }

  return jsonResponse({ sent: true });
}

function jsonResponse(data: object, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
