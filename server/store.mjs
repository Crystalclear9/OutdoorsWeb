import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export function openStore(filename) {
  if (filename !== ":memory:")
    mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('enterprise','admin')),
      company TEXT NOT NULL, contact TEXT NOT NULL, phone TEXT NOT NULL,
      disabled INTEGER NOT NULL DEFAULT 0, must_change INTEGER NOT NULL DEFAULT 0,
      created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf TEXT NOT NULL, expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      company TEXT NOT NULL, contact TEXT NOT NULL, phone TEXT NOT NULL,
      start TEXT NOT NULL, end TEXT NOT NULL, slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 29),
      status TEXT NOT NULL CHECK(status IN ('待审核','已通过','未通过','已撤回')),
      reason TEXT NOT NULL DEFAULT '', image BLOB NOT NULL, image_type TEXT NOT NULL,
      created TEXT NOT NULL, reviewed TEXT, reviewer TEXT REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS bookings_user ON bookings(user_id,created);
    CREATE INDEX IF NOT EXISTS bookings_dates ON bookings(slot,start,end,status);
    CREATE TABLE IF NOT EXISTS notices (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, updated TEXT NOT NULL,
      author TEXT NOT NULL REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS closures (
      id TEXT PRIMARY KEY, slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 29),
      start TEXT NOT NULL, end TEXT NOT NULL, reason TEXT NOT NULL, created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT REFERENCES users(id),
      action TEXT NOT NULL, target TEXT NOT NULL, created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset INTEGER NOT NULL
    );
  `);
  return db;
}
