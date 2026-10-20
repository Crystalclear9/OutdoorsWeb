import { DatabaseSync } from "node:sqlite";
import {
  mkdir,
  readdir,
  unlink,
  statfs,
  rename,
  stat,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { today as businessDay } from "./core.mjs";
import { archiveHistory } from "./business.mjs";
import { offsiteConfigured, uploadOffsite } from "./offsite.mjs";
import { alertExternal } from "./delivery.mjs";

const config = JSON.parse(process.argv[2]),
  db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
const save = (key, value) =>
  db
    .prepare(
      "INSERT INTO maintenance_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run(key, JSON.stringify(value));
let partial;
try {
  const at = Date.now(),
    day = 86400000,
    removed = {};
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
      const count = db
        .prepare(
          "SELECT COUNT(*) AS n FROM bookings WHERE status='待审核' AND created<?",
        )
        .get(new Date(at - day).toISOString()).n;
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
            `${count} 条申请已等待超过 24 小时，请进入审批台处理。`,
            "",
            new Date(at).toISOString(),
          );
      }
      save("reminder", today);
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
  db.prepare("DELETE FROM auth_challenges WHERE expires<?").run(at);
  db.prepare("DELETE FROM oauth_states WHERE expires<?").run(at);
  db.prepare("DELETE FROM sms_codes WHERE expires<?").run(at);
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
        .then(
          async (s) =>
            s.isFile() &&
            s.size >= 100 &&
            (await stat(file + ".mfa-key")).size === 32,
        )
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
        "auto-" + new Date().toISOString().replace(/[:.]/g, "-") + ".sqlite",
      target = path.resolve(config.backupDir, file);
    if (path.dirname(target) !== path.resolve(config.backupDir))
      throw new Error("备份目录无效");
    partial = target + ".part";
    db.exec(`VACUUM INTO '${partial.replaceAll("'", "''")}'`);
    const verify = new DatabaseSync(partial, { readOnly: true });
    try {
      if (verify.prepare("PRAGMA quick_check").get().quick_check !== "ok")
        throw new Error("备份完整性检查失败");
    } finally {
      verify.close();
    }
    await rename(partial, target);
    partial = null;
    const mfaKey = process.env.APP_ENCRYPTION_KEY
      ? Buffer.from(process.env.APP_ENCRYPTION_KEY, "hex")
      : await readFile(path.join(path.dirname(config.dbPath), ".mfa-key"));
    await writeFile(target + ".mfa-key", mfaKey, { flag: "wx", mode: 0o600 });
    backup = { at: new Date().toISOString(), file };
    save("backup", backup);
    const files = (await readdir(config.backupDir, { withFileTypes: true }))
      .filter((f) => f.isFile() && /^auto-\d{4}-.*\.sqlite$/.test(f.name))
      .map((f) => f.name)
      .sort()
      .reverse();
    for (const name of files.slice(config.keep)) {
      const target = path.resolve(config.backupDir, name);
      if (path.dirname(target) === path.resolve(config.backupDir)) {
        await unlink(target);
        await unlink(target + ".mfa-key").catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
      }
    }
    for (const entry of await readdir(config.backupDir, {
      withFileTypes: true,
    }))
      if (
        entry.isFile() &&
        /^auto-\d{4}-.*\.sqlite(?:\.[a-f0-9-]+\.encrypted)?\.part$/.test(
          entry.name,
        )
      ) {
        const target = path.resolve(config.backupDir, entry.name);
        if (
          path.dirname(target) === path.resolve(config.backupDir) &&
          (await stat(target)).mtimeMs < at - day
        )
          await unlink(target);
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
    backup,
    freeBytes,
  };
  save("maintenance", result);
  process.send?.(result);
} catch (e) {
  if (partial) await unlink(partial).catch(() => {});
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
