import type { Context } from "@netlify/functions";
import { getDb } from "./lib/db.js";
import { isValidProduct } from "./lib/products.js";

// Returns the recorded trial start for a device, or 404 when the device has
// no trial on record (the client treats 404 as "start fresh").
export default async function handler(req: Request, _context: Context) {
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const url = new URL(req.url);
  const product = url.searchParams.get("product") ?? undefined;
  const deviceId = url.searchParams.get("device_id")?.trim();

  if (!isValidProduct(product)) {
    return jsonResponse({ error: "Unknown product" }, 400);
  }
  if (!deviceId) {
    return jsonResponse({ error: "device_id is required" }, 400);
  }

  const db = getDb();
  const result = await db.execute({
    sql: "SELECT started_at FROM trials WHERE product = ? AND device_id = ?",
    args: [product, deviceId],
  });

  if (result.rows.length === 0) {
    return jsonResponse({ error: "No trial" }, 404);
  }

  return jsonResponse({ started_at: result.rows[0].started_at });
}

function jsonResponse(data: object, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
