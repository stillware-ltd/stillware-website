// Read-only verification for the multi-product migration.
//
// Confirms that `migrate-add-product.mjs` ran successfully against the
// target Turso DB by inspecting:
//   1. The `licenses` table schema (looking for the new `product` column)
//   2. Row counts grouped by product (existing Zeroed rows should default
//      to 'zeroed')
//   3. The presence of the `idx_licenses_product` index
//
// Usage (same env vars as migrate-add-product.mjs):
//   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... node verify-migration.mjs

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
    console.error("❌ Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN env var.");
    process.exit(1);
}

const db = createClient({ url, authToken });

function pad(value, width) {
    const str = String(value ?? "");
    return str.length >= width ? str : str + " ".repeat(width - str.length);
}

async function showSchema() {
    console.log("\n=== 1. licenses table schema ===");
    const result = await db.execute("PRAGMA table_info(licenses)");
    if (result.rows.length === 0) {
        console.log("⚠️  No `licenses` table found — has init-db.mjs been run?");
        return false;
    }

    console.log(
        pad("cid", 5) +
            pad("name", 18) +
            pad("type", 10) +
            pad("notnull", 9) +
            pad("default", 16) +
            "pk"
    );
    console.log("-".repeat(64));

    let hasProduct = false;
    for (const row of result.rows) {
        if (row.name === "product") hasProduct = true;
        console.log(
            pad(row.cid, 5) +
                pad(row.name, 18) +
                pad(row.type, 10) +
                pad(row.notnull, 9) +
                pad(row.dflt_value, 16) +
                String(row.pk)
        );
    }

    console.log("");
    if (hasProduct) {
        console.log("✅ `product` column is present.");
    } else {
        console.log(
            "❌ `product` column is MISSING — migration did not run, or ran on a different DB."
        );
    }
    return hasProduct;
}

async function showRowCountsByProduct() {
    console.log("\n=== 2. Row counts by product ===");
    try {
        const result = await db.execute(
            "SELECT product, COUNT(*) AS cnt FROM licenses GROUP BY product ORDER BY product"
        );
        if (result.rows.length === 0) {
            console.log("(no rows in `licenses` table yet)");
            return;
        }
        console.log(pad("product", 16) + "count");
        console.log("-".repeat(24));
        for (const row of result.rows) {
            console.log(pad(row.product, 16) + String(row.cnt));
        }
        console.log("");
        console.log(
            "ℹ️  Existing rows should all be tagged 'zeroed' (the column default)."
        );
    } catch (e) {
        console.log(
            `⚠️  Could not group by product: ${e.message}. ` +
                "This usually means the `product` column is missing."
        );
    }
}

async function showIndexes() {
    console.log("\n=== 3. Indexes on licenses ===");
    const result = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='licenses' ORDER BY name"
    );

    if (result.rows.length === 0) {
        console.log("(no indexes found)");
        return;
    }

    let hasProductIndex = false;
    for (const row of result.rows) {
        const isTarget = row.name === "idx_licenses_product";
        if (isTarget) hasProductIndex = true;
        console.log(`  ${isTarget ? "→" : " "} ${row.name}`);
    }

    console.log("");
    if (hasProductIndex) {
        console.log("✅ `idx_licenses_product` is present.");
    } else {
        console.log("❌ `idx_licenses_product` is MISSING.");
    }
    return hasProductIndex;
}

async function verify() {
    try {
        const hasProduct = await showSchema();
        if (hasProduct) {
            await showRowCountsByProduct();
        }
        const hasIndex = await showIndexes();

        console.log("\n=== Summary ===");
        if (hasProduct && hasIndex) {
            console.log("✅ Migration verified — schema looks correct.");
        } else {
            console.log(
                "⚠️  Migration is incomplete. Re-run migrate-add-product.mjs against this DB."
            );
            process.exit(1);
        }
    } catch (e) {
        console.error("❌ Verification failed:", e.message);
        process.exit(1);
    }
}

verify();
