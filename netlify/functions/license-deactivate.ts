import type { Context } from "@netlify/functions";
import { getDb } from "./lib/db.js";
import { hashLicenseKey } from "./lib/crypto.js";
import {
  DEFAULT_PRODUCT_FOR_LEGACY_CLIENTS,
  isValidProduct,
} from "./lib/products.js";

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

  const { license_key, instance_id, product } = body;
  if (!license_key || !instance_id) {
    return jsonResponse({ success: false, error: "Missing license_key or instance_id" }, 400);
  }

  const productSlug = isValidProduct(product)
    ? product
    : DEFAULT_PRODUCT_FOR_LEGACY_CLIENTS;

  const keyHash = hashLicenseKey(license_key);
  const db = getDb();

  // Verify the license exists for the requested product
  const license = await db.execute({
    sql: "SELECT id FROM licenses WHERE key_hash = ? AND product = ?",
    args: [keyHash, productSlug],
  });

  if (license.rows.length === 0) {
    return jsonResponse({ success: false, error: "Invalid license key." }, 404);
  }

  const licenseId = license.rows[0].id as string;

  // Deactivate the specific activation
  const result = await db.execute({
    sql: `UPDATE activations SET deactivated_at = datetime('now')
          WHERE id = ? AND license_id = ? AND deactivated_at IS NULL`,
    args: [instance_id, licenseId],
  });

  if (result.rowsAffected === 0) {
    return jsonResponse({ success: false, error: "Activation not found or already deactivated." }, 404);
  }

  return jsonResponse({ success: true, deactivated: true });
}

function jsonResponse(data: object, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
