import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createCipheriv, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { encryptBackup, restoreEncrypted } from "../offsite.mjs";
import { verifyMfaKey } from "../backup-key.mjs";
import { syncBuiltinESMExports } from "node:module";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function fixture(t) {
  const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), "outdoors-restore-lock-"),
    ),
    destination = path.join(dir, "restored"),
    source = path.join(dir, "source.sqlite"),
    encrypted = path.join(dir, "source.enc"),
    key = Buffer.alloc(32, 71),
    children = [];
  const previous = process.env.BACKUP_ENCRYPTION_KEY;
  process.env.BACKUP_ENCRYPTION_KEY = "cd".repeat(32);
  await fs.mkdir(destination);
  const db = new DatabaseSync(source),
    iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  const secret = Buffer.concat([
    iv,
    cipher.update("JBSWY3DPEHPK3PXP"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
  db.exec(
    "CREATE TABLE mfa(secret TEXT); CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES('retained restoration');",
  );
  db.prepare("INSERT INTO mfa VALUES(?)").run(secret);
  db.close();
  await encryptBackup(source, encrypted, key);
  t.after(async () => {
    for (const entry of children) {
      if (entry.child.exitCode === null && entry.child.signalCode === null)
        entry.child.kill("SIGKILL");
      await entry.exited;
    }
    if (previous === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
    else process.env.BACKUP_ENCRYPTION_KEY = previous;
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("outdoors-restore-lock-"));
    await fs.rm(dir, { recursive: true, force: true });
  });
  async function blockedRestore(target, publicationTarget = target) {
    const ready = path.join(dir, `ready-${children.length}`),
      go = path.join(dir, `go-${children.length}`),
      script = path.join(dir, `worker-${children.length}.mjs`);
    await fs.writeFile(
      script,
      `import fs from 'node:fs/promises';import {existsSync} from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const actual=fs.link;fs.link=async(from,to)=>{if(String(to)===${JSON.stringify(publicationTarget)}){await fs.writeFile(${JSON.stringify(ready)},'ready');const limit=Date.now()+8000;while(!existsSync(${JSON.stringify(go)})){if(Date.now()>limit)throw Error('fixture timed out');await new Promise(r=>setTimeout(r,10));}}return actual(from,to);};syncBuiltinESMExports();const {restoreEncrypted}=await import(${JSON.stringify(new URL("../offsite.mjs", import.meta.url).href)});try{await restoreEncrypted(${JSON.stringify(encrypted)},${JSON.stringify(target)});console.log(JSON.stringify({ok:true}));}catch(error){console.log(JSON.stringify({ok:false,code:error.code,message:error.message}));}`,
    );
    const child = spawn(process.execPath, [script], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    const entry = {
      child,
      output: "",
      diagnostics: "",
      exited: new Promise((resolve) => child.once("close", resolve)),
    };
    child.stdout.on("data", (part) => {
      entry.output += part;
    });
    child.stderr.on("data", (part) => {
      entry.diagnostics += part;
    });
    children.push(entry);
    const deadline = Date.now() + 5000;
    while (!existsSync(ready)) {
      if (
        child.exitCode !== null ||
        child.signalCode !== null ||
        Date.now() > deadline
      )
        assert.fail(
          "恢复进程未进入发布阶段: " + entry.output + entry.diagnostics,
        );
      await pause(10);
    }
    return {
      ...entry,
      async fail() {
        await fs.writeFile(publicationTarget, "concurrent target", {
          flag: "wx",
        });
        await fs.writeFile(go, "continue");
        await entry.exited;
        return JSON.parse(entry.output.trim());
      },
    };
  }
  async function verify(target) {
    const restored = new DatabaseSync(target, { readOnly: true });
    try {
      assert.equal(
        restored.prepare("SELECT value FROM proof").get().value,
        "retained restoration",
      );
      verifyMfaKey(
        restored,
        await fs.readFile(path.join(path.dirname(target), ".mfa-key")),
      );
    } finally {
      restored.close();
    }
  }
  return { dir, destination, source, encrypted, key, blockedRestore, verify };
}

test("真实双进程同目录不同目标及目录别名不能依赖尚可回滚的新密钥，失败释放后串行可重试", async (t) => {
  const f = await fixture(t),
    targetA = path.join(f.destination, "a.sqlite"),
    alias = path.join(f.dir, "directory-alias");
  await fs.symlink(f.destination, alias, "junction");
  const targetB = path.join(alias, "b.sqlite"),
    a = await f.blockedRestore(targetA);
  let blocked;
  try {
    await restoreEncrypted(f.encrypted, targetB);
  } catch (error) {
    blocked = error;
  }
  const failed = await a.fail();
  assert.equal(failed.code, "EEXIST");
  if (!blocked)
    assert.equal(
      existsSync(path.join(f.destination, ".mfa-key")),
      true,
      "另一个成功恢复依赖的密钥不得被失败恢复回滚删除",
    );
  assert.match(blocked?.message || "", /恢复目录.*锁|恢复操作.*进行/);
  assert.deepEqual((await fs.readdir(f.destination)).sort(), ["a.sqlite"]);
  await restoreEncrypted(f.encrypted, targetB);
  const targetC = path.join(f.destination, "c.sqlite");
  await restoreEncrypted(f.encrypted, targetC);
  await f.verify(targetB);
  await f.verify(targetC);
  assert.deepEqual((await fs.readdir(f.destination)).sort(), [
    ".mfa-key",
    "a.sqlite",
    "b.sqlite",
    "c.sqlite",
  ]);
});

test("不同恢复目录不互相阻塞，失败目录不能删除另一目录的密钥", async (t) => {
  const f = await fixture(t),
    a = await f.blockedRestore(path.join(f.destination, "a.sqlite")),
    other = path.join(f.dir, "other");
  await fs.mkdir(other);
  const targetB = path.join(other, "b.sqlite");
  await restoreEncrypted(f.encrypted, targetB);
  await f.verify(targetB);
  assert.equal((await a.fail()).code, "EEXIST");
  await f.verify(targetB);
  assert.deepEqual((await fs.readdir(f.destination)).sort(), ["a.sqlite"]);
  assert.deepEqual((await fs.readdir(other)).sort(), [".mfa-key", "b.sqlite"]);
});

test("恢复期间目录别名改指向后，发布与回滚仍绑定原规范目录", async (t) => {
  const f = await fixture(t),
    alias = path.join(f.dir, "moving-alias"),
    other = path.join(f.dir, "new-location");
  await fs.mkdir(other);
  await fs.symlink(f.destination, alias, "junction");
  const a = await f.blockedRestore(
    path.join(alias, "a.sqlite"),
    path.join(f.destination, "a.sqlite"),
  );
  try {
    await fs.unlink(alias);
  } catch (error) {
    if (!["EISDIR", "EPERM"].includes(error.code)) throw error;
    await fs.rmdir(alias);
  }
  await fs.symlink(other, alias, "junction");
  const targetB = path.join(alias, "b.sqlite");
  await restoreEncrypted(f.encrypted, targetB);
  assert.equal((await a.fail()).code, "EEXIST");
  await f.verify(targetB);
  assert.deepEqual((await fs.readdir(f.destination)).sort(), ["a.sqlite"]);
  assert.deepEqual((await fs.readdir(other)).sort(), [".mfa-key", "b.sqlite"]);
});

test("未知恢复目录锁立即拒绝且保留，不能自动抢锁或删除外部文件", async (t) => {
  const f = await fixture(t),
    lock = path.join(f.destination, ".restore.lock");
  await fs.writeFile(lock, "external lock");
  const started = Date.now();
  await assert.rejects(
    restoreEncrypted(f.encrypted, path.join(f.destination, "b.sqlite")),
    /锁.*人工|人工.*锁|人工核查/,
  );
  assert.ok(Date.now() - started < 1500);
  assert.equal(await fs.readFile(lock, "utf8"), "external lock");
  assert.deepEqual(await fs.readdir(f.destination), [".restore.lock"]);
});

test("失败时被替换的目录锁保留，不能按固定路径误删其他恢复者的锁", async (t) => {
  const f = await fixture(t),
    a = await f.blockedRestore(path.join(f.destination, "a.sqlite")),
    lock = path.join(f.destination, ".restore.lock");
  await fs.rename(lock, lock + ".original");
  await fs.writeFile(lock, "external replacement");
  await a.fail();
  assert.equal(await fs.readFile(lock, "utf8"), "external replacement");
  assert.equal(existsSync(path.join(f.destination, ".mfa-key")), false);
  assert.deepEqual((await fs.readdir(f.destination)).sort(), [
    ".restore.lock",
    ".restore.lock.original",
    "a.sqlite",
  ]);
});

test("目录锁在同一inode上被外部改写时也保留，不仅依赖inode判断所有权", async (t) => {
  const f = await fixture(t),
    a = await f.blockedRestore(path.join(f.destination, "a.sqlite")),
    lock = path.join(f.destination, ".restore.lock");
  const before = await fs.stat(lock, { bigint: true });
  await fs.writeFile(lock, "external rewritten claim");
  assert.equal((await fs.stat(lock, { bigint: true })).ino, before.ino);
  await a.fail();
  assert.equal(await fs.readFile(lock, "utf8"), "external rewritten claim");
  assert.deepEqual((await fs.readdir(f.destination)).sort(), [
    ".restore.lock",
    "a.sqlite",
  ]);
});

test("目录锁初始化写入失败关闭自有句柄并移除本次锁，正常重试成功", async (t) => {
  const f = await fixture(t),
    original = fs.open;
  let ownedHandle;
  fs.open = async (file, ...args) => {
    const handle = await original(file, ...args);
    if (path.basename(String(file)) !== ".restore.lock") return handle;
    ownedHandle = handle;
    return new Proxy(handle, {
      get(target, property) {
        if (property === "writeFile")
          return async () => {
            throw Object.assign(new Error("injected lock ENOSPC"), {
              code: "ENOSPC",
            });
          };
        const value = target[property];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      restoreEncrypted(f.encrypted, path.join(f.destination, "b.sqlite")),
      /injected lock ENOSPC/,
    );
  } finally {
    fs.open = original;
    syncBuiltinESMExports();
  }
  assert.equal(ownedHandle.fd, -1);
  assert.deepEqual(await fs.readdir(f.destination), []);
  const target = path.join(f.destination, "b.sqlite");
  await restoreEncrypted(f.encrypted, target);
  await f.verify(target);
  assert.deepEqual((await fs.readdir(f.destination)).sort(), [
    ".mfa-key",
    "b.sqlite",
  ]);
});

test("恢复持锁进程强杀后不自动抢锁，错误指引先核查进程再人工清理", async (t) => {
  const f = await fixture(t),
    a = await f.blockedRestore(path.join(f.destination, "a.sqlite")),
    lock = path.join(f.destination, ".restore.lock");
  const before = await fs.readFile(lock);
  a.child.kill("SIGKILL");
  await a.exited;
  await assert.rejects(
    restoreEncrypted(f.encrypted, path.join(f.destination, "b.sqlite")),
    /人工核查|人工.*清理/,
  );
  assert.deepEqual(await fs.readFile(lock), before);
  assert.equal(existsSync(path.join(f.destination, "b.sqlite")), false);
});
