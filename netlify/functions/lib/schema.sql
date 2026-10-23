-- Stillware License Database Schema
-- Multi-product: a single Turso DB serves Zeroed, RankUp Chess, and any
-- future Stillware app. Each license row carries a `product` slug so
-- activate/validate can scope queries correctly and prevent cross-product
-- key reuse.
--
-- Run against Turso: turso db shell <db-name> < schema.sql

CREATE TABLE IF NOT EXISTS licenses (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  key_hash        TEXT NOT NULL UNIQUE,
  email           TEXT NOT NULL,
  paddle_txn_id   TEXT NOT NULL UNIQUE,
  product         TEXT NOT NULL DEFAULT 'zeroed',  -- 'zeroed' | 'rankup' | ...
  max_activations INTEGER NOT NULL DEFAULT 3,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  revoked         INTEGER NOT NULL DEFAULT 0,
  -- 'macos' | 'windows' (Windows and Linux) for per-platform RankUp Chess licences;
  -- NULL activates on any platform (Zeroed, and every licence minted before
  -- 2026-10-14). Added to existing databases by lib/licenses.ts on first use.
  platform        TEXT,
  -- 'every_device' for a licence sold at an Every device price (household licence, KL.2);
  -- NULL for everything sold before. Added to existing databases by lib/licenses.ts on first use.
  tier            TEXT
);

CREATE TABLE IF NOT EXISTS activations (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  license_id      TEXT NOT NULL REFERENCES licenses(id),
  machine_id      TEXT NOT NULL,
  machine_name    TEXT,
  activated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deactivated_at  TEXT,
  UNIQUE(license_id, machine_id)
);

-- Keys issued after the purchase for the same licence (lost-key recovery,
-- license-resend-key.ts). The original key stays in licenses.key_hash; every key
-- here unlocks the same licence, with the same activations and device limit.
-- Created on first use by lib/licenses.ts, so it needs no manual migration.
CREATE TABLE IF NOT EXISTS license_keys (
  key_hash        TEXT PRIMARY KEY,
  license_id      TEXT NOT NULL REFERENCES licenses(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activations_license ON activations(license_id);
CREATE INDEX IF NOT EXISTS idx_license_keys_license ON license_keys(license_id);
CREATE INDEX IF NOT EXISTS idx_licenses_email ON licenses(email);
CREATE INDEX IF NOT EXISTS idx_licenses_product ON licenses(product);

-- Free-trial anchor (server-side). Keyed by (product, device_id) so a
-- reinstall returns the ORIGINAL started_at instead of restarting the trial.
CREATE TABLE IF NOT EXISTS trials (
  product    TEXT NOT NULL,   -- 'zeroed' | 'rankup' | ...
  device_id  TEXT NOT NULL,   -- Android ANDROID_ID / iOS identifierForVendor
  started_at TEXT NOT NULL,
  PRIMARY KEY (product, device_id)
);

-- ---------------------------------------------------------------------------------------------
-- Household licence (KL.2): "Every device". Dark until HOUSEHOLD_ENABLED is "1".
-- Created on first use by lib/household-store.ts (HOUSEHOLD_SCHEMA), so no manual migration is
-- needed; the statements below are the same ones, and a test keeps the two identical.
--
--  household_store_entitlements  Every device purchases by RevenueCat app user id (revenuecat-webhook).
--                                `lid` is the licence id in the record; `revoked` is set by a refund.
--  household_email_links         An address linked to an app user id, as a SHA-256 of the normalised address.
--  household_codes               Sign-in and link codes: salted hash, expiry, tries, single use. A row with no
--                                `lid` is a decoy for an address with no purchase (it can never match).
--  household_issued              The signed records (the exact text signed, and the signature), per key id.
--  household_devices             Successful sign-ins per licence, against HOUSEHOLD_DEVICE_CAP.
--  household_hits                Rate-limit hits (hashed address, hashed IP), kept two hours or so.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS household_store_entitlements (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  product                 TEXT NOT NULL,
  app_user_id             TEXT NOT NULL,
  lid                     TEXT NOT NULL UNIQUE,
  product_id              TEXT NOT NULL,
  store                   TEXT NOT NULL,
  via                     TEXT NOT NULL,
  purchased               TEXT NOT NULL,
  transaction_id          TEXT NOT NULL UNIQUE,
  original_transaction_id TEXT,
  environment             TEXT NOT NULL DEFAULT 'PRODUCTION',
  revoked                 INTEGER NOT NULL DEFAULT 0,
  revoked_at              TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_household_ent_user ON household_store_entitlements(product, app_user_id);

CREATE TABLE IF NOT EXISTS household_email_links (
  product     TEXT NOT NULL,
  email_hash  TEXT NOT NULL,
  app_user_id TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (product, email_hash, app_user_id)
);
CREATE INDEX IF NOT EXISTS idx_household_links_user ON household_email_links(app_user_id);

CREATE TABLE IF NOT EXISTS household_codes (
  id          TEXT PRIMARY KEY,
  purpose     TEXT NOT NULL,
  product     TEXT NOT NULL,
  email_hash  TEXT NOT NULL,
  app_user_id TEXT NOT NULL DEFAULT '',
  lid         TEXT,
  lid_source  TEXT,
  salt        TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  tries       INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  closed_at   TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_household_codes_lookup ON household_codes(purpose, product, email_hash, created_at);

CREATE TABLE IF NOT EXISTS household_issued (
  product    TEXT NOT NULL,
  lid        TEXT NOT NULL,
  kid        TEXT NOT NULL,
  record     TEXT NOT NULL,
  sig        TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (product, lid, kid)
);

CREATE TABLE IF NOT EXISTS household_devices (
  product    TEXT NOT NULL,
  lid        TEXT NOT NULL,
  devices    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (product, lid)
);

CREATE TABLE IF NOT EXISTS household_hits (
  bucket TEXT NOT NULL,
  at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_household_hits_bucket ON household_hits(bucket, at);
CREATE INDEX IF NOT EXISTS idx_household_hits_at ON household_hits(at);
