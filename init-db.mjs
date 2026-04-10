import { createClient } from "@libsql/client";

const db = createClient({
    url: "libsql://sw-zeroed-licenses-stillwareltd.aws-eu-west-1.turso.io",
    authToken: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzU4NDIzMzMsImlkIjoiMDE5ZDc4NzMtMmEwMS03YzJiLWFiMzgtYWM3YTA1YWE3ZTZjIiwicmlkIjoiYWViMGE1YzUtYjFiMC00NzYyLThkMDAtY2Y2NDRlNmU3YmJjIn0.VjMJPD9VSlIVvIgThZjpbL_0yHDyWhybbSSkUNnW39YGWsQK8-muJbTDqGFJJxde2ODsvg19MhtoXwY4y8GFDw"
});

const schema = `
CREATE TABLE licenses (
   id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
   key_hash        TEXT NOT NULL UNIQUE,
   email           TEXT NOT NULL,
   paddle_txn_id   TEXT NOT NULL UNIQUE,
   max_activations INTEGER NOT NULL DEFAULT 3,
   created_at      TEXT NOT NULL DEFAULT (datetime('now')),
   revoked         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE activations (
   id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
   license_id      TEXT NOT NULL REFERENCES licenses(id),
   machine_id      TEXT NOT NULL,
   machine_name    TEXT,
   activated_at    TEXT NOT NULL DEFAULT (datetime('now')),
   deactivated_at  TEXT,
   UNIQUE(license_id, machine_id)
);

CREATE INDEX idx_activations_license ON activations(license_id);
CREATE INDEX idx_licenses_email ON licenses(email);
`;

async function setup() {
    try {
        console.log("Connecting to Turso and creating tables...");
        await db.executeMultiple(schema);
        console.log("✅ Success! Your database is ready.");
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

setup();