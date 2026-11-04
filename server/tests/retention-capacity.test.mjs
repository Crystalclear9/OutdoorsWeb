import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  capacityPolicy,
  retentionPolicy,
  measureCapacity,
  retainHistory,
} from "../retention.mjs";

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`CREATE TABLE bookings(id TEXT PRIMARY KEY,end TEXT);
    CREATE TABLE archives(id TEXT PRIMARY KEY,kind TEXT,created TEXT,content BLOB);
    CREATE TABLE delivery_jobs(id TEXT PRIMARY KEY,state TEXT,created TEXT,delivered TEXT,payload TEXT);
    CREATE TABLE notifications(id TEXT PRIMARY KEY,read_at TEXT,created TEXT,target TEXT);
    CREATE TABLE audit(actor TEXT,action TEXT,target TEXT,created TEXT,details TEXT);
    INSERT INTO bookings VALUES('historical','2020-01-01'),('live','2099-01-01');
    INSERT INTO archives VALUES('image-historical','image','2020-01-01',X'010203'),('image-orphan','image','2020-01-01',X'040506'),('audit-old','audit','2020-01-01',X'070809');
    INSERT INTO notifications VALUES('old',NULL,'2020-01-01',''),('live',NULL,'2020-01-01','live'),('read','2020-01-02','2020-01-01','');`);
  const insert = db.prepare("INSERT INTO delivery_jobs VALUES(?,?,?,?,?)");
  for (const state of [
    "accepted",
    "cancelled",
    "failed",
    "uncertain",
    "pending",
    "sending",
  ])
    insert.run(
      state,
      state,
      "2020-01-01",
      "2020-01-01",
      JSON.stringify({ bookingId: "historical" }),
    );
  insert.run(
    "active",
    "accepted",
    "2020-01-01",
    "2020-01-01",
    JSON.stringify({ bookingId: "live" }),
  );
  insert.run("recently-accepted", "accepted", "2020-01-01", "2099-01-01", "{}");
  const policy = {
    enabled: true,
    batchSize: 200,
    archiveDays: 30,
    deliveryDays: 30,
    unreadNotificationDays: 30,
  };
  return { db, policy };
}

test("历史清理默认关闭，保留天数须显式指定且至少30天", () => {
  const defaults = retentionPolicy({});
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.archiveDays, 0);
  assert.equal(defaults.deliveryDays, 0);
  assert.equal(defaults.unreadNotificationDays, 0);
  assert.throws(
    () => retentionPolicy({ DELIVERY_RETENTION_DAYS: "1" }),
    /至少30天/,
  );
  assert.throws(
    () => retentionPolicy({ HISTORY_RETENTION_ENABLED: "yes" }),
    /开关/,
  );
  assert.throws(() => capacityPolicy({ BACKUP_WARNING_MB: "-1" }), /阈值/);
});

test("预览及无可恢复快照时不删除；显式启用后保护审计、图片引用及未解决投递", (t) => {
  const { db, policy } = fixture(t);
  const noBackup = retainHistory(db, policy);
  assert.equal(noBackup.preview, true);
  assert.deepEqual(noBackup.eligible, {
    archives: 1,
    delivery_jobs: 2,
    notifications: 1,
  });
  assert.deepEqual(noBackup.removed, {
    archives: 0,
    delivery_jobs: 0,
    notifications: 0,
  });
  const disabled = retainHistory(
    db,
    { ...policy, enabled: false },
    { backupVerified: true },
  );
  assert.equal(disabled.preview, true);
  const result = retainHistory(db, policy, { backupVerified: true });
  assert.equal(result.preview, false);
  assert.deepEqual(result.removed, {
    archives: 1,
    delivery_jobs: 2,
    notifications: 1,
  });
  assert.equal(result.protectedAuditArchives, 1);
  assert.equal(result.protectedImageArchives, 1);
  assert.deepEqual(
    db
      .prepare("SELECT id FROM archives ORDER BY id")
      .all()
      .map((r) => r.id),
    ["audit-old", "image-historical"],
  );
  assert.equal(
    Buffer.from(
      db.prepare("SELECT content FROM archives WHERE id='audit-old'").get()
        .content,
    ).toString("hex"),
    "070809",
  );
  assert.deepEqual(
    db
      .prepare("SELECT id FROM delivery_jobs ORDER BY id")
      .all()
      .map((r) => r.id),
    [
      "active",
      "failed",
      "pending",
      "recently-accepted",
      "sending",
      "uncertain",
    ],
  );
  assert.deepEqual(
    db
      .prepare("SELECT id FROM notifications ORDER BY id")
      .all()
      .map((r) => r.id),
    ["live", "read"],
  );
  assert.equal(
    db.prepare("SELECT action FROM audit").get().action,
    "history.retention",
  );
  const evidence = JSON.parse(
    db.prepare("SELECT details FROM audit").get().details,
  );
  assert.deepEqual(evidence.delivery.map((r) => r.id).sort(), [
    "accepted",
    "cancelled",
  ]);
  assert.equal(evidence.delivery[0].payloadSha256.length, 64);
});

test("清理每轮按批量推进，未配置的分类不清理", (t) => {
  const { db, policy } = fixture(t);
  for (let i = 0; i < 5; i++)
    db.prepare("INSERT INTO archives VALUES(?,'image','2020-01-01',X'01')").run(
      `image-extra-${i}`,
    );
  const bounded = {
    ...policy,
    batchSize: 2,
    deliveryDays: 0,
    unreadNotificationDays: 0,
  };
  const first = retainHistory(db, bounded, { backupVerified: true });
  assert.equal(first.eligible.archives, 2);
  assert.equal(first.removed.archives, 2);
  assert.equal(first.removed.delivery_jobs, 0);
  assert.equal(
    retainHistory(db, bounded, { backupVerified: true }).removed.archives,
    2,
  );
  assert.equal(
    retainHistory(db, bounded, { backupVerified: true }).removed.archives,
    2,
  );
  assert.equal(
    retainHistory(db, bounded, { backupVerified: true }).removed.archives,
    0,
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM archives").get().n, 2);
});

test("图片归档保护及候选筛选按预约主键查找，并保持前缀和Unicode引用语义", (t) => {
  const { db, policy } = fixture(t);
  db.prepare("INSERT INTO bookings VALUES('企业-甲','2020-01-01')").run();
  db.prepare(
    "INSERT INTO archives VALUES('image-企业-甲','image','2020-01-01',X'0102')",
  ).run();
  // This suffix matches a real booking, but its prefix is not an image link.
  db.prepare(
    "INSERT INTO archives VALUES('wrong-historical','image','2020-01-01',X'0304')",
  ).run();
  const observed = [];
  const wrapped = new Proxy(db, {
    get(target, key) {
      if (key === "prepare")
        return (sql) => {
          if (sql.includes("FROM archives a")) observed.push(sql);
          return target.prepare(sql);
        };
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const preview = retainHistory(wrapped, { ...policy, enabled: false });
  assert.equal(preview.protectedImageArchives, 2);
  assert.equal(preview.eligible.archives, 2);
  assert.equal(observed.length, 2);
  for (const sql of observed) {
    const plan = db
      .prepare("EXPLAIN QUERY PLAN " + sql)
      .all(
        ...(sql.includes("LIMIT ?")
          ? [new Date().toISOString(), policy.batchSize]
          : []),
      );
    assert.ok(
      plan.some((row) =>
        /SEARCH b USING (?:COVERING )?INDEX .*\(id=\?\)/.test(row.detail),
      ),
      JSON.stringify(plan),
    );
    assert.equal(
      plan.some((row) => /SCAN b\b/.test(row.detail)),
      false,
      "每个图片引用不应全表扫描预约",
    );
  }
  const cleaned = retainHistory(db, policy, { backupVerified: true });
  assert.equal(cleaned.removed.archives, 2);
  assert.deepEqual(
    db
      .prepare("SELECT id FROM archives ORDER BY id")
      .all()
      .map((row) => row.id),
    ["audit-old", "image-historical", "image-企业-甲"],
  );
});

test("容量包含WAL和手动及嵌套备份，只统计不删除且不跟随目录链接", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "outdoors-capacity-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, "app.sqlite"),
    backupDir = path.join(dir, "backups");
  await mkdir(path.join(backupDir, "manual"), { recursive: true });
  for (const [name, size] of [
    [dbPath, 10],
    [dbPath + "-wal", 20],
    [dbPath + "-shm", 30],
    [path.join(backupDir, "auto.sqlite"), 40],
    [path.join(backupDir, "manual", "safety.sqlite"), 50],
  ])
    await writeFile(name, Buffer.alloc(size));
  const outside = path.join(dir, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "secret"), Buffer.alloc(1000));
  try {
    await symlink(outside, path.join(backupDir, "linked"), "junction");
  } catch (error) {
    if (!["EPERM", "EACCES"].includes(error.code)) throw error;
  }
  const result = await measureCapacity(dbPath, backupDir, {
    databaseWarningBytes: 60,
    backupWarningBytes: 80,
  });
  assert.equal(result.databaseBytes, 60);
  assert.equal(result.backupBytes, 90);
  assert.equal(result.backupFiles, 2);
  assert.equal(result.databaseExceeded, true);
  assert.equal(result.backupExceeded, true);
  assert.equal(result.scanError, null);
  assert.equal(
    (
      await measureCapacity(dbPath, path.join(dir, "missing"), {
        databaseWarningBytes: 0,
        backupWarningBytes: 0,
      })
    ).backupExceeded,
    false,
  );
});
