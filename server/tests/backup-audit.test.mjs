import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { uploadOffsite, restoreEncrypted } from "../offsite.mjs";

const script = fileURLToPath(new URL("../backup.mjs", import.meta.url));
function setup(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "outdoors-backup-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, "source.sqlite"),
    target = path.join(dir, "snapshot.sqlite");
  const key = randomBytes(32),
    iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update("verified MFA secret"),
    cipher.final(),
  ]);
  const db = new DatabaseSync(source);
  db.exec("CREATE TABLE proof(value BLOB,iv BLOB,tag BLOB)");
  db.prepare("INSERT INTO proof VALUES(?,?,?)").run(
    encrypted,
    iv,
    cipher.getAuthTag(),
  );
  db.close();
  writeFileSync(path.join(dir, ".mfa-key"), key);
  const run = (configured = "") =>
    spawnSync(process.execPath, [script, target], {
      encoding: "utf8",
      env: { ...process.env, DB_PATH: source, APP_ENCRYPTION_KEY: configured },
    });
  return { dir, source, target, key, run };
}

test("手动备份严格拒绝非法环境密钥及损坏文件，不留下假成功快照", (t) => {
  const f = setup(t);
  for (const value of [
    "not-a-key",
    "ab".repeat(32) + "garbage",
    "ab".repeat(31),
  ]) {
    const result = f.run(value);
    assert.notEqual(result.status, 0);
    assert.ok(!result.stdout.includes("一致性备份已保存"));
    assert.equal(existsSync(f.target), false);
  }
  writeFileSync(path.join(f.dir, ".mfa-key"), Buffer.alloc(31));
  assert.notEqual(f.run().status, 0);
  assert.equal(existsSync(f.target), false);
  assert.equal(
    readdirSync(f.dir).some((name) => name.includes(".part")),
    false,
  );
});

test("手动备份不覆盖已有数据库或孤立密钥文件", (t) => {
  const f = setup(t);
  writeFileSync(f.target + ".mfa-key", "existing-key");
  assert.notEqual(f.run().status, 0);
  assert.equal(existsSync(f.target), false);
  assert.equal(readFileSync(f.target + ".mfa-key", "utf8"), "existing-key");
  writeFileSync(f.target, "existing-database");
  assert.notEqual(f.run().status, 0);
  assert.equal(readFileSync(f.target, "utf8"), "existing-database");
});

test("手动备份数据库通过检查且配套密钥能解密原MFA内容，支持文件及大写环境密钥", (t) => {
  const f = setup(t);
  for (const configured of ["", f.key.toString("hex").toUpperCase()]) {
    const result = f.run(configured);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes("一致性备份已保存"));
    const copy = new DatabaseSync(f.target, { readOnly: true });
    try {
      assert.equal(copy.prepare("PRAGMA quick_check").get().quick_check, "ok");
      const row = copy.prepare("SELECT * FROM proof").get();
      const recoveredKey = readFileSync(f.target + ".mfa-key");
      const decipher = createDecipheriv("aes-256-gcm", recoveredKey, row.iv);
      decipher.setAuthTag(row.tag);
      assert.equal(
        Buffer.concat([
          decipher.update(row.value),
          decipher.final(),
        ]).toString(),
        "verified MFA secret",
      );
    } finally {
      copy.close();
    }
    rmSync(f.target);
    rmSync(f.target + ".mfa-key");
  }
  assert.equal(
    readdirSync(f.dir).some((name) => name.includes(".part")),
    false,
  );
});

test("异机快照使用配套密钥而非当前密钥，缺失或损坏侧车拒绝上传", async (t) => {
  const f = setup(t);
  assert.equal(f.run().status, 0);
  const names = [
    "APP_ENCRYPTION_KEY",
    "BACKUP_ENCRYPTION_KEY",
    "S3_BACKUP_BUCKET",
    "S3_BACKUP_ENDPOINT",
  ];
  const previous = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  t.after(() => {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  });
  process.env.APP_ENCRYPTION_KEY = "fe".repeat(32);
  process.env.BACKUP_ENCRYPTION_KEY = "cd".repeat(32);
  process.env.S3_BACKUP_BUCKET = "test-private";
  delete process.env.S3_BACKUP_ENDPOINT;
  let uploaded,
    metadata,
    sends = 0;
  const fake = {
    async send(command) {
      sends++;
      if (command.constructor.name === "PutObjectCommand") {
        const chunks = [];
        for await (const part of command.input.Body) chunks.push(part);
        uploaded = Buffer.concat(chunks);
        metadata = command.input.Metadata;
        return {};
      }
      if (command.constructor.name === "HeadObjectCommand")
        return { ContentLength: uploaded.length, Metadata: metadata };
      return {
        Body: (async function* () {
          yield uploaded;
        })(),
      };
    },
  };
  assert.equal((await uploadOffsite(f.target, f.source, fake)).verified, true);
  const encrypted = path.join(f.dir, "offsite.enc");
  writeFileSync(encrypted, uploaded);
  const recoveryDir = path.join(f.dir, "recovered");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(recoveryDir);
  await restoreEncrypted(encrypted, path.join(recoveryDir, "restored.sqlite"));
  assert.deepEqual(readFileSync(path.join(recoveryDir, ".mfa-key")), f.key);
  const count = sends;
  rmSync(f.target + ".mfa-key");
  await assert.rejects(uploadOffsite(f.target, f.source, fake));
  writeFileSync(f.target + ".mfa-key", Buffer.alloc(31));
  await assert.rejects(uploadOffsite(f.target, f.source, fake));
  assert.equal(sends, count);
});

test("压缩前侧车写入失败清理不完整快照，原始数据库保持不变", (t) => {
  const f = setup(t);
  const before = readFileSync(f.source);
  const moduleUrl = new URL("../compaction.mjs", import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    const original = fs.writeFile;
    fs.writeFile = async (file, ...args) => {
      if (String(file).endsWith('.mfa-key')) {
        const error = new Error('simulated sidecar write failure');
        error.code = 'EACCES';
        throw error;
      }
      return original(file, ...args);
    };
    syncBuiltinESMExports();
    const { compactDatabase } = await import(${JSON.stringify(moduleUrl)});
    await assert.rejects(compactDatabase(process.argv[1]), /simulated sidecar write failure/);
  `,
      f.source,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, APP_ENCRYPTION_KEY: "" },
    },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(readFileSync(f.source), before);
  assert.deepEqual(readdirSync(path.join(f.dir, "backups")), []);
});
