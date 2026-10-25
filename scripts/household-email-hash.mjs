#!/usr/bin/env node
// Prints the keyed hash under which the household licence server keeps an address (KL.8), for
// support's deletion line in docs/household-licence-server.md ("Delete a family's linked email").
// Needs HOUSEHOLD_EMAIL_KEY in the environment: the same base64 value Netlify holds. Prints the
// hash and nothing else, and never the address.
//
//   HOUSEHOLD_EMAIL_KEY=... node scripts/household-email-hash.mjs "parent@example.com"
//
// It must match emailHash() in netlify/functions/lib/household-store.ts; a test runs this script
// against it.
import crypto from "node:crypto";

const [address] = process.argv.slice(2);
const keyText = (process.env.HOUSEHOLD_EMAIL_KEY ?? "").trim();
const key = /^[A-Za-z0-9+/]+={0,2}$/.test(keyText) ? Buffer.from(keyText, "base64") : Buffer.alloc(0);

if (!address) {
  console.error('usage: HOUSEHOLD_EMAIL_KEY=... node scripts/household-email-hash.mjs "<address>"');
  process.exit(2);
}
if (key.length < 32) {
  console.error("HOUSEHOLD_EMAIL_KEY is not set, or shorter than 32 bytes");
  process.exit(2);
}
console.log(crypto.createHmac("sha256", key).update("email|" + address.trim().toLowerCase()).digest("hex"));
