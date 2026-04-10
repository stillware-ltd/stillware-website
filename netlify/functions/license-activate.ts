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
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }

  const { license_key, machine_id, machine_name } = body;
  if (!license_key || !machine_id) {
    return jsonResponse({ success: false, error: "Missing license_key or machine_id" }, 400);
  }

  const keyHash = hashLicenseKey(license_key);
  const db = getDb();

  // 1. Look up license
  const license = await db.execute({
    sql: "SELECT id, email, max_activations, revoked FROM licenses WHERE key_hash = ?",
    args: [keyHash],
  });

  if (license.rows.length === 0) {
    return jsonResponse({ success: false, error: "Invalid license key." }, 404);
  }

  const row = license.rows[0];
  if (row.revoked) {
    return jsonResponse({ success: false, error: "This license has been revoked." }, 403);
  }

  const licenseId = row.id as string;
  const maxActivations = row.max_activations as number;
  const customerEmail = row.email as string;

  // 2. Check if this machine already has an activation (active or deactivated)
  const existing = await db.execute({
    sql: "SELECT id, deactivated_at FROM activations WHERE license_id = ? AND machine_id = ?",
    args: [licenseId, machine_id],
  });

  if (existing.rows.length > 0) {
    const activation = existing.rows[0];
    if (activation.deactivated_at) {
      // Reactivate: clear deactivated_at
      await db.execute({
        sql: "UPDATE activations SET deactivated_at = NULL, machine_name = ? WHERE id = ?",
        args: [machine_name || null, activation.id],
      });
    }
    // Return existing (or just reactivated) instance
    return jsonResponse({
      success: true,
      instance_id: activation.id as string,
      license_key,
      customer_email: customerEmail,
    });
  }

  // 3. Count active activations
  const countResult = await db.execute({
    sql: "SELECT COUNT(*) as cnt FROM activations WHERE license_id = ? AND deactivated_at IS NULL",
    args: [licenseId],
  });
  const activeCount = countResult.rows[0].cnt as number;

  if (activeCount >= maxActivations) {
    return jsonResponse({
      success: false,
      error: `Activation limit reached (${maxActivations} devices). Deactivate another device first.`,
    }, 403);
  }

  // 4. Create new activation
  const insertResult = await db.execute({
    sql: `INSERT INTO activations (id, license_id, machine_id, machine_name)
          VALUES (lower(hex(randomblob(16))), ?, ?, ?)`,
    args: [licenseId, machine_id, machine_name || null],
  });

  // Fetch the inserted row to get the generated ID
  const newActivation = await db.execute({
    sql: "SELECT id FROM activations WHERE license_id = ? AND machine_id = ? AND deactivated_at IS NULL",
    args: [licenseId, machine_id],
  });

  const instanceId = newActivation.rows[0].id as string;

  return jsonResponse({
    success: true,
    instance_id: instanceId,
    license_key,
    customer_email: customerEmail,
  });
}

function jsonResponse(data: object, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
