// One-shot migration: adds the `product` column + index to an existing
// licenses table. Safe to re-run — uses idempotent guards.
//
// Existing rows are tagged 'zeroed' (the only product that existed before
// this migration), preserving current behaviour for live keys.
//
// Usage:
//   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... node migrate-add-product.mjs

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
    console.error("❌ Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN env var.");
    process.exit(1);
}

const db = createClient({ url, authToken });

async function columnExists(table, column) {
    const result = await db.execute(`PRAGMA table_info(${table})`);
    return result.rows.some((row) => row.name === column);
}

async function migrate() {
    try {
        if (await columnExists("licenses", "product")) {
            console.log("ℹ️  Column `product` already present — skipping ALTER.");
        } else {
            console.log("→ Adding `product` column with default 'zeroed'...");
            await db.execute(
                "ALTER TABLE licenses ADD COLUMN product TEXT NOT NULL DEFAULT 'zeroed'"
            );
            console.log("✅ Column added.");
        }

        console.log("→ Ensuring index on (product)...");
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_licenses_product ON licenses(product)"
        );
        console.log("✅ Migration complete.");
    } catch (error) {
        console.error("❌ Migration failed:", error.message);
        process.exit(1);
    }
}

migrate();
