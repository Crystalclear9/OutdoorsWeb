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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "outdoors-frozen-wal-"));
  const original = path.join(dir, "original.sqlite"),
    source = path.join(dir, "published.sqlite"),
    current = path.join(dir, "current.sqlite"),
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
  const db = new DatabaseSync(original);
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE proof(value TEXT,payload BLOB); CREATE TABLE mfa(secret TEXT); INSERT INTO proof VALUES('fully checkpointed content',zeroblob(524288));",
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
  db.close();
  new DatabaseSync(current).close();
  await fs.copyFile(original, source);
  await fs.writeFile(source + ".mfa-key", key);
  const before = await fs.readFile(source),
    files = (await fs.readdir(dir)).sort();
  assert.equal(before[18], 2, "副本保留真实SQLite WAL格式头");
  t.after(async () => {
    for (const name of envNames) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("outdoors-frozen-wal-"));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { dir, source, current, key, before, files };
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

test("闭库完整WAL格式副本可连续上传并真实恢复业务/MFA，不污染源目录", async (t) => {
  const f = await fixture(t),
    captures = [];
  for (let i = 0; i < 2; i++) {
    const client = recorder();
    assert.equal(
      (await uploadOffsite(f.source, f.current, client)).verified,
      true,
    );
    captures.push(client.content);
    assert.deepEqual((await fs.readdir(f.dir)).sort(), f.files);
    assert.deepEqual(await fs.readFile(f.source), f.before);
    assert.deepEqual(await fs.readFile(f.source + ".mfa-key"), f.key);
  }
  for (let i = 0; i < captures.length; i++) {
    const encrypted = path.join(f.dir, `captured-${i}.enc`),
      destination = path.join(f.dir, `restored-${i}`);
    await fs.writeFile(encrypted, captures[i]);
    await fs.mkdir(destination);
    const target = path.join(destination, "app.sqlite");
    await restoreEncrypted(encrypted, target);
    const restored = new DatabaseSync(target, { readOnly: true });
    try {
      assert.equal(
        restored.prepare("SELECT value FROM proof").get().value,
        "fully checkpointed content",
      );
      assert.equal(
        restored.prepare("SELECT length(payload) bytes FROM proof").get().bytes,
        524288,
      );
      verifyMfaKey(restored, f.key);
    } finally {
      restored.close();
    }
  }
});

test("冻结WAL副本复制期间内容变化时拒绝外发并清理私有复制资源", async (t) => {
  const f = await fixture(t),
    client = recorder(),
    original = fs.copyFile;
  fs.copyFile = async (source, ...args) => {
    await original(source, ...args);
    if (String(source) === f.source)
      await fs.appendFile(f.source, "concurrent change");
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      uploadOffsite(f.source, f.current, client),
      /复制期间|变化/,
    );
  } finally {
    fs.copyFile = original;
    syncBuiltinESMExports();
  }
  assert.equal(client.sends, 0);
  assert.deepEqual((await fs.readdir(f.dir)).sort(), f.files);
  assert.deepEqual(
    await fs.readFile(f.source),
    Buffer.concat([f.before, Buffer.from("concurrent change")]),
  );
});

test("冻结WAL副本被同内容新文件替换时仍拒绝，不以摘要相同掩盖文件身份变化", async (t) => {
  const f = await fixture(t),
    client = recorder(),
    original = fs.copyFile,
    replaced = f.source + ".replaced";
  fs.copyFile = async (source, ...args) => {
    await original(source, ...args);
    if (String(source) === f.source) {
      await fs.rename(f.source, replaced);
      await original(replaced, f.source);
    }
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      uploadOffsite(f.source, f.current, client),
      /复制期间|变化/,
    );
  } finally {
    fs.copyFile = original;
    syncBuiltinESMExports();
  }
  assert.equal(client.sends, 0);
  assert.deepEqual(await fs.readFile(f.source), f.before);
  assert.deepEqual(await fs.readFile(replaced), f.before);
  assert.deepEqual(
    (await fs.readdir(f.dir)).sort(),
    [...f.files, path.basename(replaced)].sort(),
  );
});

test("未知独立WAL硬链接拒绝冻结假设，要求独立副本且不修改任何链接", async (t) => {
  const f = await fixture(t),
    client = recorder(),
    alias = path.join(f.dir, "unknown-hardlink.sqlite");
  await fs.link(f.source, alias);
  await assert.rejects(uploadOffsite(f.source, f.current, client), /硬链接/);
  assert.equal(client.sends, 0);
  assert.deepEqual(await fs.readFile(f.source), f.before);
  assert.deepEqual(await fs.readFile(alias), f.before);
  assert.deepEqual(
    (await fs.readdir(f.dir)).sort(),
    [...f.files, path.basename(alias)].sort(),
  );
});

test("独立快照符号链接不能绕过真实路径的辅助文件门禁", async (t) => {
  const f = await fixture(t),
    client = recorder(),
    alias = path.join(f.dir, "snapshot-alias.sqlite");
  try {
    await fs.symlink(f.source, alias, "file");
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) {
      t.skip("当前系统权限不允许创建文件符号链接");
      return;
    }
    throw error;
  }
  await fs.writeFile(f.source + "-wal", "external WAL marker");
  await assert.rejects(uploadOffsite(alias, f.current, client), /辅助文件/);
  assert.equal(client.sends, 0);
  assert.equal(
    await fs.readFile(f.source + "-wal", "utf8"),
    "external WAL marker",
  );
  assert.deepEqual(await fs.readFile(f.source), f.before);
});

test("冻结WAL副本空间预检包含副本及密文，MFA错配和S3拒绝均无临时残留", async (t) => {
  const f = await fixture(t),
    client = recorder(),
    original = fs.statfs;
  fs.statfs = async () => ({ bavail: f.before.length + 128, bsize: 1 });
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      uploadOffsite(f.source, f.current, client),
      /空间不足/,
    );
  } finally {
    fs.statfs = original;
    syncBuiltinESMExports();
  }
  await fs.writeFile(f.source + ".mfa-key", Buffer.alloc(32, 72));
  await assert.rejects(
    uploadOffsite(f.source, f.current, client),
    /不匹配或密文损坏/,
  );
  await fs.writeFile(f.source + ".mfa-key", f.key);
  await assert.rejects(
    uploadOffsite(f.source, f.current, {
      async send() {
        throw new Error("S3 early rejection");
      },
    }),
    /S3 early rejection/,
  );
  assert.equal(client.sends, 0);
  assert.deepEqual((await fs.readdir(f.dir)).sort(), f.files);
  assert.deepEqual(await fs.readFile(f.source), f.before);
});

for (const suffix of ["-wal", "-shm", "-journal"]) {
  test(`冻结WAL输入已有外部${suffix}时拒绝且保留该文件`, async (t) => {
    const f = await fixture(t),
      client = recorder(),
      sidecar = f.source + suffix;
    await fs.writeFile(sidecar, "external marker");
    await assert.rejects(
      uploadOffsite(f.source, f.current, client),
      /辅助文件/,
    );
    assert.equal(client.sends, 0);
    assert.equal(await fs.readFile(sidecar, "utf8"), "external marker");
    assert.deepEqual(await fs.readFile(f.source), f.before);
  });
}
