import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

function isolated(t, body) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "outdoors-ops-review-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = `
    import assert from 'node:assert/strict';
    import { DatabaseSync } from 'node:sqlite';
    import { openStore } from ${JSON.stringify(new URL("../store.mjs", import.meta.url).href)};
    import { createMaintenance } from ${JSON.stringify(new URL("../maintenance.mjs", import.meta.url).href)};
    import { createDelivery } from ${JSON.stringify(new URL("../delivery.mjs", import.meta.url).href)};
    const file = ${JSON.stringify(path.join(dir, "app.sqlite"))};
    const db = openStore(file);
    db.exec('PRAGMA busy_timeout=10');
    const blocker = new DatabaseSync(file);
    ${body}
    blocker.close();
    db.close();
    console.log('verified');
  `;
  const scriptPath = path.join(dir, "fixture.mjs");
  writeFileSync(scriptPath, script);
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, S3_BACKUP_BUCKET: "", ALERT_WEBHOOK_URL: "" },
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified/);
}

test("后台维护和通知的定时写锁失败不退出，关闭后释放running并可重试", (t) => {
  isolated(
    t,
    `
    const timeout = globalThis.setTimeout;
    const interval = globalThis.setInterval;
    // Fast-forward only scheduler delays, leaving production defaults intact.
    globalThis.setTimeout = (fn, ms, ...args) => timeout(fn, ms === 10000 ? 10 : ms, ...args);
    globalThis.setInterval = (fn, ms, ...args) => interval(fn, [15000, 3600000].includes(ms) ? 20 : ms, ...args);
    const maintenance = createMaintenance(db, file, { backupHours: 0 });
    const delivery = createDelivery(db, maintenance);
    blocker.exec('BEGIN IMMEDIATE');
    maintenance.start();
    delivery.start();
    await new Promise(resolve => timeout(resolve, 100));
    // Both close methods must also tolerate in-flight failed work.
    await delivery.close();
    await maintenance.close();
    blocker.exec('ROLLBACK');
    globalThis.setTimeout = timeout;
    globalThis.setInterval = interval;
    const result = await maintenance.run();
    assert.equal(result.ok, true, JSON.stringify(result));
    await delivery.run();
    await maintenance.close();
    await delivery.close();
    assert.equal(maintenance.status().running, false);
  `,
  );
});

test("维护子进程启动失败返回失败并撤销租约，随后可重新维护", (t) => {
  isolated(
    t,
    `
    const maintenance = createMaintenance(db, file, { scheduled: false, backupHours: 0 });
    const execPath = process.execPath;
    process.execPath = file + '-missing-node';
    const failed = await maintenance.run();
    process.execPath = execPath;
    assert.equal(failed.ok, false);
    assert.equal(maintenance.status().running, false);
    assert.equal(db.prepare("SELECT value FROM maintenance_state WHERE key='maintenanceLease'").get(), undefined);
    assert.equal((await maintenance.run()).ok, true);
    await maintenance.close();
  `,
  );
});

test("维护租约释放失败不会报告成功或留下未处理拒绝，租约到期后可重试", (t) => {
  isolated(
    t,
    `
    let failRelease = true;
    const wrapped = new Proxy(db, {
      get(target, property) {
        if (property === 'prepare') return (sql) => {
          if (failRelease && sql.includes("DELETE FROM maintenance_state WHERE key='maintenanceLease'"))
            throw new Error('simulated lease release failure');
          return target.prepare(sql);
        };
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    const maintenance = createMaintenance(wrapped, file, { scheduled: false, backupHours: 0 });
    const failed = await maintenance.run();
    assert.equal(failed.ok, false);
    assert.match(failed.error, /lease release failure/);
    assert.equal(maintenance.status().maintenance.ok, false);
    assert.equal((await maintenance.run()).skipped, true);
    failRelease = false;
    db.prepare("UPDATE maintenance_state SET value=? WHERE key='maintenanceLease'").run(JSON.stringify({id:'expired', expires:0}));
    assert.equal((await maintenance.run()).ok, true);
    assert.equal(maintenance.status().running, false);
    await maintenance.close();
  `,
  );
});
