import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  existsSync,
  utimesSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { openStore } from "../store.mjs";

const oldName =
  "auto-2020-01-01T00-00-00-000Z-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.sqlite.part";
function fixture(t, directoryExists = true) {
  const directory = mkdtempSync(
      path.join(os.tmpdir(), "outdoors-backup-cleanup-"),
    ),
    dbPath = path.join(directory, "app.sqlite"),
    backupDir = path.join(directory, "backups"),
    key = Buffer.alloc(32, 71);
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("outdoors-backup-cleanup-"));
    rmSync(directory, { recursive: true, force: true });
  });
  openStore(dbPath).close();
  writeFileSync(path.join(directory, ".mfa-key"), key);
  if (directoryExists) mkdirSync(backupDir);
  const stale = (name = oldName) => {
    const file = path.join(backupDir, name),
      old = new Date(Date.now() - 3 * 86400000);
    writeFileSync(file, "interrupted backup");
    utimesSync(file, old, old);
    return file;
  };
  const run = (overrides = {}, hook = "") => {
    const config = {
      dbPath,
      backupDir,
      keep: 2,
      backupHours: 0,
      force: false,
      ...overrides,
    };
    const script = `
      import fs from 'node:fs/promises';
      import {syncBuiltinESMExports} from 'node:module';
      ${hook}
      syncBuiltinESMExports();
      process.argv[2]=${JSON.stringify(JSON.stringify(config))};
      await import(${JSON.stringify(new URL("../maintenance-worker.mjs", import.meta.url).href)});
    `;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        encoding: "utf8",
        timeout: 15000,
        env: {
          ...process.env,
          APP_ENCRYPTION_KEY: "",
          S3_BACKUP_BUCKET: "",
          ALERT_WEBHOOK_URL: "",
          ARCHIVE_AFTER_DAYS: "365",
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return JSON.parse(
        db
          .prepare(
            "SELECT value FROM maintenance_state WHERE key='maintenance'",
          )
          .get().value,
      );
    } finally {
      db.close();
    }
  };
  return { directory, dbPath, backupDir, key, stale, run };
}

test("清理过期自动备份临时文件后重新检查空间，原空间不足仍能完成新备份", (t) => {
  const f = fixture(t),
    partial = f.stale(),
    key = f.stale(oldName + ".mfa-key");
  const result = f.run(
    { force: true, backupHours: 24 },
    `
    const actual=fs.statfs;
    fs.statfs=async(file)=>{
      const blocked=await fs.lstat(${JSON.stringify(partial)}).then(()=>true,()=>false);
      if(blocked) return {bavail:0,bsize:4096};
      return actual(file);
    };
  `,
  );
  assert.equal(result.ok, true);
  assert.equal(result.removed.staleBackupParts, 2);
  assert.equal(existsSync(partial), false);
  assert.equal(existsSync(key), false);
  assert.ok(existsSync(path.join(f.backupDir, result.backup.file)));
  assert.deepEqual(
    readFileSync(path.join(f.backupDir, result.backup.file + ".mfa-key")),
    f.key,
  );
});

test("关闭自动备份也清理过期临时文件，保留新文件、完整快照、未知文件、目录及符号链接", (t) => {
  const f = fixture(t),
    partial = f.stale(),
    encrypted = f.stale(
      oldName.replace(
        ".sqlite.part",
        ".sqlite.aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.encrypted.part",
      ),
    );
  const freshName = oldName.replace("2020-01-01", "2020-01-02"),
    completeName = oldName.replace(".part", ""),
    unknownName = "manual-important.sqlite.part",
    malformedName = "auto-2020-important.sqlite.part",
    directoryName = oldName.replace("2020-01-01", "2020-01-03"),
    linkName = oldName.replace("2020-01-01", "2020-01-04");
  writeFileSync(path.join(f.backupDir, freshName), "fresh");
  for (const name of [completeName, unknownName, malformedName]) f.stale(name);
  mkdirSync(path.join(f.backupDir, directoryName));
  let linked = false;
  try {
    symlinkSync(
      path.join(f.backupDir, completeName),
      path.join(f.backupDir, linkName),
    );
    linked = true;
  } catch (e) {
    if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(e.code))
      throw e;
    t.diagnostic(
      "Windows 当前权限不允许创建符号链接；Linux CI 覆盖真实链接保留。",
    );
  }
  const result = f.run();
  assert.equal(result.ok, true);
  assert.equal(result.removed.staleBackupParts, 2);
  assert.equal(existsSync(partial), false);
  assert.equal(existsSync(encrypted), false);
  assert.deepEqual(
    readdirSync(f.backupDir).sort(),
    [
      freshName,
      completeName,
      unknownName,
      malformedName,
      directoryName,
      ...(linked ? [linkName] : []),
    ].sort(),
  );
  for (const name of [completeName, unknownName, malformedName])
    assert.equal(
      readFileSync(path.join(f.backupDir, name), "utf8"),
      "interrupted backup",
    );
});

test("最近有效备份未到周期时也清理过期临时文件且保留原快照", (t) => {
  const f = fixture(t),
    partial = f.stale(),
    name = oldName.replace(".part", "");
  copyFileSync(f.dbPath, path.join(f.backupDir, name));
  writeFileSync(path.join(f.backupDir, name + ".mfa-key"), f.key);
  const before = readFileSync(path.join(f.backupDir, name));
  const db = new DatabaseSync(f.dbPath);
  db.prepare("INSERT INTO maintenance_state(key,value) VALUES('backup',?)").run(
    JSON.stringify({ file: name, at: new Date().toISOString() }),
  );
  db.close();
  const result = f.run({ backupHours: 24 });
  assert.equal(existsSync(partial), false);
  assert.equal(result.backup.file, name);
  assert.deepEqual(readFileSync(path.join(f.backupDir, name)), before);
});

test("清理检查期间临时文件被移除不会使维护失败", (t) => {
  const f = fixture(t),
    partial = f.stale();
  f.run(
    {},
    `
    const actual=fs.lstat; let reads=0;
    fs.lstat=async(file,...args)=>{
      if(String(file)===${JSON.stringify(partial)} && ++reads===2) await fs.unlink(file);
      return actual(file,...args);
    };
  `,
  );
  assert.equal(existsSync(partial), false);
});

test("清理检查期间替换的旧文件仍保留，文件标识变化阻止删除", (t) => {
  const f = fixture(t),
    partial = f.stale(),
    saved = path.join(f.directory, "concurrent-original");
  f.run(
    {},
    `
    const actual=fs.lstat; let reads=0;
    fs.lstat=async(file,...args)=>{
      if(String(file)===${JSON.stringify(partial)} && ++reads===2) {
        await fs.rename(file,${JSON.stringify(saved)});
        await fs.writeFile(file,'replacement');
        const old=new Date(Date.now()-3*86400000); await fs.utimes(file,old,old);
      }
      return actual(file,...args);
    };
  `,
  );
  assert.equal(readFileSync(partial, "utf8"), "replacement");
  assert.equal(readFileSync(saved, "utf8"), "interrupted backup");
});

test("关闭备份且目录不存在时跳过临时清理，不创建备份目录", (t) => {
  const f = fixture(t, false);
  assert.equal(f.run().ok, true);
  assert.equal(existsSync(f.backupDir), false);
});
