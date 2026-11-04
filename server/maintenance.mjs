import { statfsSync, statSync } from "node:fs";
import path from "node:path";
import { tx, today } from "./core.mjs";
import { offsiteConfigured } from "./offsite.mjs";
import { transportConfigured } from "./integrations.mjs";
import { randomUUID } from "node:crypto";
import { integrationReadiness } from "./readiness.mjs";
import { overdueCases } from "./casework.mjs";
import { superviseMaintenance } from "./maintenance-process.mjs";
import { capacityPolicy, retentionPolicy } from "./retention.mjs";

const integer = (v, f, min, max) => {
  const n = Number(v ?? f);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error("维护参数无效");
  return n;
};
const workerAlive = (lease) => {
  if (!Number.isInteger(lease?.workerPid) || lease.workerPid <= 0) return false;
  try {
    process.kill(lease.workerPid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
};
export function createMaintenance(db, dbPath, options = {}) {
  const timeoutMs = integer(
      options.timeoutMs ??
        integer(process.env.MAINTENANCE_TIMEOUT_SECONDS, 1800, 1, 86400) * 1000,
      1800000,
      100,
      86400000,
    ),
    leaseMs = integer(
      options.leaseMs ??
        integer(process.env.MAINTENANCE_LEASE_SECONDS, 120, 30, 3600) * 1000,
      120000,
      100,
      3600000,
    ),
    renewMs = Math.max(25, Math.floor(leaseMs / 4)),
    graceMs = integer(
      options.graceMs ??
        integer(process.env.MAINTENANCE_KILL_GRACE_SECONDS, 5, 1, 30) * 1000,
      5000,
      20,
      30000,
    ),
    confirmMs = integer(options.confirmMs, 5000, 20, 10000);
  const memory = dbPath === ":memory:",
    config = {
      dbPath: path.resolve(dbPath),
      backupDir: path.resolve(
        options.backupDir ||
          process.env.BACKUP_DIR ||
          path.join(path.dirname(path.resolve(dbPath)), "backups"),
      ),
      backupHours: integer(
        options.backupHours ?? process.env.BACKUP_INTERVAL_HOURS,
        24,
        0,
        720,
      ),
      keep: integer(options.keep ?? process.env.BACKUP_KEEP, 14, 2, 365),
      capacity: capacityPolicy({
        ...process.env,
        DATABASE_MAX_MB: options.databaseMaxMb ?? process.env.DATABASE_MAX_MB,
        BACKUP_MAX_MB: options.backupMaxMb ?? process.env.BACKUP_MAX_MB,
      }),
      retention: retentionPolicy(),
    };
  const minBytes =
    integer(
      options.minFreeMb ?? process.env.MIN_FREE_DISK_MB,
      256,
      0,
      1000000,
    ) *
    1024 *
    1024;
  let running = null,
    timer,
    initial,
    active,
    closing = false;
  const state = (key) => {
    try {
      return JSON.parse(
        db.prepare("SELECT value FROM maintenance_state WHERE key=?").get(key)
          ?.value || "null",
      );
    } catch {
      return null;
    }
  };
  function health(probe = true) {
    try {
      if (probe)
        tx(db, () =>
          db
            .prepare(
              "INSERT INTO health_probe(id,checked) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET checked=excluded.checked",
            )
            .run(Date.now()),
        );
      else db.prepare("SELECT 1").get();
      const freeBytes = memory
        ? null
        : (() => {
            const s = statfsSync(path.dirname(config.dbPath));
            return Number(s.bavail) * Number(s.bsize);
          })();
      const databaseBytes = memory
          ? null
          : [
              config.dbPath,
              config.dbPath + "-wal",
              config.dbPath + "-shm",
            ].reduce((bytes, file) => {
              try {
                return bytes + statSync(file).size;
              } catch (error) {
                if (error.code === "ENOENT") return bytes;
                throw error;
              }
            }, 0),
        databaseLimitReached =
          !!config.capacity.databaseMaxBytes &&
          databaseBytes !== null &&
          databaseBytes >= config.capacity.databaseMaxBytes;
      return {
        ok:
          (freeBytes === null || freeBytes >= minBytes) &&
          !databaseLimitReached,
        database: true,
        freeBytes,
        databaseBytes,
        databaseMaxBytes: config.capacity.databaseMaxBytes,
        databaseLimitReached,
      };
    } catch {
      return { ok: false, database: false, freeBytes: null };
    }
  }
  function failure(error) {
    const result = {
      ok: false,
      error: String(error?.message || error),
      at: new Date().toISOString(),
    };
    // The database may itself be unavailable. Logging must remain independent
    // of recording the failure, especially when another connection holds a lock.
    try {
      db.prepare(
        "INSERT INTO maintenance_state(key,value) VALUES('maintenance',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run(JSON.stringify(result));
    } catch {}
    console.error(JSON.stringify({ event: "maintenance.failed", ...result }));
    return result;
  }
  function run(force = false) {
    if (closing)
      return Promise.resolve({
        ok: true,
        skipped: true,
        reason: "服务正在关闭",
      });
    if (memory) return Promise.resolve({ ok: true, skipped: true });
    if (running) return running;
    // Defer acquisition so even synchronous SQLite/fork failures belong to the
    // returned promise and concurrent callers share the same run.
    running = Promise.resolve()
      .then(async () => {
        const leaseId = randomUUID();
        let acquired = false,
          result,
          exitConfirmed = true;
        try {
          if (closing) return { ok: true, skipped: true };
          acquired = tx(db, () => {
            const lease = state("maintenanceLease");
            if (lease?.expires > Date.now()) return false;
            // An expired clock lease must never admit work over a still-live
            // worker (including an orphan whose parent has died).
            if (workerAlive(lease)) return false;
            db.prepare(
              "INSERT INTO maintenance_state VALUES('maintenanceLease',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            ).run(
              JSON.stringify({
                id: leaseId,
                ownerPid: process.pid,
                expires: Date.now() + leaseMs,
              }),
            );
            return true;
          });
          if (!acquired)
            return {
              ok: true,
              skipped: true,
              reason: "另一个服务实例正在维护",
            };
          active = superviseMaintenance({
            // A direct constructor option allows isolated process fixtures;
            // deployment configuration cannot choose an executable/module.
            worker:
              options.workerUrl ||
              new URL("./maintenance-worker.mjs", import.meta.url),
            config: {
              ...config,
              force,
              reserveBytes: minBytes,
              leaseId,
              ownerPid: process.pid,
            },
            timeoutMs,
            renewMs,
            graceMs,
            confirmMs,
            renew: (workerPid) =>
              tx(db, () => {
                const lease = state("maintenanceLease");
                if (lease?.id !== leaseId) return false;
                db.prepare(
                  "UPDATE maintenance_state SET value=? WHERE key='maintenanceLease'",
                ).run(
                  JSON.stringify({
                    ...lease,
                    workerPid,
                    expires: Date.now() + leaseMs,
                  }),
                );
                return true;
              }),
          });
          result = await active.promise;
          exitConfirmed = result.exitConfirmed;
          active = null;
          if (!result.ok) result = failure(result.error);
        } catch (error) {
          result = failure(error);
        } finally {
          if (acquired && exitConfirmed) {
            try {
              tx(db, () => {
                if (state("maintenanceLease")?.id === leaseId)
                  db.prepare(
                    "DELETE FROM maintenance_state WHERE key='maintenanceLease'",
                  ).run();
              });
            } catch (error) {
              // Retain the expiring lease if release fails. Do not report success
              // or clear a lease that could now belong to a different process.
              result = failure(error);
            }
          }
        }
        return result;
      })
      .finally(() => {
        running = null;
      });
    return running;
  }
  return {
    health,
    run,
    status: () => {
      const h = health(),
        backup = state("backup"),
        maintenance = state("maintenance"),
        warnings = [],
        lease = state("maintenanceLease");
      if (!h.ok) warnings.push("数据库或磁盘空间异常，请立即检查服务与数据卷");
      if (h.databaseLimitReached)
        warnings.push(
          "数据库已达到配置的写入上限，新申报和草稿暂停保存；查询、审批和备份仍可使用",
        );
      if (!backup) warnings.push("尚无自动备份成功记录");
      if (backup) {
        try {
          const file = path.resolve(config.backupDir, backup.file);
          const info = statSync(file);
          const keyInfo = statSync(file + ".mfa-key");
          if (
            path.dirname(file) !== config.backupDir ||
            !info.isFile() ||
            info.size < 100 ||
            !keyInfo.isFile() ||
            keyInfo.size !== 32
          )
            throw new Error();
        } catch {
          warnings.push("最近备份文件缺失或无效，请重新备份并检查备份目录");
        }
      }
      if (
        backup &&
        config.backupHours > 0 &&
        Date.now() - Date.parse(backup.at) > config.backupHours * 5400000
      )
        warnings.push("最近备份已超过预定周期，请检查维护任务");
      if (maintenance && !maintenance.ok)
        warnings.push("最近一次维护失败，请查看失败信息");
      if (!config.backupHours) warnings.push("自动备份已关闭");
      if (lease?.expires <= Date.now() && workerAlive(lease))
        warnings.push(
          "维护租约已过期但工作进程仍存活，为避免并行已阻止新任务，请检查维护进程",
        );
      const capacity = state("capacity");
      if (capacity?.databaseExceeded)
        warnings.push("数据库文件总量已达到容量预警阈值，请评估历史保留与扩容");
      if (capacity?.backupExceeded)
        warnings.push(
          "备份目录总量已达到容量预警阈值，请转移或扩容；系统不会自动删除手动备份",
        );
      if (capacity?.scanError)
        warnings.push("容量扫描未完成，请检查目录与权限");
      return {
        health: h,
        running: !!running || lease?.expires > Date.now() || workerAlive(lease),
        maintenance,
        lifecycle: {
          timeoutSeconds: timeoutMs / 1000,
          leaseSeconds: leaseMs / 1000,
          renewSeconds: renewMs / 1000,
          killGraceSeconds: graceMs / 1000,
        },
        capacity: capacity || { ...config.capacity, scannedAt: null },
        retention: state("retention") || {
          ...config.retention,
          eligible: null,
          removed: null,
        },
        backup,
        backupHours: config.backupHours,
        keep: config.keep,
        minFreeMb: minBytes / 1024 / 1024,
        localBackupOnly: !offsiteConfigured(),
        offsiteConfigured: offsiteConfigured(),
        offsite: state("offsite"),
        alertConfigured: !!process.env.ALERT_WEBHOOK_URL,
        externalAlert: state("externalAlert"),
        communicationConfigured: transportConfigured(),
        integrations: integrationReadiness(),
        deliveries: db
          .prepare(
            "SELECT state,COUNT(*) count FROM delivery_jobs GROUP BY state",
          )
          .all(),
        archiveCount: db.prepare("SELECT COUNT(*) n FROM archives").get().n,
        databaseStorage: {
          allocated:
            db.prepare("PRAGMA page_count").get().page_count *
            db.prepare("PRAGMA page_size").get().page_size,
          reusable:
            db.prepare("PRAGMA freelist_count").get().freelist_count *
            db.prepare("PRAGMA page_size").get().page_size,
          incrementalVacuum:
            db.prepare("PRAGMA auto_vacuum").get().auto_vacuum === 2,
        },
        warnings,
        pendingWorkdayOverdue: overdueCases(db),
        pendingOver24: db
          .prepare(
            "SELECT COUNT(*) AS n FROM bookings WHERE status='待审核' AND start>=? AND created<?",
          )
          .get(today(), new Date(Date.now() - 86400000).toISOString()).n,
        expiredUnreviewed: db
          .prepare(
            "SELECT COUNT(*) AS n FROM bookings WHERE status='待审核' AND cancelled=0 AND start<?",
          )
          .get(today()).n,
      };
    },
    start() {
      if (memory || options.scheduled === false) return;
      initial = setTimeout(() => run(), 10000);
      initial.unref();
      timer = setInterval(() => run(), 3600000);
      timer.unref();
    },
    async close() {
      closing = true;
      clearTimeout(initial);
      clearInterval(timer);
      active?.stop("服务关闭，维护任务已终止");
      try {
        if (running) await running;
      } finally {
        closing = false;
      }
    },
  };
}
