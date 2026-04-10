import type { Context } from "@netlify/functions";
import { getDb } from "./lib/db.js";
import { hashLicenseKey } from "./lib/crypto.js";

export default async function handler(req: Request, _context: Context) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ valid: false, reason: "Invalid JSON" }, 400);
  }

  const { license_key, instance_id } = body;
  if (!license_key) {
    return jsonResponse({ valid: false, reason: "Missing license_key" }, 400);
  }

  const keyHash = hashLicenseKey(license_key);
  const db = getDb();

  // 1. Check license exists and is not revoked
  const license = await db.execute({
    sql: "SELECT id, revoked FROM licenses WHERE key_hash = ?",
    args: [keyHash],
  });

  if (license.rows.length === 0) {
    return jsonResponse({ valid: false, reason: "Invalid license key." });
  }

  if (license.rows[0].revoked) {
    return jsonResponse({ valid: false, reason: "License has been revoked." });
  }

  // 2. If instance_id provided, verify the activation is active
  if (instance_id) {
    const licenseId = license.rows[0].id as string;
    const activation = await db.execute({
      sql: "SELECT id FROM activations WHERE id = ? AND license_id = ? AND deactivated_at IS NULL",
      args: [instance_id, licenseId],
    });

    if (activation.rows.length === 0) {
      return jsonResponse({ valid: false, reason: "Activation not found or deactivated." });
    }
  }

  return jsonResponse({ valid: true });
}

function jsonResponse(data: object, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
