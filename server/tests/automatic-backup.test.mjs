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
  rmSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { openStore } from "../store.mjs";

function setup(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "outdoors-auto-backup-")),
    dbPath = path.join(dir, "app.sqlite"),
    backupDir = path.join(dir, "backups"),
    key = Buffer.alloc(32, 71);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  openStore(dbPath).close();
  mkdirSync(backupDir);
  writeFileSync(path.join(dir, ".mfa-key"), key);
  const config = { dbPath, backupDir, keep: 2, force: true, backupHours: 24 };
  const worker = new URL("../maintenance-worker.mjs", import.meta.url).href;
  const run = (hook = "") =>
    spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          import fs from 'node:fs/promises';
          import {syncBuiltinESMExports} from 'node:module';
          ${hook}
          syncBuiltinESMExports();
          process.argv[2]=${JSON.stringify(JSON.stringify(config))};
          await import(${JSON.stringify(worker)});
        `,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          APP_ENCRYPTION_KEY: "",
          S3_BACKUP_BUCKET: "",
          ALERT_WEBHOOK_URL: "",
          ARCHIVE_AFTER_DAYS: "365",
        },
      },
    );
  return { dir, dbPath, backupDir, key, run };
}

test("自动备份密钥准备失败不发布孤立数据库，已有配对快照保持原样", (t) => {
  const f = setup(t),
    old = path.join(f.backupDir, "auto-2020-01-01T00-00-00-000Z.sqlite");
  copyFileSync(f.dbPath, old);
  writeFileSync(old + ".mfa-key", f.key);
  const before = readFileSync(old);
  const result = f.run(`
    const original=fs.writeFile;
    fs.writeFile=async (file,...args)=>{
      if(String(file).endsWith('.mfa-key')) throw new Error('sidecar write failure');
      return original(file,...args);
    };
  `);
  assert.notEqual(result.status, 0, result.stderr);
  assert.deepEqual(
    readdirSync(f.backupDir).sort(),
    [path.basename(old), path.basename(old) + ".mfa-key"].sort(),
  );
  assert.deepEqual(readFileSync(old), before);
  assert.deepEqual(readFileSync(old + ".mfa-key"), f.key);
});

test("自动备份轮换只计算完整数据库和密钥配对，孤立文件不能挤掉有效备份", (t) => {
  const f = setup(t),
    older = "auto-2020-01-01T00-00-00-000Z.sqlite",
    recent = "auto-2021-01-01T00-00-00-000Z.sqlite",
    orphan = "auto-2099-01-01T00-00-00-000Z.sqlite",
    corrupt = "auto-2098-01-01T00-00-00-000Z.sqlite",
    badKey = "auto-2097-01-01T00-00-00-000Z.sqlite";
  for (const name of [older, recent]) {
    copyFileSync(f.dbPath, path.join(f.backupDir, name));
    writeFileSync(path.join(f.backupDir, name + ".mfa-key"), f.key);
  }
  copyFileSync(f.dbPath, path.join(f.backupDir, orphan));
  writeFileSync(path.join(f.backupDir, corrupt), Buffer.alloc(1024));
  writeFileSync(path.join(f.backupDir, corrupt + ".mfa-key"), f.key);
  copyFileSync(f.dbPath, path.join(f.backupDir, badKey));
  writeFileSync(path.join(f.backupDir, badKey + ".mfa-key"), Buffer.alloc(31));
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(path.join(f.backupDir, recent)));
  assert.ok(existsSync(path.join(f.backupDir, recent + ".mfa-key")));
  assert.ok(existsSync(path.join(f.backupDir, orphan)));
  assert.ok(existsSync(path.join(f.backupDir, corrupt)));
  assert.ok(existsSync(path.join(f.backupDir, badKey)));
  assert.equal(existsSync(path.join(f.backupDir, older)), false);
  const paired = readdirSync(f.backupDir).filter(
    (name) =>
      name.endsWith(".sqlite") &&
      ![corrupt, badKey].includes(name) &&
      existsSync(path.join(f.backupDir, name + ".mfa-key")),
  );
  assert.equal(paired.length, 2);
  for (const name of paired) {
    const db = new DatabaseSync(path.join(f.backupDir, name), {
      readOnly: true,
    });
    try {
      assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
      assert.deepEqual(
        readFileSync(path.join(f.backupDir, name + ".mfa-key")),
        f.key,
      );
    } finally {
      db.close();
    }
  }
});

test("自动备份发布竞争不覆盖既有目标，失败清理不删除已被替换的密钥", (t) => {
  for (const replaceKey of [false, true]) {
    const f = setup(t);
    const result = f.run(`
      const original=fs.link;
      fs.link=async (source,target)=>{
        if(String(target).endsWith('.sqlite')) {
          if(${replaceKey}) {
            await fs.unlink(target+'.mfa-key');
            await fs.writeFile(target+'.mfa-key','foreign-key');
            throw new Error('simulated database publish failure');
          }
          await fs.writeFile(target,'foreign-database');
        }
        return original(source,target);
      };
    `);
    assert.notEqual(result.status, 0, result.stderr);
    const files = readdirSync(f.backupDir);
    assert.equal(files.length, 1);
    assert.ok(!files[0].includes(".part"));
    assert.equal(
      readFileSync(path.join(f.backupDir, files[0]), "utf8"),
      replaceKey ? "foreign-key" : "foreign-database",
    );
  }
});
