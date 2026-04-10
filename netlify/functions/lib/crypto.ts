import crypto from "node:crypto";

/**
 * Generates a 128-bit random license key formatted as 8 groups of 4 uppercase hex chars.
 * Example: "A1B2-C3D4-E5F6-7890-ABCD-EF12-3456-7890"
 */
export function generateLicenseKey(): string {
  const bytes = crypto.randomBytes(16);
  const hex = bytes.toString("hex").toUpperCase(); // 32 chars [0-9A-F]
  return hex.match(/.{4}/g)!.join("-");
}

/**
 * SHA-256 hash of the normalized (no hyphens, uppercase) license key.
 * This is what gets stored in the database — never the plaintext.
 */
export function hashLicenseKey(key: string): string {
  const normalized = key.replace(/-/g, "").toUpperCase();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}
