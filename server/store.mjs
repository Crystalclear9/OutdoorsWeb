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
  if (db.prepare("PRAGMA user_version").get().user_version > 8) {
    db.close();
    throw new Error("数据库版本高于当前程序，请使用匹配版本，禁止直接降级");
  }
  if (
    !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' LIMIT 1").get()
  )
    db.exec("PRAGMA auto_vacuum=INCREMENTAL;");
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
      ["reschedule_of", "TEXT REFERENCES bookings(id)"],
      ["cancelled", "INTEGER NOT NULL DEFAULT 0"],
      ["cancel_reason", "TEXT NOT NULL DEFAULT ''"],
      ["cancelled_at", "TEXT"],
      [
        "content_only",
        "INTEGER NOT NULL DEFAULT 0 CHECK(content_only IN (0,1))",
      ],
      ["builder_contact", "TEXT NOT NULL DEFAULT ''"],
      ["builder_phone", "TEXT NOT NULL DEFAULT ''"],
    ])
      if (!columns("bookings").includes(name))
        db.exec(`ALTER TABLE bookings ADD COLUMN ${name} ${type}`);
    db.exec(
      "DROP TRIGGER IF EXISTS booking_overlap_insert; DROP TRIGGER IF EXISTS booking_overlap_update; DROP TRIGGER IF EXISTS closure_overlap_insert; DROP TRIGGER IF EXISTS closure_overlap_update; DROP TRIGGER IF EXISTS booking_duplicate_pending; DROP TRIGGER IF EXISTS booking_immutable_details; DROP TRIGGER IF EXISTS booking_content_fields;",
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
      CREATE INDEX IF NOT EXISTS bookings_created ON bookings(created,id);
      CREATE INDEX IF NOT EXISTS bookings_status_created ON bookings(status,cancelled,created,id);
      CREATE INDEX IF NOT EXISTS bookings_reviewer_created ON bookings(reviewer,created,id);
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
      DROP INDEX IF EXISTS pending_reschedule;
      CREATE TRIGGER IF NOT EXISTS pending_reschedule_insert BEFORE INSERT ON bookings
      WHEN NEW.reschedule_of IS NOT NULL AND NEW.status='待审核' BEGIN
        SELECT CASE WHEN EXISTS(SELECT 1 FROM bookings WHERE reschedule_of=NEW.reschedule_of AND status='待审核' AND start>=date('now','+8 hours'))
          THEN RAISE(ABORT,'DUPLICATE_PENDING') END;
      END;
      CREATE TABLE IF NOT EXISTS onsite(date TEXT NOT NULL,slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 29),present INTEGER NOT NULL CHECK(present IN (0,1)),note TEXT NOT NULL,actor TEXT NOT NULL REFERENCES users(id),updated TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(date,slot));
      CREATE TABLE IF NOT EXISTS mfa(user_id TEXT PRIMARY KEY REFERENCES users(id),secret TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,last_counter INTEGER NOT NULL DEFAULT -1,recovery TEXT NOT NULL DEFAULT '[]');
      CREATE TABLE IF NOT EXISTS auth_challenges(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,payload TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS external_identities(provider TEXT NOT NULL,subject TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(provider,subject));
      CREATE UNIQUE INDEX IF NOT EXISTS identity_per_user ON external_identities(provider,user_id);
      CREATE TABLE IF NOT EXISTS oauth_states(id TEXT PRIMARY KEY,provider TEXT NOT NULL,user_id TEXT REFERENCES users(id),binding TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sms_codes(id TEXT PRIMARY KEY,phone TEXT NOT NULL,binding TEXT NOT NULL,answer TEXT NOT NULL,purpose TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS verified_phones(phone TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS signup_proofs(id TEXT PRIMARY KEY,provider TEXT NOT NULL,subject TEXT NOT NULL,binding TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS contact_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id),sms INTEGER NOT NULL DEFAULT 0,voice INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS delivery_jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,last_error TEXT NOT NULL DEFAULT '',created TEXT NOT NULL,delivered TEXT);
      CREATE INDEX IF NOT EXISTS delivery_due ON delivery_jobs(state,next_at);
      CREATE TABLE IF NOT EXISTS archives(id TEXT PRIMARY KEY,kind TEXT NOT NULL,created TEXT NOT NULL,cutoff TEXT NOT NULL,records INTEGER NOT NULL,bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,content BLOB NOT NULL);
      CREATE TRIGGER IF NOT EXISTS booking_overlap_insert BEFORE INSERT ON bookings
      WHEN NEW.status='已通过' AND NEW.cancelled=0 AND NEW.content_only=0 BEGIN
        SELECT CASE WHEN EXISTS(SELECT 1 FROM bookings WHERE content_only=0 AND slot=NEW.slot AND status='已通过' AND cancelled=0 AND start<=NEW.end AND end>=NEW.start)
          OR EXISTS(SELECT 1 FROM closures WHERE slot=NEW.slot AND start<=NEW.end AND end>=NEW.start)
          THEN RAISE(ABORT,'SLOT_CONFLICT') END;
      END;
      CREATE TRIGGER IF NOT EXISTS booking_overlap_update BEFORE UPDATE OF status,slot,start,end ON bookings
      WHEN NEW.status='已通过' AND NEW.cancelled=0 AND NEW.content_only=0 BEGIN
        SELECT CASE WHEN EXISTS(SELECT 1 FROM bookings WHERE content_only=0 AND id<>NEW.id AND slot=NEW.slot AND status='已通过' AND cancelled=0 AND start<=NEW.end AND end>=NEW.start)
          OR EXISTS(SELECT 1 FROM closures WHERE slot=NEW.slot AND start<=NEW.end AND end>=NEW.start)
          THEN RAISE(ABORT,'SLOT_CONFLICT') END;
      END;
      CREATE TRIGGER IF NOT EXISTS closure_overlap_insert BEFORE INSERT ON closures BEGIN
        SELECT CASE WHEN EXISTS(SELECT 1 FROM bookings WHERE content_only=0 AND slot=NEW.slot AND status='已通过' AND cancelled=0 AND start<=NEW.end AND end>=NEW.start)
          OR EXISTS(SELECT 1 FROM closures WHERE slot=NEW.slot AND start<=NEW.end AND end>=NEW.start)
          THEN RAISE(ABORT,'SLOT_CONFLICT') END;
      END;
      CREATE TRIGGER IF NOT EXISTS closure_overlap_update BEFORE UPDATE ON closures BEGIN
        SELECT CASE WHEN EXISTS(SELECT 1 FROM bookings WHERE content_only=0 AND slot=NEW.slot AND status='已通过' AND cancelled=0 AND start<=NEW.end AND end>=NEW.start)
          OR EXISTS(SELECT 1 FROM closures WHERE id<>NEW.id AND slot=NEW.slot AND start<=NEW.end AND end>=NEW.start)
          THEN RAISE(ABORT,'SLOT_CONFLICT') END;
      END;
      CREATE TRIGGER IF NOT EXISTS booking_duplicate_pending BEFORE INSERT ON bookings
      WHEN NEW.status='待审核' AND NEW.content_only=0 BEGIN
        SELECT CASE WHEN EXISTS(SELECT 1 FROM bookings WHERE user_id=NEW.user_id AND content_only=0 AND slot=NEW.slot AND status='待审核' AND start<=NEW.end AND end>=NEW.start)
          THEN RAISE(ABORT,'DUPLICATE_PENDING') END;
      END;
      CREATE TRIGGER IF NOT EXISTS booking_state_transition BEFORE UPDATE OF status ON bookings
      WHEN NEW.status<>OLD.status AND (OLD.status<>'待审核' OR NEW.status NOT IN ('已通过','未通过','已撤回'))
      BEGIN SELECT RAISE(ABORT,'INVALID_BOOKING_STATE'); END;
      CREATE TRIGGER IF NOT EXISTS booking_content_fields BEFORE INSERT ON bookings
      WHEN NEW.content_only=1 BEGIN
        SELECT CASE WHEN NEW.slot<>1 OR length(trim(NEW.builder_contact))=0 OR length(NEW.builder_contact)>30
          THEN RAISE(ABORT,'INVALID_BUILDER') END;
        SELECT CASE WHEN NOT EXISTS(
          SELECT 1 FROM (
            SELECT NEW.builder_phone p, instr(NEW.builder_phone,'-') d,
              length(NEW.builder_phone)-length(replace(NEW.builder_phone,'-','')) hyphens
          ) WHERE length(p)<=25 AND p NOT GLOB '*[^0-9-]*' AND (
            (substr(p,1,1)='1' AND length(p)=11 AND hyphens=0)
            OR (substr(p,1,1)='0' AND (
              (hyphens=0 AND length(p) BETWEEN 10 AND 12)
              OR (hyphens=1 AND (
                (d IN (4,5) AND length(p)-d BETWEEN 7 AND 8)
                OR (d BETWEEN 11 AND 13 AND length(p)-d BETWEEN 1 AND 6)
              ))
              OR (hyphens=2 AND d IN (4,5)
                AND instr(substr(p,d+1),'-') BETWEEN 8 AND 9
                AND length(p)-d-instr(substr(p,d+1),'-') BETWEEN 1 AND 6)
            ))
          )
        ) THEN RAISE(ABORT,'INVALID_BUILDER') END;
      END;
      CREATE TRIGGER IF NOT EXISTS booking_immutable_details BEFORE UPDATE OF user_id,slot,start,end,content_only,builder_contact,builder_phone ON bookings
      WHEN NEW.user_id<>OLD.user_id OR NEW.slot<>OLD.slot OR NEW.start<>OLD.start OR NEW.end<>OLD.end OR NEW.content_only<>OLD.content_only OR NEW.builder_contact<>OLD.builder_contact OR NEW.builder_phone<>OLD.builder_phone
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
      CREATE TABLE IF NOT EXISTS work_calendar(date TEXT PRIMARY KEY,working INTEGER NOT NULL CHECK(working IN (0,1)));
      CREATE TABLE IF NOT EXISTS calendar_version(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);
      INSERT OR IGNORE INTO calendar_version VALUES(1,1);
      CREATE TABLE IF NOT EXISTS case_contacts(
        booking_id TEXT PRIMARY KEY REFERENCES bookings(id),state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','unreachable','reached')),
        attempts INTEGER NOT NULL DEFAULT 0,note TEXT NOT NULL DEFAULT '',updated TEXT,reached_at TEXT,version INTEGER NOT NULL DEFAULT 1
      );
      INSERT OR IGNORE INTO case_contacts(booking_id) SELECT id FROM bookings;
      CREATE TRIGGER IF NOT EXISTS case_contact_insert AFTER INSERT ON bookings BEGIN
        INSERT INTO case_contacts(booking_id) VALUES(NEW.id);
      END;
      CREATE TABLE IF NOT EXISTS booking_fees(
        booking_id TEXT PRIMARY KEY REFERENCES bookings(id),amount_fen INTEGER NOT NULL CHECK(typeof(amount_fen)='integer' AND amount_fen BETWEEN 0 AND 100000000),
        state TEXT NOT NULL CHECK(state IN ('due','submitted','paid','waived','void','reconcile','refunded')),
        instructions TEXT NOT NULL,reference TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',
        updated TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TRIGGER IF NOT EXISTS case_fee_cancel AFTER UPDATE OF cancelled ON bookings
      WHEN OLD.cancelled=0 AND NEW.cancelled=1 BEGIN
        UPDATE booking_fees SET state=CASE WHEN state='submitted' THEN 'reconcile' ELSE 'void' END,note='原预约已取消，请停止付款；已提交流水的款项须由财务核实后处理',version=version+1,updated=NEW.cancelled_at
        WHERE booking_id=NEW.id AND state IN ('due','submitted');
      END;
      PRAGMA user_version=8;
    `);
    if (!columns("delivery_jobs").includes("version"))
      db.exec(
        "ALTER TABLE delivery_jobs ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
      );
    if (!columns("sms_codes").includes("user_id"))
      db.exec(
        "ALTER TABLE sms_codes ADD COLUMN user_id TEXT REFERENCES users(id)",
      );
    // Older senders incorrectly retried ambiguous provider responses. Quarantine
    // those durable jobs before either the API or the scheduler can retry them.
    // Human reconciliation replaces last_error, so its decisions are preserved.
    const legacyUncertain = `state IN ('pending','failed') AND (
      last_error GLOB '通信服务拒绝请求（HTTP 5[0-9][0-9]），*'
      OR last_error GLOB '通信服务拒绝请求（HTTP 408），*'
      OR last_error='通信服务未确认受理'
    )`;
    db.prepare(
      `INSERT INTO audit(actor,action,target,created,details)
       SELECT NULL,'delivery.legacy_uncertain',id,?,json_object('previousState',state,'reason',last_error)
       FROM delivery_jobs WHERE ${legacyUncertain}`,
    ).run(new Date().toISOString());
    db.prepare(
      `UPDATE delivery_jobs SET state='uncertain',version=version+1,
       last_error='旧版本受理结果不确定，请先核实服务商记录；'||last_error
       WHERE ${legacyUncertain}`,
    ).run();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    db.close();
    throw e;
  }
  return db;
}
