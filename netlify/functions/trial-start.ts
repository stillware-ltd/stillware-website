import type { Context } from "@netlify/functions";
import { getDb } from "./lib/db.js";
import { isValidProduct } from "./lib/products.js";

// Server-anchored free-trial start (fixes the Android reinstall-reset bug).
// Idempotent per (product, device_id): a reinstall hits the same key and gets
// the ORIGINAL started_at, so the trial cannot restart.
export default async function handler(req: Request, _context: Context) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { product, device_id } = body;
  if (!isValidProduct(product)) {
    return jsonResponse({ error: "Unknown product" }, 400);
  }
  if (!device_id || typeof device_id !== "string" || !device_id.trim()) {
    return jsonResponse({ error: "device_id is required" }, 400);
  }

  const deviceId = device_id.trim();
  const db = getDb();

  // Return the existing start if present (the anti-reset guarantee).
  const existing = await db.execute({
    sql: "SELECT started_at FROM trials WHERE product = ? AND device_id = ?",
    args: [product, deviceId],
  });
  if (existing.rows.length > 0) {
    return jsonResponse({ started_at: existing.rows[0].started_at });
  }

  const startedAt = new Date().toISOString();
  await db.execute({
    sql: "INSERT INTO trials (product, device_id, started_at) VALUES (?, ?, ?)",
    args: [product, deviceId, startedAt],
  });

  return jsonResponse({ started_at: startedAt });
}

function jsonResponse(data: object, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
