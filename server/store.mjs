import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export function openStore(filename) {
  if (filename !== ":memory:")
    mkdirSync(path.dirname(path.resolve(filename)), {
      recursive: true,
      mode: 0o700,
    });
  const db = new DatabaseSync(filename);
  if (db.prepare("PRAGMA user_version").get().user_version > 3) {
    db.close();
    throw new Error("数据库版本高于当前程序，请使用匹配版本，禁止直接降级");
  }
  db.exec(`
    PRAGMA busy_timeout=5000;
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
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
  // Additive, transactional migration of existing databases; never reseed data.
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS captchas(id TEXT PRIMARY KEY,binding TEXT NOT NULL,answer TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS captcha_expiry ON captchas(expires);
      CREATE TABLE IF NOT EXISTS maintenance_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS health_probe(id INTEGER PRIMARY KEY,checked INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,content TEXT NOT NULL,target TEXT NOT NULL,created TEXT NOT NULL,read_at TEXT);
      CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id,created);
    `);
    const columns = (table) =>
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((c) => c.name);
    for (const [name, type] of [
      ["cancelled", "INTEGER NOT NULL DEFAULT 0"],
      ["cancel_reason", "TEXT NOT NULL DEFAULT ''"],
      ["cancelled_at", "TEXT"],
    ])
      if (!columns("bookings").includes(name))
        db.exec(`ALTER TABLE bookings ADD COLUMN ${name} ${type}`);
    db.exec(
      "DROP TRIGGER IF EXISTS booking_overlap_insert; DROP TRIGGER IF EXISTS booking_overlap_update; DROP TRIGGER IF EXISTS closure_overlap_insert; DROP TRIGGER IF EXISTS closure_overlap_update;",
    );
    if (!columns("audit").includes("details"))
      db.exec(
        "ALTER TABLE audit ADD COLUMN details TEXT NOT NULL DEFAULT '{}'",
      );
    if (!columns("users").includes("is_super")) {
      db.exec(
        "ALTER TABLE users ADD COLUMN is_super INTEGER NOT NULL DEFAULT 0",
      );
      db.exec("UPDATE users SET is_super=1 WHERE role='admin'");
    }
    for (const table of ["users", "bookings", "notices"])
      if (!columns(table).includes("version"))
        db.exec(
          `ALTER TABLE ${table} ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
        );
    for (const [name, type] of [
      ["id", "TEXT NOT NULL DEFAULT ''"],
      ["created", "INTEGER NOT NULL DEFAULT 0"],
      ["agent", "TEXT NOT NULL DEFAULT ''"],
    ])
      if (!columns("sessions").includes(name))
        db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${type}`);
    db.exec("UPDATE sessions SET id=lower(hex(randomblob(16))) WHERE id=''");
    db.exec(`
      CREATE INDEX IF NOT EXISTS closures_dates ON closures(slot,start,end);
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id,expires);
      CREATE UNIQUE INDEX IF NOT EXISTS session_public_id ON sessions(id);
      CREATE TABLE IF NOT EXISTS user_permissions (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        permission TEXT NOT NULL, PRIMARY KEY(user_id,permission)
      );
      CREATE TABLE IF NOT EXISTS idempotency (
        user_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL,
        request_hash TEXT NOT NULL, response TEXT NOT NULL, created INTEGER NOT NULL,
        PRIMARY KEY(user_id,key)
      );
      CREATE TRIGGER IF NOT EXISTS booking_overlap_insert BEFORE INSERT ON bookings
      WHEN NEW.status='已通过' AND NEW.cancelled=0 BEGIN
        SELECT CASE WHEN EXISTS(SELECT 1 FROM bookings WHERE slot=NEW.slot AND status='已通过' AND cancelled=0 AND start<=NEW.end AND end>=NEW.start)
          OR EXISTS(SELECT 1 FROM closures WHERE slot=NEW.slot AND start<=NEW.end AND end>=NEW.start)
          THEN RAISE(ABORT,'SLOT_CONFLICT') END;
      END;
      CREATE TRIGGER IF NOT EXISTS booking_overlap_update BEFORE UPDATE OF status,slot,start,end ON bookings
      WHEN NEW.status='已通过' AND NEW.cancelled=0 BEGIN
        SELECT CASE WHEN EXISTS(SELECT 1 FROM bookings WHERE id<>NEW.id AND slot=NEW.slot AND status='已通过' AND cancelled=0 AND start<=NEW.end AND end>=NEW.start)
          OR EXISTS(SELECT 1 FROM closures WHERE slot=NEW.slot AND start<=NEW.end AND end>=NEW.start)
          THEN RAISE(ABORT,'SLOT_CONFLICT') END;
      END;
      CREATE TRIGGER IF NOT EXISTS closure_overlap_insert BEFORE INSERT ON closures BEGIN
        SELECT CASE WHEN EXISTS(SELECT 1 FROM bookings WHERE slot=NEW.slot AND status='已通过' AND cancelled=0 AND start<=NEW.end AND end>=NEW.start)
          OR EXISTS(SELECT 1 FROM closures WHERE slot=NEW.slot AND start<=NEW.end AND end>=NEW.start)
          THEN RAISE(ABORT,'SLOT_CONFLICT') END;
      END;
      CREATE TRIGGER IF NOT EXISTS closure_overlap_update BEFORE UPDATE ON closures BEGIN
        SELECT CASE WHEN EXISTS(SELECT 1 FROM bookings WHERE slot=NEW.slot AND status='已通过' AND cancelled=0 AND start<=NEW.end AND end>=NEW.start)
          OR EXISTS(SELECT 1 FROM closures WHERE id<>NEW.id AND slot=NEW.slot AND start<=NEW.end AND end>=NEW.start)
          THEN RAISE(ABORT,'SLOT_CONFLICT') END;
      END;
      CREATE TRIGGER IF NOT EXISTS booking_duplicate_pending BEFORE INSERT ON bookings
      WHEN NEW.status='待审核' BEGIN
        SELECT CASE WHEN EXISTS(SELECT 1 FROM bookings WHERE user_id=NEW.user_id AND slot=NEW.slot AND status='待审核' AND start<=NEW.end AND end>=NEW.start)
          THEN RAISE(ABORT,'DUPLICATE_PENDING') END;
      END;
      CREATE TRIGGER IF NOT EXISTS booking_state_transition BEFORE UPDATE OF status ON bookings
      WHEN NEW.status<>OLD.status AND (OLD.status<>'待审核' OR NEW.status NOT IN ('已通过','未通过','已撤回'))
      BEGIN SELECT RAISE(ABORT,'INVALID_BOOKING_STATE'); END;
      CREATE TRIGGER IF NOT EXISTS booking_immutable_details BEFORE UPDATE OF user_id,slot,start,end ON bookings
      WHEN NEW.user_id<>OLD.user_id OR NEW.slot<>OLD.slot OR NEW.start<>OLD.start OR NEW.end<>OLD.end
      BEGIN SELECT RAISE(ABORT,'IMMUTABLE_BOOKING'); END;
      CREATE TRIGGER IF NOT EXISTS booking_valid_range BEFORE INSERT ON bookings
      WHEN length(NEW.start)<>10 OR length(NEW.end)<>10 OR date(NEW.start) IS NULL OR date(NEW.end) IS NULL
        OR date(NEW.start)<>NEW.start OR date(NEW.end)<>NEW.end OR NEW.end<NEW.start OR julianday(NEW.end)-julianday(NEW.start)>2
      BEGIN SELECT RAISE(ABORT,'INVALID_DATE_RANGE'); END;
      CREATE TRIGGER IF NOT EXISTS closure_valid_range BEFORE INSERT ON closures
      WHEN length(NEW.start)<>10 OR length(NEW.end)<>10 OR date(NEW.start) IS NULL OR date(NEW.end) IS NULL
        OR date(NEW.start)<>NEW.start OR date(NEW.end)<>NEW.end OR NEW.end<NEW.start
      BEGIN SELECT RAISE(ABORT,'INVALID_DATE_RANGE'); END;
      CREATE TRIGGER IF NOT EXISTS booking_cancel_update BEFORE UPDATE OF cancelled ON bookings
      WHEN (OLD.cancelled=1 AND NEW.cancelled<>1) OR (NEW.cancelled=1 AND NEW.status<>'已通过') OR NEW.cancelled NOT IN (0,1)
      BEGIN SELECT RAISE(ABORT,'INVALID_BOOKING_STATE'); END;
      CREATE TRIGGER IF NOT EXISTS booking_cancel_insert BEFORE INSERT ON bookings
      WHEN NEW.cancelled NOT IN (0,1) OR (NEW.cancelled=1 AND NEW.status<>'已通过')
      BEGIN SELECT RAISE(ABORT,'INVALID_BOOKING_STATE'); END;
      PRAGMA user_version=3;
    `);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    db.close();
    throw e;
  }
  return db;
}
