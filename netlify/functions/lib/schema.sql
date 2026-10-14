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
  platform        TEXT
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
