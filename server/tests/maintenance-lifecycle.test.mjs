import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { openStore } from "../store.mjs";
import { createMaintenance } from "../maintenance.mjs";
import { fork } from "node:child_process";
import { once } from "node:events";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function setup(t, overrides = {}) {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "outdoors-maint-lifecycle-"),
  );
  const file = path.join(dir, "app.sqlite"),
    db = openStore(file);
  const worker = path.join(dir, "hanging-worker.mjs");
  await writeFile(
    worker,
    `process.on('SIGTERM',()=>{}); process.on('disconnect',()=>process.exit(1)); setInterval(()=>{},100);`,
  );
  const options = {
    scheduled: false,
    backupHours: 0,
    workerUrl: pathToFileURL(worker),
    timeoutMs: 1200,
    leaseMs: 200,
    graceMs: 40,
    confirmMs: 200,
    ...overrides,
  };
  const maintenance = createMaintenance(db, file, options);
  t.after(async () => {
    await maintenance.close();
    db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const lease = () =>
    JSON.parse(
      db
        .prepare(
          "SELECT value FROM maintenance_state WHERE key='maintenanceLease'",
        )
        .get()?.value || "null",
    );
  const started = async () => {
    for (let i = 0; i < 100; i++) {
      const value = lease();
      if (value?.workerPid) return value;
      await wait(10);
    }
    assert.fail("维护进程未启动");
  };
  return { db, file, options, maintenance, lease, started };
}
function assertDead(pid) {
  assert.throws(
    () => process.kill(pid, 0),
    { code: "ESRCH" },
    "释放租约前必须确认进程退出",
  );
}

test("真实挂起工作进程续期超过初始租约，总时限后确认退出才释放", async (t) => {
  const f = await setup(t, { timeoutMs: 600 });
  const running = f.maintenance.run(),
    first = await f.started();
  await wait(260);
  assert.ok(f.lease().expires > first.expires, "活动维护必须续期");
  const other = createMaintenance(f.db, f.file, f.options);
  assert.equal((await other.run()).skipped, true);
  const result = await running;
  assert.equal(result.ok, false);
  assert.match(result.error, /执行时限/);
  assertDead(first.workerPid);
  assert.equal(f.lease(), null);
});

test("即使时钟租约过期也不能覆盖仍活着的工作进程；close有界且回收子进程", async (t) => {
  const f = await setup(t);
  const running = f.maintenance.run(),
    first = await f.started();
  f.db
    .prepare(
      "UPDATE maintenance_state SET value=? WHERE key='maintenanceLease'",
    )
    .run(JSON.stringify({ ...first, expires: 0 }));
  const other = createMaintenance(f.db, f.file, f.options);
  assert.equal((await other.run()).skipped, true);
  const start = Date.now();
  await f.maintenance.close();
  assert.ok(Date.now() - start < 1500);
  assert.match((await running).error, /服务关闭/);
  assertDead(first.workerPid);
  assert.equal(f.lease(), null);
});

test("租约续期写入失败终止真实工作进程，不提前释放工作互斥", async (t) => {
  const f = await setup(t);
  let failRenew = false;
  const proxy = new Proxy(f.db, {
    get(target, key) {
      if (key === "prepare")
        return (sql) => {
          if (
            failRenew &&
            sql.startsWith(
              "UPDATE maintenance_state SET value=? WHERE key='maintenanceLease'",
            )
          )
            throw new Error("renew storage failure");
          return target.prepare(sql);
        };
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const maintenance = createMaintenance(proxy, f.file, f.options);
  t.after(() => maintenance.close());
  const running = maintenance.run(),
    first = await f.started();
  failRenew = true;
  const result = await running;
  assert.equal(result.ok, false);
  assert.match(result.error, /续期失败/);
  assertDead(first.workerPid);
  assert.equal(f.lease(), null);
});

test("租约被替换后原维护退出，不能删除另一个租约", async (t) => {
  const f = await setup(t);
  const running = f.maintenance.run(),
    first = await f.started();
  const replacement = { id: "replacement", expires: Date.now() + 10000 };
  f.db
    .prepare(
      "UPDATE maintenance_state SET value=? WHERE key='maintenanceLease'",
    )
    .run(JSON.stringify(replacement));
  assert.match((await running).error, /租约已丢失/);
  assertDead(first.workerPid);
  assert.deepEqual(f.lease(), replacement);
});

test("主进程异常退出后真实维护worker通过IPC断开退出，过期租约可重新取得", async (t) => {
  const f = await setup(t),
    parentPath = path.join(path.dirname(f.file), "parent.mjs"),
    wrapperPath = path.join(
      path.dirname(f.file),
      "blocked-production-worker.mjs",
    ),
    marker = path.join(path.dirname(f.file), "admitted");
  await writeFile(
    wrapperPath,
    `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module'; const original=fs.lstat; fs.lstat=async (file,...args)=>{ if(String(file)===${JSON.stringify(f.file)}){await fs.writeFile(${JSON.stringify(marker)},'admitted'); return new Promise(()=>{});} return original(file,...args); }; syncBuiltinESMExports(); await import(${JSON.stringify(new URL("../maintenance-worker.mjs", import.meta.url).href)});`,
  );
  await writeFile(
    parentPath,
    `import {existsSync} from 'node:fs'; import {openStore} from ${JSON.stringify(new URL("../store.mjs", import.meta.url).href)}; import {createMaintenance} from ${JSON.stringify(new URL("../maintenance.mjs", import.meta.url).href)}; const db=openStore(${JSON.stringify(f.file)}); const maintenance=createMaintenance(db,${JSON.stringify(f.file)},{scheduled:false,backupHours:0,leaseMs:200,timeoutMs:20000,workerUrl:new URL(${JSON.stringify(pathToFileURL(wrapperPath).href)})}); maintenance.run(); const timer=setInterval(()=>{if(existsSync(${JSON.stringify(marker)})){clearInterval(timer); process.send(JSON.parse(db.prepare("SELECT value FROM maintenance_state WHERE key='maintenanceLease'").get().value));}},10);`,
  );
  const parent = fork(parentPath, [], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let workerPid;
  t.after(() => {
    try {
      parent.kill("SIGKILL");
    } catch {}
    if (workerPid) {
      try {
        process.kill(workerPid, "SIGKILL");
      } catch {}
    }
  });
  const lease = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      parent.kill("SIGKILL");
      reject(new Error("维护进程未进入预期阶段"));
    }, 5000);
    parent.once("message", (value) => {
      clearTimeout(timer);
      resolve(value);
    });
    parent.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    parent.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("主进程提前退出"));
    });
  });
  workerPid = lease.workerPid;
  assert.ok(workerPid > 0);
  const exited = once(parent, "exit");
  parent.kill("SIGKILL");
  await exited;
  for (let i = 0; i < 200; i++) {
    try {
      process.kill(workerPid, 0);
      await wait(10);
    } catch (error) {
      if (error.code === "ESRCH") break;
      throw error;
    }
  }
  assertDead(workerPid);
  workerPid = null;
  f.db
    .prepare(
      "UPDATE maintenance_state SET value=? WHERE key='maintenanceLease'",
    )
    .run(JSON.stringify({ ...lease, expires: 0 }));
  const recovered = createMaintenance(f.db, f.file, {
    scheduled: false,
    backupHours: 0,
  });
  assert.equal((await recovered.run()).ok, true);
  await recovered.close();
});
