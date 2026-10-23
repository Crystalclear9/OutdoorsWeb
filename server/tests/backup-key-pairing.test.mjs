import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createCipheriv, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { openStore } from "../store.mjs";
import { verifyMfaKey } from "../backup-key.mjs";
import { compactDatabase } from "../compaction.mjs";
import { encryptBackup, uploadOffsite, restoreEncrypted } from "../offsite.mjs";

function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "outdoors-key-pairing-"));
  t.after(() => {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("outdoors-key-pairing-"));
    rmSync(dir, { recursive: true, force: true });
  });
  const source = path.join(dir, "app.sqlite"),
    backupDir = path.join(dir, "backups");
  const key = Buffer.alloc(32, 71),
    wrong = Buffer.from(key);
  wrong[0] ^= 1;
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  const secret = Buffer.concat([
    iv,
    cipher.update("JBSWY3DPEHPK3PXP"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
  const db = openStore(source);
  db.prepare(
    "INSERT INTO users(id,email,password_hash,role,company,contact,phone,created) VALUES('owner','pair@test.local','fixture','enterprise','企业','联系人','','2020-01-01T00:00:00.000Z')",
  ).run();
  db.prepare("INSERT INTO mfa(user_id,secret,enabled) VALUES('owner',?,1)").run(
    secret,
  );
  db.close();
  mkdirSync(backupDir);
  writeFileSync(path.join(dir, ".mfa-key"), key);
  const snapshot = (name, sidecar = key) => {
    const file = path.join(backupDir, name);
    copyFileSync(source, file);
    writeFileSync(file + ".mfa-key", sidecar);
    return file;
  };
  const environment = (extra = {}) => ({
    ...process.env,
    APP_ENCRYPTION_KEY: "",
    S3_BACKUP_BUCKET: "",
    ALERT_WEBHOOK_URL: "",
    ARCHIVE_AFTER_DAYS: "365",
    ...extra,
  });
  const worker = (extra = {}, overrides = {}) =>
    spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../maintenance-worker.mjs", import.meta.url)),
        JSON.stringify({
          dbPath: source,
          backupDir,
          keep: 2,
          force: true,
          backupHours: 24,
          ...overrides,
        }),
      ],
      { encoding: "utf8", env: environment(extra) },
    );
  return { dir, source, backupDir, key, wrong, snapshot, environment, worker };
}

test("MFA配对验证兼容旧库和空表，并拒绝等长错误密钥及损坏密文", (t) => {
  const f = fixture(t),
    old = new DatabaseSync(":memory:");
  try {
    verifyMfaKey(old, f.key);
    old.exec("CREATE TABLE mfa(secret TEXT)");
    verifyMfaKey(old, f.key);
  } finally {
    old.close();
  }
  const db = new DatabaseSync(f.source);
  try {
    verifyMfaKey(db, f.key);
    assert.throws(() => verifyMfaKey(db, f.wrong), /不匹配或密文损坏/);
    const encoded = db.prepare("SELECT secret FROM mfa").get().secret;
    const bytes = Buffer.from(encoded, "base64");
    bytes[15] ^= 1;
    db.prepare("UPDATE mfa SET secret=?").run(bytes.toString("base64"));
    assert.throws(() => verifyMfaKey(db, f.key), /不匹配或密文损坏/);
  } finally {
    db.close();
  }
});

test("等长错误MFA密钥的历史备份不占保留名额，不挤掉可恢复快照", (t) => {
  const f = fixture(t);
  const older = f.snapshot("auto-2020-01-01T00-00-00-000Z.sqlite");
  const valid = f.snapshot("auto-2021-01-01T00-00-00-000Z.sqlite");
  const damaged = f.snapshot("auto-2022-01-01T00-00-00-000Z.sqlite", f.wrong);
  const result = f.worker();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(older), false);
  assert.equal(existsSync(valid), true);
  assert.equal(existsSync(damaged), true);
  let recoverable = 0;
  for (const name of readdirSync(f.backupDir).filter((n) =>
    n.endsWith(".sqlite"),
  )) {
    const file = path.join(f.backupDir, name),
      db = new DatabaseSync(file, { readOnly: true });
    try {
      verifyMfaKey(db, readFileSync(file + ".mfa-key"));
      recoverable++;
    } catch {
      assert.equal(file, damaged);
    } finally {
      db.close();
    }
  }
  assert.equal(recoverable, 2);
});

test("最近备份密钥等长损坏时，未到周期也补备并保留错误配对调查", (t) => {
  const f = fixture(t);
  f.snapshot("auto-2021-01-01T00-00-00-000Z.sqlite");
  const damaged = f.snapshot("auto-2022-01-01T00-00-00-000Z.sqlite", f.wrong);
  const before = new DatabaseSync(f.source);
  before
    .prepare("INSERT INTO maintenance_state(key,value) VALUES('backup',?)")
    .run(
      JSON.stringify({
        at: new Date().toISOString(),
        file: path.basename(damaged),
      }),
    );
  before.close();
  const result = f.worker({}, { force: false });
  assert.equal(result.status, 0, result.stderr);
  const after = new DatabaseSync(f.source, { readOnly: true });
  try {
    const latest = JSON.parse(
      after
        .prepare("SELECT value FROM maintenance_state WHERE key='backup'")
        .get().value,
    );
    assert.notEqual(latest.file, path.basename(damaged));
    const snapshot = new DatabaseSync(path.join(f.backupDir, latest.file), {
      readOnly: true,
    });
    try {
      verifyMfaKey(
        snapshot,
        readFileSync(path.join(f.backupDir, latest.file) + ".mfa-key"),
      );
    } finally {
      snapshot.close();
    }
  } finally {
    after.close();
  }
  assert.equal(existsSync(damaged), true);
  assert.deepEqual(readFileSync(damaged + ".mfa-key"), f.wrong);
});

test("自动新快照密钥不匹配时不发布或轮换，已有可恢复备份保留", (t) => {
  const f = fixture(t);
  f.snapshot("auto-2021-01-01T00-00-00-000Z.sqlite");
  const before = readdirSync(f.backupDir).sort();
  const result = f.worker({ APP_ENCRYPTION_KEY: f.wrong.toString("hex") });
  assert.notEqual(result.status, 0);
  const db = new DatabaseSync(f.source, { readOnly: true });
  try {
    assert.match(
      JSON.parse(
        db
          .prepare(
            "SELECT value FROM maintenance_state WHERE key='maintenance'",
          )
          .get().value,
      ).error,
      /不匹配或密文损坏/,
    );
  } finally {
    db.close();
  }
  assert.deepEqual(readdirSync(f.backupDir).sort(), before);
});

test("手动备份与压缩拒绝等长错误密钥，不留下假安全快照或改动原库", async (t) => {
  const f = fixture(t),
    target = path.join(f.dir, "manual.sqlite");
  writeFileSync(path.join(f.dir, ".mfa-key"), f.wrong);
  const before = readFileSync(f.source);
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../backup.mjs", import.meta.url)), target],
    {
      encoding: "utf8",
      env: f.environment({ DB_PATH: f.source }),
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /不匹配或密文损坏/);
  assert.equal(existsSync(target), false);
  assert.equal(existsSync(target + ".mfa-key"), false);
  const previous = process.env.APP_ENCRYPTION_KEY;
  delete process.env.APP_ENCRYPTION_KEY;
  try {
    await assert.rejects(compactDatabase(f.source), /不匹配或密文损坏/);
  } finally {
    if (previous === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = previous;
  }
  assert.deepEqual(readdirSync(f.backupDir), []);
  assert.deepEqual(readFileSync(f.source), before);
  assert.equal(
    readdirSync(f.dir).some((n) => n.includes(".part")),
    false,
  );
});

test("异机上传与加密恢复验证MFA配对，错配不外发也不发布恢复数据库", async (t) => {
  const f = fixture(t),
    source = f.snapshot("auto-2021-01-01T00-00-00-000Z.sqlite", f.wrong);
  const names = [
    "APP_ENCRYPTION_KEY",
    "BACKUP_ENCRYPTION_KEY",
    "MIN_FREE_DISK_MB",
  ];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  t.after(() => {
    for (const name of names)
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
  });
  delete process.env.APP_ENCRYPTION_KEY;
  process.env.BACKUP_ENCRYPTION_KEY = "cd".repeat(32);
  process.env.MIN_FREE_DISK_MB = "0";
  let sends = 0;
  await assert.rejects(
    uploadOffsite(source, f.source, {
      async send() {
        sends++;
      },
    }),
    /不匹配或密文损坏/,
  );
  assert.equal(sends, 0);
  const encrypted = path.join(f.dir, "wrong.enc"),
    directory = path.join(f.dir, "restored");
  mkdirSync(directory);
  await encryptBackup(f.source, encrypted, f.wrong);
  const target = path.join(directory, "app.sqlite");
  await assert.rejects(restoreEncrypted(encrypted, target), /不匹配或密文损坏/);
  assert.deepEqual(readdirSync(directory), []);
  const good = path.join(f.dir, "good.enc");
  await encryptBackup(f.source, good, f.key);
  await restoreEncrypted(good, target);
  const db = new DatabaseSync(target, { readOnly: true });
  try {
    verifyMfaKey(db, readFileSync(path.join(directory, ".mfa-key")));
  } finally {
    db.close();
  }
});
