import { DatabaseSync } from "node:sqlite";
import {
  mkdir,
  readdir,
  unlink,
  statfs,
  link,
  lstat,
  stat,
  writeFile,
  chmod,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { today as businessDay } from "./core.mjs";
import { archiveHistory } from "./business.mjs";
import { overdueCases } from "./casework.mjs";
import { offsiteConfigured, uploadOffsite } from "./offsite.mjs";
import { alertExternal } from "./delivery.mjs";
import { backupMfaKey, backupKeyFile, verifyMfaKey } from "./backup-key.mjs";

const config = JSON.parse(process.argv[2]),
  db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
const save = (key, value) =>
  db
    .prepare(
      "INSERT INTO maintenance_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run(key, JSON.stringify(value));
let partial, partialKey, publishedKey;

// Only names produced by the automatic backup writer (including legacy names
// without a UUID) are eligible. Complete snapshots and unknown files stay put.
const automaticPartial =
  /^auto-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?:-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})?\.sqlite(?:\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.encrypted)?\.part(?:\.mfa-key)?$/;
async function cleanupBackupParts(cutoff) {
  const directory = path.resolve(config.backupDir);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !automaticPartial.test(entry.name)) continue;
    const file = path.resolve(directory, entry.name);
    if (path.dirname(file) !== directory) continue;
    try {
      const original = await lstat(file);
      if (!original.isFile() || original.mtimeMs >= cutoff) continue;
      // Recheck both ownership and age immediately before removal. A replaced
      // file, refreshed writer, directory or symlink must not be cleaned up.
      const current = await lstat(file);
      if (
        !current.isFile() ||
        current.dev !== original.dev ||
        current.ino !== original.ino ||
        current.size !== original.size ||
        current.mtimeMs !== original.mtimeMs ||
        current.mtimeMs >= cutoff
      )
        continue;
      await unlink(file);
      removed++;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return removed;
}

try {
  const at = Date.now(),
    day = 86400000,
    removed = {};
  // Reclaim interrupted snapshots even when backups are disabled/not due, and
  // before checking whether there is enough space to create the next snapshot.
  removed.staleBackupParts = await cleanupBackupParts(at - day);
  db.exec("BEGIN IMMEDIATE");
  try {
    removed.captchas = db
      .prepare("DELETE FROM captchas WHERE expires<?")
      .run(at).changes;
    removed.sessions = db
      .prepare("DELETE FROM sessions WHERE expires<?")
      .run(at).changes;
    removed.rateLimits = db
      .prepare("DELETE FROM rate_limits WHERE reset<?")
      .run(at - day).changes;
    removed.idempotency = db
      .prepare("DELETE FROM idempotency WHERE created<?")
      .run(at - 7 * day).changes;
    removed.readNotifications = db
      .prepare(
        "DELETE FROM notifications WHERE read_at IS NOT NULL AND created<?",
      )
      .run(new Date(at - 180 * day).toISOString()).changes;
    const today = businessDay(),
      reminder = JSON.parse(
        db
          .prepare("SELECT value FROM maintenance_state WHERE key='reminder'")
          .get()?.value || "null",
      );
    if (reminder !== today) {
      const count = overdueCases(db, at);
      if (count) {
        const reviewers = db
          .prepare(
            "SELECT id FROM users WHERE role='admin' AND disabled=0 AND (is_super=1 OR EXISTS(SELECT 1 FROM user_permissions p WHERE p.user_id=users.id AND permission='bookings.review'))",
          )
          .all();
        for (const user of reviewers)
          db.prepare(
            "INSERT INTO notifications(id,user_id,title,content,target,created) VALUES(?,?,?,?,?,?)",
          ).run(
            randomUUID(),
            user.id,
            "超时待办提醒",
            `${count} 条申请已超过一个工作日且未登记结果电话告知，请进入工作台的办理跟进处理。`,
            "",
            new Date(at).toISOString(),
          );
      }
      if (count) save("reminder", today);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  let last = null;
  const archived = archiveHistory(
    db,
    Number(process.env.ARCHIVE_AFTER_DAYS || 365),
  );
  const freePagesBefore = db
    .prepare("PRAGMA freelist_count")
    .get().freelist_count;
  if (
    db.prepare("PRAGMA auto_vacuum").get().auto_vacuum === 2 &&
    freePagesBefore > 0
  )
    db.exec("PRAGMA incremental_vacuum(1024);");
  const reclaimedPages = Math.max(
    0,
    freePagesBefore - db.prepare("PRAGMA freelist_count").get().freelist_count,
  );
  db.prepare("DELETE FROM auth_challenges WHERE expires<?").run(at);
  db.prepare("DELETE FROM oauth_states WHERE expires<?").run(at);
  db.prepare("DELETE FROM sms_codes WHERE expires<?").run(at);
  db.prepare("DELETE FROM signup_proofs WHERE expires<?").run(at);
  try {
    last = JSON.parse(
      db.prepare("SELECT value FROM maintenance_state WHERE key='backup'").get()
        ?.value || "null",
    );
  } catch {}
  let lastAvailable = false;
  if (last?.file) {
    const file = path.resolve(config.backupDir, last.file);
    if (path.dirname(file) === path.resolve(config.backupDir))
      lastAvailable = await stat(file)
        .then(async (s) => {
          if (!s.isFile() || s.size < 100) return false;
          const key = backupKeyFile(file + ".mfa-key");
          const check = new DatabaseSync(file, { readOnly: true });
          try {
            if (check.prepare("PRAGMA quick_check").get().quick_check !== "ok")
              return false;
            verifyMfaKey(check, key);
            return true;
          } finally {
            check.close();
          }
        })
        .catch(() => false);
  }
  let backup = last;
  if (
    config.force ||
    (config.backupHours > 0 &&
      (!last ||
        !lastAvailable ||
        !Number.isFinite(Date.parse(last.at)) ||
        at - Date.parse(last.at) >= config.backupHours * 3600000))
  ) {
    await mkdir(config.backupDir, { recursive: true, mode: 0o700 });
    const space = await statfs(config.backupDir),
      available = Number(space.bavail) * Number(space.bsize),
      estimated =
        db.prepare("PRAGMA page_count").get().page_count *
        db.prepare("PRAGMA page_size").get().page_size;
    if (available < estimated * 1.1 + 1048576 + (config.reserveBytes || 0))
      throw new Error("备份目录空间不足，已停止复制，请先扩容或转移备份");
    const file =
        "auto-" +
        new Date().toISOString().replace(/[:.]/g, "-") +
        `-${randomUUID()}.sqlite`,
      target = path.resolve(config.backupDir, file);
    if (path.dirname(target) !== path.resolve(config.backupDir))
      throw new Error("备份目录无效");
    const mfaKey = backupMfaKey(config.dbPath);
    partial = target + ".part";
    db.exec(`VACUUM INTO '${partial.replaceAll("'", "''")}'`);
    await chmod(partial, 0o600);
    const verify = new DatabaseSync(partial, { readOnly: true });
    try {
      if (verify.prepare("PRAGMA quick_check").get().quick_check !== "ok")
        throw new Error("备份完整性检查失败");
      verifyMfaKey(verify, mfaKey);
    } finally {
      verify.close();
    }
    // Prepare both parts before publishing either. Hard links never overwrite
    // targets created by another process while VACUUM was running.
    partialKey = partial + ".mfa-key";
    await writeFile(partialKey, mfaKey, { flag: "wx", mode: 0o600 });
    const keyIdentity = await lstat(partialKey);
    await link(partialKey, target + ".mfa-key");
    publishedKey = { file: target + ".mfa-key", identity: keyIdentity };
    await link(partial, target);
    // A complete pair is useful even if a later status/rotation write fails.
    publishedKey = null;
    await unlink(partialKey);
    partialKey = null;
    await unlink(partial);
    partial = null;
    backup = { at: new Date().toISOString(), file };
    save("backup", backup);
    const candidates = (
      await readdir(config.backupDir, { withFileTypes: true })
    )
      .filter((f) => f.isFile() && /^auto-\d{4}-.*\.sqlite$/.test(f.name))
      .map((f) => f.name)
      .sort()
      .reverse();
    const files = [];
    for (const name of candidates) {
      try {
        const target = path.resolve(config.backupDir, name),
          database = await lstat(target),
          key = await lstat(target + ".mfa-key");
        if (
          database.isFile() &&
          database.size >= 100 &&
          key.isFile() &&
          key.size === 32
        )
          files.push({ name, database, key });
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    // Verify enough newest pairs before deleting anything. Known corrupt or
    // orphaned snapshots remain available for an operator to investigate.
    let verified = 0,
      keepThrough = -1;
    for (let i = 0; i < files.length && verified < config.keep; i++) {
      keepThrough = i;
      let check;
      try {
        check = new DatabaseSync(
          path.resolve(config.backupDir, files[i].name),
          { readOnly: true },
        );
        if (check.prepare("PRAGMA quick_check").get().quick_check !== "ok")
          throw new Error("备份完整性检查失败");
        verifyMfaKey(
          check,
          backupKeyFile(
            path.resolve(config.backupDir, files[i].name) + ".mfa-key",
          ),
        );
        verified++;
      } catch {
        console.error(
          JSON.stringify({ event: "backup.invalid", file: files[i].name }),
        );
      } finally {
        check?.close();
      }
    }
    for (const { name, database, key } of verified >= config.keep
      ? files.slice(keepThrough + 1)
      : []) {
      const target = path.resolve(config.backupDir, name);
      if (path.dirname(target) === path.resolve(config.backupDir)) {
        const current = await lstat(target),
          currentKey = await lstat(target + ".mfa-key");
        if (
          current.dev !== database.dev ||
          current.ino !== database.ino ||
          currentKey.dev !== key.dev ||
          currentKey.ino !== key.ino
        )
          continue;
        await unlink(target);
        const remainingKey = await lstat(target + ".mfa-key").catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
        if (remainingKey?.dev === key.dev && remainingKey.ino === key.ino)
          await unlink(target + ".mfa-key");
      }
    }
  }
  if (offsiteConfigured() && backup?.file) {
    const old = JSON.parse(
      db
        .prepare("SELECT value FROM maintenance_state WHERE key='offsite'")
        .get()?.value || "null",
    );
    if (!old?.verified || old.file !== backup.file) {
      try {
        save("offsite", {
          ...(await uploadOffsite(
            path.resolve(config.backupDir, backup.file),
            config.dbPath,
          )),
          file: backup.file,
        });
      } catch (e) {
        save("offsite", {
          at: new Date().toISOString(),
          verified: false,
          error: e.message,
        });
        throw e;
      }
    }
  }
  const disk = await statfs(path.dirname(config.dbPath)),
    freeBytes = Number(disk.bavail) * Number(disk.bsize);
  const result = {
    ok: true,
    at: new Date().toISOString(),
    removed,
    archived,
    reclaimedPages,
    backup,
    freeBytes,
  };
  save("maintenance", result);
  process.send?.(result);
} catch (e) {
  if (partial) await unlink(partial).catch(() => {});
  if (partialKey) await unlink(partialKey).catch(() => {});
  if (publishedKey) {
    try {
      const current = await lstat(publishedKey.file);
      if (
        current.dev === publishedKey.identity.dev &&
        current.ino === publishedKey.identity.ino
      )
        await unlink(publishedKey.file);
    } catch {}
  }
  const result = {
    ok: false,
    at: new Date().toISOString(),
    error: String(e.message),
  };
  try {
    save("maintenance", result);
    await alertExternal(
      db,
      "maintenance.failed",
      "维护、备份或异机复制失败，请检查运行与维护页面",
    );
  } catch {}
  process.send?.(result);
  process.exitCode = 1;
} finally {
  db.close();
}
