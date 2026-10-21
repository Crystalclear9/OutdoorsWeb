import { fork } from "node:child_process";
import { statfsSync, statSync } from "node:fs";
import path from "node:path";
import { tx } from "./core.mjs";
import { offsiteConfigured } from "./offsite.mjs";
import { transportConfigured } from "./integrations.mjs";
import { randomUUID } from "node:crypto";
import { integrationReadiness } from "./readiness.mjs";
import { overdueCases } from "./casework.mjs";

const integer = (v, f, min, max) => {
  const n = Number(v ?? f);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error("维护参数无效");
  return n;
};
export function createMaintenance(db, dbPath, options = {}) {
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
    initial;
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
      return {
        ok: freeBytes === null || freeBytes >= minBytes,
        database: true,
        freeBytes,
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
    if (memory) return Promise.resolve({ ok: true, skipped: true });
    if (running) return running;
    // Defer acquisition so even synchronous SQLite/fork failures belong to the
    // returned promise and concurrent callers share the same run.
    running = Promise.resolve()
      .then(async () => {
        const leaseId = randomUUID();
        let acquired = false,
          result;
        try {
          acquired = tx(db, () => {
            const lease = state("maintenanceLease");
            if (lease?.expires > Date.now()) return false;
            db.prepare(
              "INSERT INTO maintenance_state VALUES('maintenanceLease',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            ).run(
              JSON.stringify({ id: leaseId, expires: Date.now() + 3600000 }),
            );
            return true;
          });
          if (!acquired)
            return {
              ok: true,
              skipped: true,
              reason: "另一个服务实例正在维护",
            };
          result = await new Promise((resolve) => {
            const child = fork(
              new URL("./maintenance-worker.mjs", import.meta.url),
              [JSON.stringify({ ...config, force, reserveBytes: minBytes })],
              { stdio: ["ignore", "ignore", "pipe", "ipc"] },
            );
            let reported,
              diagnostic = "";
            child.stderr.on("data", (b) => {
              diagnostic = (diagnostic + b).slice(-2000);
            });
            child.on("message", (m) => {
              reported = m;
            });
            child.on("error", (e) => resolve({ ok: false, error: e.message }));
            child.on("exit", (code) =>
              resolve(
                code === 0 && reported
                  ? reported
                  : {
                      ok: false,
                      error:
                        reported?.error || diagnostic || "维护进程异常退出",
                    },
              ),
            );
          });
          if (!result.ok) result = failure(result.error);
        } catch (error) {
          result = failure(error);
        } finally {
          if (acquired) {
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
        warnings = [];
      if (!h.ok) warnings.push("数据库或磁盘空间异常，请立即检查服务与数据卷");
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
      return {
        health: h,
        running: !!running || state("maintenanceLease")?.expires > Date.now(),
        maintenance,
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
            "SELECT COUNT(*) AS n FROM bookings WHERE status='待审核' AND created<?",
          )
          .get(new Date(Date.now() - 86400000).toISOString()).n,
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
      clearTimeout(initial);
      clearInterval(timer);
      if (running) await running;
    },
  };
}
