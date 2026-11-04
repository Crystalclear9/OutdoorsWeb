import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { createCipheriv, randomBytes } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { uploadOffsite, restoreEncrypted } from "../offsite.mjs";
import { verifyMfaKey } from "../backup-key.mjs";

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "outdoors-live-wal-")),
    source = path.join(dir, "app.sqlite"),
    key = Buffer.alloc(32, 71);
  const envNames = [
    "APP_ENCRYPTION_KEY",
    "BACKUP_ENCRYPTION_KEY",
    "S3_BACKUP_BUCKET",
    "S3_BACKUP_ENDPOINT",
    "MIN_FREE_DISK_MB",
  ];
  const previous = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]]),
  );
  process.env.APP_ENCRYPTION_KEY = "";
  process.env.BACKUP_ENCRYPTION_KEY = "cd".repeat(32);
  process.env.S3_BACKUP_BUCKET = "isolated-test";
  process.env.MIN_FREE_DISK_MB = "0";
  delete process.env.S3_BACKUP_ENDPOINT;
  await fs.writeFile(path.join(dir, ".mfa-key"), key);
  const db = new DatabaseSync(source);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE business(value TEXT,payload BLOB); CREATE TABLE mfa(secret TEXT);",
  );
  db.prepare("INSERT INTO business VALUES(?,zeroblob(524288))").run(
    "committed inside live WAL",
  );
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  const secret = Buffer.concat([
    iv,
    cipher.update("JBSWY3DPEHPK3PXP"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
  db.prepare("INSERT INTO mfa VALUES(?)").run(secret);
  t.after(async () => {
    db.close();
    for (const name of envNames) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("outdoors-live-wal-"));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const before = {
    main: await fs.readFile(source),
    wal: await fs.readFile(source + "-wal"),
    key: await fs.readFile(path.join(dir, ".mfa-key")),
  };
  const unchanged = async () => {
    assert.deepEqual(await fs.readFile(source), before.main);
    assert.deepEqual(await fs.readFile(source + "-wal"), before.wal);
    assert.deepEqual(await fs.readFile(path.join(dir, ".mfa-key")), before.key);
    assert.deepEqual(
      (await fs.readdir(dir)).filter(
        (name) =>
          name.startsWith(".offsite-") || name.endsWith(".encrypted.part"),
      ),
      [],
    );
    assert.equal(
      db.prepare("SELECT value FROM business").get().value,
      "committed inside live WAL",
    );
  };
  return { dir, source, key, db, unchanged };
}
function recorder() {
  let content,
    metadata,
    sends = 0;
  return {
    get content() {
      return content;
    },
    get sends() {
      return sends;
    },
    async send(command) {
      sends++;
      if (command.constructor.name === "PutObjectCommand") {
        const chunks = [];
        for await (const part of command.input.Body) chunks.push(part);
        content = Buffer.concat(chunks);
        metadata = command.input.Metadata;
        return {};
      }
      if (command.constructor.name === "HeadObjectCommand")
        return { ContentLength: content.length, Metadata: metadata };
      return {
        Body: (async function* () {
          yield content;
        })(),
      };
    },
  };
}

test("直接当前WAL库先取得一致快照，真实加密恢复保留业务与MFA且不改原库", async (t) => {
  const f = await fixture(t),
    client = recorder();
  assert.ok(
    (await fs.stat(f.source + "-wal")).size > (await fs.stat(f.source)).size,
  );
  assert.equal(
    (await uploadOffsite(f.source, f.source, client)).verified,
    true,
  );
  await f.unchanged();
  const encrypted = path.join(f.dir, "captured.enc"),
    recoveredDir = path.join(f.dir, "recovered");
  await fs.writeFile(encrypted, client.content);
  await fs.mkdir(recoveredDir);
  const target = path.join(recoveredDir, "app.sqlite");
  await restoreEncrypted(encrypted, target);
  const restored = new DatabaseSync(target, { readOnly: true });
  try {
    assert.equal(
      restored.prepare("SELECT value,length(payload) bytes FROM business").get()
        .value,
      "committed inside live WAL",
    );
    assert.equal(
      restored.prepare("SELECT length(payload) bytes FROM business").get()
        .bytes,
      524288,
    );
    verifyMfaKey(
      restored,
      await fs.readFile(path.join(recoveredDir, ".mfa-key")),
    );
    assert.equal(restored.prepare("SELECT COUNT(*) n FROM mfa").get().n, 1);
  } finally {
    restored.close();
  }
});

test("直接当前库的MFA错配与空间不足均在外发前拒绝，无私有临时残留", async (t) => {
  const f = await fixture(t),
    client = recorder();
  process.env.APP_ENCRYPTION_KEY = "ab".repeat(32);
  await assert.rejects(
    uploadOffsite(f.source, f.source, client),
    /不匹配或密文损坏/,
  );
  process.env.APP_ENCRYPTION_KEY = "";
  const original = fs.statfs;
  fs.statfs = async () => ({ bavail: 65536, bsize: 1 });
  syncBuiltinESMExports();
  try {
    await assert.rejects(uploadOffsite(f.source, f.source, client), /空间不足/);
  } finally {
    fs.statfs = original;
    syncBuiltinESMExports();
  }
  assert.equal(client.sends, 0);
  await f.unchanged();
});

test("直接WAL库遇到S3早拒绝也关闭并清理本次快照和密文", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    uploadOffsite(f.source, f.source, {
      async send() {
        throw new Error("S3 rejected before body open");
      },
    }),
    /S3 rejected/,
  );
  await f.unchanged();
});

test("当前库硬链接别名仍读取配置路径的WAL，不把同一主文件当成冻结快照", async (t) => {
  const f = await fixture(t),
    alias = path.join(f.dir, "alias.sqlite"),
    client = recorder();
  await fs.link(f.source, alias);
  assert.equal((await uploadOffsite(alias, f.source, client)).verified, true);
  const encrypted = path.join(f.dir, "alias.enc"),
    restoredDir = path.join(f.dir, "alias-restored");
  await fs.writeFile(encrypted, client.content);
  await fs.mkdir(restoredDir);
  const target = path.join(restoredDir, "app.sqlite");
  await restoreEncrypted(encrypted, target);
  const restored = new DatabaseSync(target, { readOnly: true });
  try {
    assert.equal(
      restored.prepare("SELECT value FROM business").get().value,
      "committed inside live WAL",
    );
    verifyMfaKey(restored, f.key);
  } finally {
    restored.close();
  }
  await f.unchanged();
});

test("独立输入带有WAL或辅助文件时拒绝外发，不能把活动库冒充发布快照", async (t) => {
  const f = await fixture(t),
    client = recorder();
  await fs.writeFile(f.source + ".mfa-key", f.key);
  await assert.rejects(
    uploadOffsite(f.source, path.join(f.dir, "another.sqlite"), client),
    /辅助文件/,
  );
  assert.equal(client.sends, 0);
  await f.unchanged();
});
