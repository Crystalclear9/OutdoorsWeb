import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { tx } from "./core.mjs";
import { createHash } from "node:crypto";

const integer = (value, fallback, min, max, name) => {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`${name}配置无效`);
  return n;
};
export function capacityPolicy(env = process.env) {
  return {
    databaseMaxBytes:
      integer(env.DATABASE_MAX_MB, 0, 0, 100000000, "数据库写入上限") * 1048576,
    backupMaxBytes:
      integer(env.BACKUP_MAX_MB, 0, 0, 100000000, "备份目录上限") * 1048576,
    databaseWarningBytes:
      integer(env.DATABASE_WARNING_MB, 2048, 0, 100000000, "数据库容量阈值") *
      1048576,
    backupWarningBytes:
      integer(env.BACKUP_WARNING_MB, 10240, 0, 100000000, "备份容量阈值") *
      1048576,
  };
}
export function retentionPolicy(env = process.env) {
  if (
    env.HISTORY_RETENTION_ENABLED &&
    !["true", "false"].includes(env.HISTORY_RETENTION_ENABLED)
  )
    throw new Error("历史清理开关配置无效");
  const days = (key) => {
    const value = integer(env[key], 0, 0, 36500, key);
    if (value !== 0 && value < 30) throw new Error(`${key}必须为0或至少30天`);
    return value;
  };
  return {
    enabled: env.HISTORY_RETENTION_ENABLED === "true",
    batchSize: integer(
      env.HISTORY_RETENTION_BATCH,
      200,
      1,
      1000,
      "历史清理批量",
    ),
    archiveDays: days("ARCHIVE_RETENTION_DAYS"),
    deliveryDays: days("DELIVERY_RETENTION_DAYS"),
    unreadNotificationDays: days("UNREAD_NOTIFICATION_RETENTION_DAYS"),
  };
}

// Never follow symlinks out of the configured backup tree. Unknown files still
// count towards its capacity; the scanner does not grant permission to delete.
export async function measureCapacity(
  dbPath,
  backupDir,
  policy = capacityPolicy(),
) {
  const result = {
    ...policy,
    databaseBytes: 0,
    backupBytes: 0,
    backupFiles: 0,
    scannedAt: new Date().toISOString(),
    scanError: null,
  };
  try {
    for (const name of [dbPath, dbPath + "-wal", dbPath + "-shm"]) {
      try {
        const s = await lstat(name);
        if (s.isFile()) result.databaseBytes += s.size;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    let visited = 0;
    async function scan(directory) {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
      }
      for (const entry of entries) {
        if (++visited > 100000)
          throw new Error("备份目录超过十万项，容量扫描不完整");
        const file = path.join(directory, entry.name),
          info = await lstat(file);
        if (info.isSymbolicLink()) continue;
        if (info.isDirectory()) await scan(file);
        else if (info.isFile()) {
          result.backupBytes += info.size;
          result.backupFiles++;
        }
      }
    }
    // Do not traverse a symlink supplied as the root either.
    try {
      const root = await lstat(backupDir);
      if (root.isSymbolicLink() || !root.isDirectory())
        throw new Error("备份目录不是普通目录，容量扫描未执行");
      await scan(backupDir);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  } catch (error) {
    result.scanError = error.message;
  }
  result.databaseExceeded =
    !!result.databaseWarningBytes &&
    result.databaseBytes >= result.databaseWarningBytes;
  result.backupExceeded =
    !!result.backupWarningBytes &&
    result.backupBytes >= result.backupWarningBytes;
  return result;
}

export function retainHistory(
  db,
  policy = retentionPolicy(),
  { backupVerified = false, at = Date.now() } = {},
) {
  const result = {
    ...policy,
    at: new Date(at).toISOString(),
    backupVerified,
    preview: !policy.enabled || !backupVerified,
    batchLimited: true,
    eligible: {},
    removed: {},
    protectedAuditArchives: 0,
    protectedImageArchives: 0,
  };
  const evidence = { delivery: [] };
  const cutoff = (days) => new Date(at - days * 86400000).toISOString();
  const queries = {
    archives: policy.archiveDays
      ? [
          "SELECT a.id FROM archives a WHERE a.kind='image' AND a.created<? AND NOT EXISTS(SELECT 1 FROM bookings b WHERE a.id='image-'||b.id) ORDER BY a.created,a.id LIMIT ?",
          cutoff(policy.archiveDays),
          policy.batchSize,
        ]
      : null,
    // Keep unresolved failures/uncertainty, and records for live bookings. No
    // business history or audit evidence is removed by this policy.
    delivery_jobs: policy.deliveryDays
      ? [
          "SELECT d.id FROM delivery_jobs d WHERE d.state IN ('accepted','cancelled') AND d.created<? AND (d.state='cancelled' OR (d.delivered IS NOT NULL AND d.delivered<?)) AND json_valid(d.payload) AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.id=json_extract(d.payload,'$.bookingId') AND b.end>=?) ORDER BY d.created,d.id LIMIT ?",
          cutoff(policy.deliveryDays),
          cutoff(policy.deliveryDays),
          cutoff(policy.deliveryDays).slice(0, 10),
          policy.batchSize,
        ]
      : null,
    notifications: policy.unreadNotificationDays
      ? [
          "SELECT n.id FROM notifications n WHERE n.read_at IS NULL AND n.created<? AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.id=n.target) ORDER BY n.created,n.id LIMIT ?",
          cutoff(policy.unreadNotificationDays),
          policy.batchSize,
        ]
      : null,
  };
  tx(db, () => {
    result.protectedAuditArchives = db
      .prepare("SELECT COUNT(*) n FROM archives WHERE kind='audit'")
      .get().n;
    result.protectedImageArchives = db
      .prepare(
        "SELECT COUNT(*) n FROM archives a WHERE kind='image' AND EXISTS(SELECT 1 FROM bookings b WHERE a.id='image-'||b.id)",
      )
      .get().n;
    for (const [table, query] of Object.entries(queries)) {
      const rows = query ? db.prepare(query[0]).all(...query.slice(1)) : [];
      result.eligible[table] = rows.length;
      result.removed[table] = 0;
      if (!result.preview && rows.length) {
        const remove = db.prepare(`DELETE FROM ${table} WHERE id=?`);
        for (const row of rows) {
          if (table === "delivery_jobs") {
            const job = db
              .prepare("SELECT * FROM delivery_jobs WHERE id=?")
              .get(row.id);
            evidence.delivery.push({
              id: job.id,
              state: job.state,
              created: job.created,
              delivered: job.delivered,
              result: job.last_error || "",
              bookingId: JSON.parse(job.payload).bookingId || null,
              payloadSha256: createHash("sha256")
                .update(job.payload)
                .digest("hex"),
            });
          }
          result.removed[table] += remove.run(row.id).changes;
        }
      }
    }
    if (Object.values(result.removed).some(Boolean))
      db.prepare(
        "INSERT INTO audit(actor,action,target,created,details) VALUES(NULL,'history.retention',?,?,?)",
      ).run(
        JSON.stringify(result.removed),
        result.at,
        JSON.stringify(evidence),
      );
  });
  return result;
}
