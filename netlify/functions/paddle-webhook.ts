import type { Context } from "@netlify/functions";
import { Environment, Paddle, EventName } from "@paddle/paddle-node-sdk";
import { getDb } from "./lib/db.js";
import { generateLicenseKey, hashLicenseKey } from "./lib/crypto.js";
import { sendLicenseEmail } from "./lib/email.js";

export default async function handler(req: Request, _context: Context) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const webhookSecret = process.env.PADDLE_WEBHOOK_SECRET;
  const apiKey = process.env.PADDLE_API_KEY;

  if (!webhookSecret || !apiKey) {
    console.error("Missing Paddle environment variables");
    return new Response("Server misconfigured", { status: 500 });
  }

  // 1. Extract raw body BEFORE any parsing
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("paddle-signature");

  if (!rawBody || !signatureHeader) {
    return new Response("Missing body or signature", { status: 400 });
  }

  // 2. Initialize SDK and Verify signature
  let eventData: any;
  const paddle = new Paddle(apiKey, {
    // environment: Environment.production, // (Change to Environment.sandbox if testing in sandbox)
    environment: Environment.sandbox,
  });

  try {
    eventData = paddle.webhooks.unmarshal(rawBody, webhookSecret, signatureHeader);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return new Response("Invalid signature", { status: 401 });
  }

  // 3. Only process transaction.completed events
  if (eventData.eventType !== EventName.TransactionCompleted) {
    return new Response(JSON.stringify({ success: true, skipped: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const transactionId = eventData.data?.id;
  // Look for camelCase (SDK format) or snake_case (raw JSON format) just to be safe
  const customerId = eventData.data?.customerId || eventData.data?.customer_id;

  if (!transactionId || !customerId) {
    console.error("Missing transaction ID or customer ID in webhook payload");
    return new Response("Missing required fields", { status: 400 });
  }

  // 4. Fetch the actual customer email from Paddle API
  let customerEmail: string;
  try {
    const customer = await paddle.customers.get(customerId);
    if (!customer || !customer.email) throw new Error("Customer has no email");
    customerEmail = customer.email;
  } catch (err) {
    console.error(`Failed to fetch email for customer ${customerId}:`, err);
    // Return 500 so Paddle retries the webhook later in case the API was just down
    return new Response("Failed to retrieve customer details", { status: 500 });
  }

  // 5. Generate license key
  const licenseKey = generateLicenseKey();
  const keyHash = hashLicenseKey(licenseKey);

  // 6. Store in database (idempotency via UNIQUE constraint)
  const db = getDb();
  try {
    await db.execute({
      sql: `INSERT INTO licenses (key_hash, email, paddle_txn_id)
            VALUES (?, ?, ?)`,
      args: [keyHash, customerEmail, transactionId],
    });
  } catch (err: any) {
    if (
      err?.message?.includes("UNIQUE constraint failed") ||
      err?.code === "SQLITE_CONSTRAINT_UNIQUE"
    ) {
      console.log(`Duplicate webhook for transaction ${transactionId}, returning 200`);
      return new Response(JSON.stringify({ success: true, duplicate: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error("Database error:", err);
    return new Response("Database error", { status: 500 });
  }

  // 7. Send license email
  try {
    await sendLicenseEmail(customerEmail, licenseKey);
  } catch (err) {
    console.error("Failed to send license email:", err);
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}