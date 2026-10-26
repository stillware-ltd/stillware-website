import type { Context } from "@netlify/functions";
import { getDb } from "./lib/db.js";
import { hashLicenseKey } from "./lib/crypto.js";
import { householdSettings } from "./lib/household-config.js";
import { everyDeviceOfLicence, householdRecordPart } from "./lib/household-licence.js";
import { findLicenseByKey } from "./lib/licenses.js";
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
    return jsonResponse({ valid: false, reason: "Invalid JSON" }, 400);
  }

  const { license_key, instance_id, product } = body;
  if (!license_key) {
    return jsonResponse({ valid: false, reason: "Missing license_key" }, 400);
  }

  // `product` is optional for backward compat with the live Zeroed app.
  const productSlug = isValidProduct(product)
    ? product
    : DEFAULT_PRODUCT_FOR_LEGACY_CLIENTS;

  const keyHash = hashLicenseKey(license_key);
  const db = getDb();

  // 1. Check license exists for the requested product and is not revoked
  const license = await findLicenseByKey(db, keyHash, productSlug);

  if (!license) {
    return jsonResponse({ valid: false, reason: "Invalid license key." });
  }

  if (license.revoked) {
    return jsonResponse({ valid: false, reason: "License has been revoked." });
  }

  // 2. If instance_id provided, verify the activation is active
  if (instance_id) {
    const licenseId = license.id as string;
    const activation = await db.execute({
      sql: "SELECT id FROM activations WHERE id = ? AND license_id = ? AND deactivated_at IS NULL",
      args: [instance_id, licenseId],
    });

    if (activation.rows.length === 0) {
      return jsonResponse({ valid: false, reason: "Activation not found or deactivated." });
    }
  }

  // Household licence (KL.2): an Every device licence (or one due the free upgrade) also gets its
  // signed record, as license-activate's answer carries it, so a key holder gets it at the next
  // periodic check without entering the key again. Nothing is added while HOUSEHOLD_ENABLED is off.
  const everyDevice = everyDeviceOfLicence(
    {
      revoked: license.revoked,
      tier: license.tier,
      created_at: license.created_at,
      paddle_txn_id: license.paddle_txn_id,
    },
    productSlug,
    householdSettings(process.env)
  );
  return jsonResponse({
    valid: true,
    ...(await householdRecordPart(db, productSlug, license.id as string, everyDevice, "license-validate")),
  });
}

function jsonResponse(data: object, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
