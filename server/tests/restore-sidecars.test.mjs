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

function fixture(t) {
  const directory = mkdtempSync(
      path.join(os.tmpdir(), "outdoors-restore-sidecars-"),
    ),
    source = path.join(directory, "snapshot.sqlite"),
    destination = path.join(directory, "restored"),
    target = path.join(destination, "app.sqlite"),
    old = path.join(directory, "old.sqlite"),
    key = Buffer.alloc(32, 71);
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(
      path.basename(directory).startsWith("outdoors-restore-sidecars-"),
    );
    rmSync(directory, { recursive: true, force: true });
  });
  mkdirSync(destination);
  const db = new DatabaseSync(source);
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE records(value TEXT); INSERT INTO records VALUES('snapshot'); PRAGMA wal_checkpoint(TRUNCATE)",
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
  function run(script) {
    return spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          import assert from 'node:assert/strict';
          import fs from 'node:fs/promises';
          import path from 'node:path';
          import {syncBuiltinESMExports} from 'node:module';
          const source=process.argv[1],target=process.argv[2],encrypted=source+'.enc';
          ${script}
        `,
        source,
        target,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, BACKUP_ENCRYPTION_KEY: "cd".repeat(32) },
      },
    );
  }
  const importAndEncrypt = `
    const {encryptBackup,restoreEncrypted}=await import(${JSON.stringify(new URL("../offsite.mjs", import.meta.url).href)});
    await encryptBackup(source,encrypted,Buffer.alloc(32,71));
  `;
  return { source, destination, target, key, wal, shm, run, importAndEncrypt };
}

for (const suffix of ["-wal", "-shm", "-journal"]) {
  test(`加密恢复拒绝残留${suffix}且保留原文件与已有密钥`, (t) => {
    const f = fixture(t),
      residual =
        suffix === "-wal"
          ? f.wal
          : suffix === "-shm"
            ? f.shm
            : Buffer.from("preserve rollback journal for operator");
    writeFileSync(f.target + suffix, residual);
    if (suffix === "-wal") writeFileSync(f.target + "-shm", f.shm);
    writeFileSync(path.join(f.destination, ".mfa-key"), f.key);
    const before = readFileSync(f.source),
      result = f.run(`
        ${f.importAndEncrypt}
        await assert.rejects(restoreEncrypted(encrypted,target),/SQLite.*辅助文件/);
      `);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(f.target), false);
    assert.deepEqual(readFileSync(f.target + suffix), residual);
    assert.deepEqual(readFileSync(path.join(f.destination, ".mfa-key")), f.key);
    assert.deepEqual(readFileSync(f.source), before);
    assert.ok(
      !readdirSync(f.destination).some((name) => name.includes(".part")),
    );
  });
}

test("恢复发布前再次检查迟到的WAL，失败回收自有密钥但保留侧文件", (t) => {
  const f = fixture(t);
  writeFileSync(f.source + ".stale-wal", f.wal);
  const result = f.run(`
    const original=fs.link;
    fs.link=async (source,destination)=>{
      const result=await original(source,destination);
      if(destination===path.join(path.dirname(target),'.mfa-key'))
        await fs.copyFile(process.argv[1]+'.stale-wal',target+'-wal');
      return result;
    };
    syncBuiltinESMExports();
    ${f.importAndEncrypt}
    await assert.rejects(restoreEncrypted(encrypted,target),/SQLite.*辅助文件/);
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(f.target), false);
  assert.deepEqual(readFileSync(f.target + "-wal"), f.wal);
  assert.deepEqual(readdirSync(f.destination), ["app.sqlite-wal"]);
});

test("无残留辅助文件时恢复快照内容且不混入旧WAL", (t) => {
  const f = fixture(t),
    result = f.run(`
      ${f.importAndEncrypt}
      const restored=await restoreEncrypted(encrypted,target);
      assert.equal(restored.mfaKeyRestored,true);
    `);
  assert.equal(result.status, 0, result.stderr);
  const restored = new DatabaseSync(f.target);
  try {
    assert.equal(
      restored.prepare("SELECT value FROM records").get().value,
      "snapshot",
    );
    assert.equal(
      restored.prepare("PRAGMA quick_check").get().quick_check,
      "ok",
    );
  } finally {
    restored.close();
  }
  assert.deepEqual(readFileSync(path.join(f.destination, ".mfa-key")), f.key);
});
