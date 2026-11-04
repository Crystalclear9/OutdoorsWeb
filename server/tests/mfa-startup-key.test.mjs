import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createCipheriv, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openStore } from "../store.mjs";
import { createApp } from "../app.mjs";
import { hashPassword } from "../security.mjs";
import { totp } from "../mfa.mjs";
import { client, ADMIN, PASSWORD } from "./helpers.mjs";
import { listenHttp } from "./http-listen.mjs";

const secret = "JBSWY3DPEHPK3PXP";
async function fixture(t, enabled = 1) {
  const previous = process.env.APP_ENCRYPTION_KEY;
  delete process.env.APP_ENCRYPTION_KEY;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "outdoors-mfa-startup-")),
    dbPath = path.join(dir, "app.sqlite"),
    keyPath = path.join(dir, ".mfa-key"),
    key = randomBytes(32),
    apps = [];
  t.after(async () => {
    for (const app of apps) await app.close();
    if (previous === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = previous;
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.match(path.basename(dir), /^outdoors-mfa-startup-[A-Za-z0-9]{6}$/);
    await fs.rm(dir, { recursive: true, force: true });
  });
  const db = openStore(dbPath);
  try {
    db.prepare(
      "INSERT INTO users(id,email,password_hash,role,company,contact,phone,created,is_super) VALUES('root',?,?,'admin','活动中心','管理员','','2026-01-01T00:00:00Z',1)",
    ).run(ADMIN.email, await hashPassword(PASSWORD));
    if (enabled !== null) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv),
        encrypted = Buffer.concat([
          iv,
          cipher.update(secret),
          cipher.final(),
          cipher.getAuthTag(),
        ]).toString("base64");
      db.prepare(
        "INSERT INTO mfa(user_id,secret,enabled) VALUES('root',?,?)",
      ).run(encrypted, enabled);
    }
  } finally {
    db.close();
  }
  await fs.writeFile(keyPath, key);
  return {
    dbPath,
    keyPath,
    key,
    async start() {
      const app = await createApp({
        dbPath,
        captchaTestAnswer: "246789",
        maintenance: { scheduled: false },
      });
      apps.push(app);
      return app;
    },
    records() {
      const db = openStore(dbPath);
      try {
        return {
          mfa: db
            .prepare("SELECT * FROM mfa")
            .all()
            .map((r) => ({ ...r })),
          sessions: db.prepare("SELECT COUNT(*) n FROM sessions").get().n,
        };
      } finally {
        db.close();
      }
    },
  };
}

test("长度正确但不匹配的文件密钥在启动时拒绝，原密文和文件保留", async (t) => {
  const f = await fixture(t),
    wrong = Buffer.from(f.key),
    before = f.records();
  wrong[0] ^= 1;
  await fs.writeFile(f.keyPath, wrong);
  await assert.rejects(f.start(), /MFA密钥与数据库不匹配或密文损坏/);
  assert.deepEqual(await fs.readFile(f.keyPath), wrong);
  assert.deepEqual(f.records(), before);
  // Startup failure closed its database handle, so a repaired retry can start.
  await fs.writeFile(f.keyPath, f.key);
  await f.start();
});

for (const enabled of [0, 1])
  test(`已有${enabled ? "已启用" : "待启用"}MFA记录时缺失侧车不生成替代密钥`, async (t) => {
    const f = await fixture(t, enabled),
      before = f.records();
    await fs.rename(f.keyPath, f.keyPath + ".saved");
    await assert.rejects(f.start(), /MFA密钥文件缺失/);
    await assert.rejects(fs.stat(f.keyPath), { code: "ENOENT" });
    assert.deepEqual(f.records(), before);
  });

test("环境密钥同样检查配对，正确环境密钥优先于无关侧车且不改写它", async (t) => {
  const f = await fixture(t),
    wrong = Buffer.from(f.key);
  wrong[0] ^= 1;
  process.env.APP_ENCRYPTION_KEY = wrong.toString("hex");
  await assert.rejects(f.start(), /MFA密钥与数据库不匹配或密文损坏/);
  assert.deepEqual(await fs.readFile(f.keyPath), f.key);
  await fs.writeFile(f.keyPath, wrong);
  process.env.APP_ENCRYPTION_KEY = f.key.toString("hex").toUpperCase();
  await f.start();
  assert.deepEqual(await fs.readFile(f.keyPath), wrong);
});

test("任一MFA密文认证损坏均阻止启动，不删记录或降级认证", async (t) => {
  const f = await fixture(t);
  const db = openStore(f.dbPath);
  try {
    const bytes = Buffer.from(
      db.prepare("SELECT secret FROM mfa").get().secret,
      "base64",
    );
    bytes[15] ^= 1;
    db.prepare("UPDATE mfa SET secret=?").run(bytes.toString("base64"));
  } finally {
    db.close();
  }
  const before = f.records();
  await assert.rejects(f.start(), /MFA密钥与数据库不匹配或密文损坏/);
  assert.deepEqual(f.records(), before);
});

test("正确密钥重启后健康检查与真实密码加动态验证码登录仍可用", async (t) => {
  const f = await fixture(t),
    app = await f.start();
  await listenHttp(app.server);
  const origin = `http://127.0.0.1:${app.server.address().port}`,
    c = client(origin);
  assert.equal((await fetch(origin + "/api/health")).status, 200);
  const login = await c.request("/auth/login", "POST", {
    email: ADMIN.email,
    password: PASSWORD,
  });
  assert.equal(login.data.mfaRequired, true);
  const verified = await c.request("/auth/mfa/login", "POST", {
    challenge: login.data.challenge,
    code: totp(secret),
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.data.user.id, "root");
  assert.equal((await c.request("/users")).status, 200);
  await app.close();
  await f.start();
  assert.deepEqual(await fs.readFile(f.keyPath), f.key);
});

test("无MFA记录的旧库允许首次生成密钥，后续启动保持原密钥", async (t) => {
  const f = await fixture(t, null);
  await fs.rename(f.keyPath, f.keyPath + ".unused");
  const first = await f.start(),
    generated = await fs.readFile(f.keyPath);
  assert.equal(generated.length, 32);
  await first.close();
  await f.start();
  assert.deepEqual(await fs.readFile(f.keyPath), generated);
});

test("正式进程遇到错误MFA密钥在监听端口前非零退出，日志不包含密钥或明文", async (t) => {
  const f = await fixture(t),
    wrong = Buffer.from(f.key);
  wrong[0] ^= 1;
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../index.mjs", import.meta.url))],
    {
      env: {
        ...process.env,
        DB_PATH: f.dbPath,
        APP_ENCRYPTION_KEY: wrong.toString("hex"),
        ADMIN_EMAIL: "",
        ADMIN_PASSWORD: "",
        PORT: "0",
      },
      timeout: 10000,
      encoding: "utf8",
    },
  );
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  const output = result.stdout + result.stderr;
  assert.match(output, /MFA密钥与数据库不匹配或密文损坏/);
  assert.doesNotMatch(output, /Outdoor reservation service listening/);
  for (const value of [secret, f.key.toString("hex"), wrong.toString("hex")])
    assert.equal(output.includes(value), false);
});
