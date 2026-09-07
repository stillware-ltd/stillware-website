import type { Context } from "@netlify/functions";
import crypto from "node:crypto";
import { getDb } from "./lib/db.js";

// Private marketing boards: an append-only queue of board edits ("ops") made in the
// browser at /dashboard/<board>/ (zeroed, rankup, ...). Every request carries `b=<board>`
// (default zeroed, so the original Zeroed page and dash.py keep working unchanged); each
// board has its own token hash (`token_hash` for zeroed, `token_hash:<board>` otherwise)
// and only ever sees its own ops. The page pushes ops here; `dash.py sync pull`
// (Marketing/Zeroed/Dashboard) drains them into the JSON files (the source of truth)
// and acks them before every build, so the next encrypted bundle already carries them.
//
// Auth: bearer token = SHA-256("zb-api|" + passphrase) computed by the page (and by
// dash.py) from the same passphrase that opens the bundle. The server stores only
// SHA-256(token). The hash is set once by `dash.py sync init` (trust on first use);
// re-init needs the previous token.
//
// Routes (query `a=`):  GET status | GET pending | POST push {ops} | POST ack {ids} | POST init {token[, previous]}

const OPS = new Set(["task.upsert", "task.delete", "task.reorder", "sched.status", "decision.add"]);
const MAX_OPS = 200;
const MAX_DATA = 20_000;

let ready = false;
async function ensureTables() {
  if (ready) return;
  const db = getDb();
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS dashboard_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dashboard_ops (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      op TEXT NOT NULL,
      data TEXT NOT NULL,
      applied INTEGER NOT NULL DEFAULT 0,
      received TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dashboard_ops_applied ON dashboard_ops(applied, ts);
  `);
  // Added 2026-09-06 for the second board; SQLite has no ADD COLUMN IF NOT EXISTS.
  try {
    await db.execute("ALTER TABLE dashboard_ops ADD COLUMN board TEXT NOT NULL DEFAULT 'zeroed'");
  } catch {
    /* column already exists */
  }
  ready = true;
}

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const same = (a: string, b: string) =>
  a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const BOARD_RE = /^[a-z][a-z0-9-]{1,23}$/;
function boardOf(url: URL): string {
  const b = url.searchParams.get("b") || "zeroed";
  return BOARD_RE.test(b) ? b : "zeroed";
}
const kvKey = (board: string) => (board === "zeroed" ? "token_hash" : `token_hash:${board}`);

async function storedHash(board: string): Promise<string | null> {
  const r = await getDb().execute({ sql: "SELECT v FROM dashboard_kv WHERE k = ?", args: [kvKey(board)] });
  return r.rows.length ? String(r.rows[0].v) : null;
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  const m = /^Bearer\s+([A-Za-z0-9]{32,128})$/.exec(h);
  return m ? m[1] : null;
}

export default async function handler(req: Request, _context: Context) {
  const url = new URL(req.url);
  const action = url.searchParams.get("a") || "";
  const board = boardOf(url);
  try {
    await ensureTables();
  } catch (e: any) {
    return json({ error: "db unavailable", detail: String(e?.message || e) }, 503);
  }

  if (req.method === "GET" && action === "status") {
    const hash = await storedHash(board);
    const tok = bearer(req);
    const authed = !!(hash && tok && same(sha(tok), hash));
    let pending = 0;
    if (authed) {
      const r = await getDb().execute({ sql: "SELECT COUNT(*) AS n FROM dashboard_ops WHERE applied = 0 AND board = ?", args: [board] });
      pending = Number(r.rows[0].n);
    }
    return json({ board, configured: !!hash, authed, pending });
  }

  if (req.method === "POST" && action === "init") {
    const body = await readJson(req);
    if (!body) return json({ error: "Invalid JSON" }, 400);
    const token = typeof body.token === "string" ? body.token : "";
    if (!/^[a-f0-9]{64}$/.test(token)) return json({ error: "token must be a 64-hex sha256" }, 400);
    const hash = await storedHash(board);
    if (hash) {
      const prev = typeof body.previous === "string" ? body.previous : "";
      if (!prev || !same(sha(prev), hash)) return json({ error: "already configured; send previous token to rotate" }, 409);
    }
    await getDb().execute({
      sql: "INSERT INTO dashboard_kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      args: [kvKey(board), sha(token)],
    });
    return json({ ok: true, rotated: !!hash });
  }

  // Everything below needs a valid token for this board.
  const hash = await storedHash(board);
  const tok = bearer(req);
  if (!hash) return json({ error: "not configured (run dash.py sync init)" }, 503);
  if (!tok || !same(sha(tok), hash)) return json({ error: "unauthorized" }, 401);

  if (req.method === "GET" && action === "pending") {
    const r = await getDb().execute({
      sql: "SELECT id, ts, op, data FROM dashboard_ops WHERE applied = 0 AND board = ? ORDER BY ts, received LIMIT 500",
      args: [board],
    });
    const ops = r.rows.map((x) => ({ id: String(x.id), ts: String(x.ts), op: String(x.op), data: safeParse(String(x.data)) }));
    return json({ ops, server_ts: new Date().toISOString() });
  }

  if (req.method === "POST" && action === "push") {
    const body = await readJson(req);
    if (!body || !Array.isArray(body.ops)) return json({ error: "ops[] required" }, 400);
    if (body.ops.length > MAX_OPS) return json({ error: `at most ${MAX_OPS} ops per push` }, 400);
    const received = new Date().toISOString();
    const accepted: string[] = [];
    const rejected: { id?: string; why: string }[] = [];
    const stmts: { sql: string; args: any[] }[] = [];
    for (const o of body.ops) {
      const why = validate(o);
      if (why) { rejected.push({ id: o?.id, why }); continue; }
      stmts.push({
        sql: "INSERT OR IGNORE INTO dashboard_ops (id, ts, op, data, applied, received, board) VALUES (?, ?, ?, ?, 0, ?, ?)",
        args: [o.id, o.ts, o.op, JSON.stringify(o.data), received, board],
      });
      accepted.push(o.id);
    }
    if (stmts.length) await getDb().batch(stmts, "write");
    return json({ accepted, rejected });
  }

  if (req.method === "POST" && action === "ack") {
    const body = await readJson(req);
    if (!body || !Array.isArray(body.ids)) return json({ error: "ids[] required" }, 400);
    const ids = body.ids.filter((x: unknown) => typeof x === "string" && /^[A-Za-z0-9_-]{6,40}$/.test(x)).slice(0, 500);
    if (!ids.length) return json({ acked: 0 });
    const placeholders = ids.map(() => "?").join(",");
    const r = await getDb().execute({
      sql: `UPDATE dashboard_ops SET applied = 1 WHERE applied = 0 AND board = ? AND id IN (${placeholders})`,
      args: [board, ...ids],
    });
    // Keep the table small: applied ops older than 30 days are of no further use.
    await getDb().execute({
      sql: "DELETE FROM dashboard_ops WHERE applied = 1 AND received < ?",
      args: [new Date(Date.now() - 30 * 864e5).toISOString()],
    });
    return json({ acked: r.rowsAffected });
  }

  return json({ error: "unknown action" }, 404);
}

function validate(o: any): string | null {
  if (!o || typeof o !== "object") return "op must be an object";
  if (typeof o.id !== "string" || !/^[A-Za-z0-9_-]{6,40}$/.test(o.id)) return "bad id";
  if (typeof o.ts !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(o.ts)) return "bad ts";
  if (!OPS.has(o.op)) return "unknown op";
  if (!o.data || typeof o.data !== "object") return "data required";
  if (JSON.stringify(o.data).length > MAX_DATA) return "data too large";
  return null;
}

async function readJson(req: Request): Promise<any | null> {
  try { return await req.json(); } catch { return null; }
}
function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
function json(data: object, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
