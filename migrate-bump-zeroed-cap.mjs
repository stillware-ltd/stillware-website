// One-shot migration: bumps the activation cap for existing Zeroed licenses
// from 3 → 5 to accommodate users on desktop (Windows/macOS/Linux) plus
// sideloaded Android APK installs. Safe to re-run — only updates rows that
// still have the old cap of 3.
//
// Leaves RankUp Chess licenses untouched (they stay at 3).
//
// Usage:
//   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... node migrate-bump-zeroed-cap.mjs

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
    console.error("❌ Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN env var.");
    process.exit(1);
}

const db = createClient({ url, authToken });

async function migrate() {
    try {
        const before = await db.execute({
            sql: "SELECT COUNT(*) AS cnt FROM licenses WHERE product = ? AND max_activations = ?",
            args: ["zeroed", 3],
        });
        const toUpdate = before.rows[0].cnt;
        console.log(`→ Found ${toUpdate} Zeroed license(s) at cap=3. Bumping to 5...`);

        if (toUpdate === 0) {
            console.log("ℹ️  Nothing to migrate — no Zeroed rows at cap=3.");
            return;
        }

        const result = await db.execute({
            sql: "UPDATE licenses SET max_activations = ? WHERE product = ? AND max_activations = ?",
            args: [5, "zeroed", 3],
        });

        console.log(`✅ Updated ${result.rowsAffected} row(s).`);
    } catch (error) {
        console.error("❌ Migration failed:", error.message);
        process.exit(1);
    }
}

migrate();
