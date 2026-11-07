// SQLite database (better-sqlite3). One file, data/lost.db by default (LOST_DB to change, ":memory:" in tests).
// Migrations in migrations/NNN_name.sql run once each, in order, inside a transaction.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

export let db = null;

export function openDb(file, migrationsDir) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const done = new Set(db.prepare("SELECT name FROM schema_migrations").all().map((r) => r.name));
  const files = fs.readdirSync(migrationsDir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, f), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(f, now());
    })();
  }
  return db;
}

export const now = () => new Date().toISOString();
export const newId = (bytes = 12) => crypto.randomBytes(bytes).toString("base64url");
export const one = (sql, ...a) => db.prepare(sql).get(...a);
export const all = (sql, ...a) => db.prepare(sql).all(...a);
export const run = (sql, ...a) => db.prepare(sql).run(...a);
export const tx = (fn) => db.transaction(fn)();
export const parse = (s, fallback = null) => { try { return s == null ? fallback : JSON.parse(s); } catch { return fallback; } };

// Join codes: 6 characters from an alphabet without look-alikes (no 0/O, 1/I/L).
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function joinCode() {
  for (;;) {
    const c = Array.from(crypto.randomBytes(6), (b) => ALPHA[b % ALPHA.length]).join("");
    if (!one("SELECT 1 FROM sections WHERE join_code = ?", c)) return c;
  }
}
