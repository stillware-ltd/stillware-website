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
  revoked         INTEGER NOT NULL DEFAULT 0
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

CREATE INDEX IF NOT EXISTS idx_activations_license ON activations(license_id);
CREATE INDEX IF NOT EXISTS idx_licenses_email ON licenses(email);
CREATE INDEX IF NOT EXISTS idx_licenses_product ON licenses(product);
