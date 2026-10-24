import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  readdirSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { openStore } from "../store.mjs";

function fixture(t) {
  const directory = mkdtempSync(
      path.join(os.tmpdir(), "outdoors-backup-sidecars-"),
    ),
    source = path.join(directory, "app.sqlite"),
    destination = path.join(directory, "backups"),
    target = path.join(destination, "manual.sqlite"),
    old = path.join(directory, "old.sqlite"),
    key = Buffer.alloc(32, 71);
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("outdoors-backup-sidecars-"));
    rmSync(directory, { recursive: true, force: true });
  });
  mkdirSync(destination);
  writeFileSync(path.join(directory, ".mfa-key"), key);
  const db = openStore(source);
  db.exec(
    "CREATE TABLE records(value TEXT); INSERT INTO records VALUES('snapshot'); PRAGMA wal_checkpoint(TRUNCATE)",
  );
  db.close();
  copyFileSync(source, old);
  const stale = new DatabaseSync(old);
  stale.exec(
    "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE records SET value='unrelated-stale-WAL'",
  );
  const wal = readFileSync(old + "-wal"),
    shm = readFileSync(old + "-shm");
  stale.close();
  writeFileSync(source + ".stale-wal", wal);
  const env = {
    ...process.env,
    DB_PATH: source,
    APP_ENCRYPTION_KEY: "",
    S3_BACKUP_BUCKET: "",
    ALERT_WEBHOOK_URL: "",
    ARCHIVE_AFTER_DAYS: "365",
  };
  function manual(hook = "") {
    return spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          import fs from 'node:fs';
          import {syncBuiltinESMExports} from 'node:module';
          const source=process.argv[1],target=process.argv[2];
          ${hook}
          syncBuiltinESMExports();
          process.argv[2]=target;
          await import(${JSON.stringify(new URL("../backup.mjs", import.meta.url).href)});
        `,
        source,
        target,
      ],
      { encoding: "utf8", env },
    );
  }
  return { directory, source, destination, target, key, wal, shm, env, manual };
}

for (const suffix of ["-wal", "-shm", "-journal"]) {
  test(`手动备份拒绝残留${suffix}，不发布错误快照且保留原文件`, (t) => {
    const f = fixture(t),
      residual =
        suffix === "-wal"
          ? f.wal
          : suffix === "-shm"
            ? f.shm
            : Buffer.from("preserve rollback journal for operator");
    writeFileSync(f.target + suffix, residual);
    const sourceBefore = readFileSync(f.source),
      result = f.manual();
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /SQLite.*辅助文件/);
    assert.deepEqual(readdirSync(f.destination), [
      path.basename(f.target) + suffix,
    ]);
    assert.deepEqual(readFileSync(f.target + suffix), residual);
    assert.deepEqual(readFileSync(f.source), sourceBefore);
    assert.deepEqual(readFileSync(path.join(f.directory, ".mfa-key")), f.key);
  });
}

test("手动备份发布前拒绝迟到WAL，仅回收本次发布密钥", (t) => {
  const f = fixture(t),
    result = f.manual(`
      const original=fs.linkSync;
      fs.linkSync=(source,destination)=>{
        const result=original(source,destination);
        if(destination===target+'.mfa-key')
          fs.copyFileSync(process.argv[1]+'.stale-wal',target+'-wal');
        return result;
      };
    `);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /SQLite.*辅助文件/);
  assert.deepEqual(readdirSync(f.destination), [
    path.basename(f.target) + "-wal",
  ]);
  assert.deepEqual(readFileSync(f.target + "-wal"), f.wal);
  assert.equal(existsSync(f.target), false);
});

test("自动备份发布前拒绝迟到WAL，不把新快照登记为成功且保留旧备份", (t) => {
  const f = fixture(t),
    old = path.join(f.destination, "auto-2020-01-01T00-00-00-000Z.sqlite");
  copyFileSync(f.source, old);
  writeFileSync(old + ".mfa-key", f.key);
  const before = readFileSync(old),
    config = {
      dbPath: f.source,
      backupDir: f.destination,
      keep: 2,
      force: true,
      backupHours: 24,
    },
    result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          import fs from 'node:fs/promises';
          import {syncBuiltinESMExports} from 'node:module';
          const original=fs.link;
          fs.link=async (source,destination)=>{
            const result=await original(source,destination);
            if(String(destination).endsWith('.sqlite.mfa-key'))
              await fs.copyFile(${JSON.stringify(f.source + ".stale-wal")},String(destination).slice(0,-8)+'-wal');
            return result;
          };
          syncBuiltinESMExports();
          process.argv[2]=${JSON.stringify(JSON.stringify(config))};
          await import(${JSON.stringify(new URL("../maintenance-worker.mjs", import.meta.url).href)});
        `,
      ],
      { encoding: "utf8", env: f.env },
    );
  assert.notEqual(result.status, 0, result.stdout);
  const db = new DatabaseSync(f.source, { readOnly: true });
  try {
    assert.equal(
      db.prepare("SELECT 1 FROM maintenance_state WHERE key='backup'").get(),
      undefined,
    );
    const failure = JSON.parse(
      db
        .prepare("SELECT value FROM maintenance_state WHERE key='maintenance'")
        .get().value,
    );
    assert.equal(failure.ok, false);
    assert.match(failure.error, /SQLite.*辅助文件/);
  } finally {
    db.close();
  }
  assert.deepEqual(readFileSync(old), before);
  assert.deepEqual(readFileSync(old + ".mfa-key"), f.key);
  const files = readdirSync(f.destination),
    residual = files.filter((name) => name.endsWith("-wal"));
  assert.equal(residual.length, 1);
  assert.equal(files.length, 3);
  assert.deepEqual(readFileSync(path.join(f.destination, residual[0])), f.wal);
});
