import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../app.mjs";
import { listenHttp } from "./http-listen.mjs";
import { client, register, PASSWORD } from "./helpers.mjs";
import { totp } from "../mfa.mjs";
import { hashToken } from "../security.mjs";

async function setup(t) {
  const directory = mkdtempSync(
      path.join(os.tmpdir(), "outdoors-mfa-account-"),
    ),
    filename = path.join(directory, "app.sqlite"),
    apps = [];
  t.after(async () => {
    for (const app of apps) await app.close();
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("outdoors-mfa-account-"));
    rmSync(directory, { recursive: true, force: true });
  });
  for (let n = 0; n < 2; n++) {
    const app = await createApp({
      dbPath: filename,
      captchaTestAnswer: "246789",
      trustedProxies: "127.0.0.1",
      maintenance: { scheduled: false },
    });
    apps.push(app);
    await listenHttp(app.server);
    app.origin = `http://127.0.0.1:${app.server.address().port}`;
  }
  async function account(email) {
    const owner = client(apps[0].origin),
      user = await register(owner, email),
      configured = await owner.request("/auth/mfa/setup", "POST", {
        currentPassword: PASSWORD,
      });
    assert.equal(configured.status, 200);
    const enabled = await owner.request("/auth/mfa/enable", "POST", {
      code: totp(configured.data.secret),
    });
    assert.equal(enabled.status, 200);
    return { user, secret: configured.data.secret, codes: enabled.data.codes };
  }
  let source = 0;
  async function challenge(account, instance = source % 2) {
    const browser = client(apps[instance].origin),
      headers = { "X-Forwarded-For": `203.0.113.${++source}` },
      login = await browser.request(
        "/auth/login",
        "POST",
        { email: account.user.email, password: PASSWORD },
        headers,
      );
    assert.equal(login.status, 200);
    assert.equal(login.data.mfaRequired, true);
    return {
      browser,
      id: login.data.challenge,
      verify: (code) =>
        browser.request(
          "/auth/mfa/login",
          "POST",
          { challenge: login.data.challenge, code },
          headers,
        ),
    };
  }
  return { apps, db: apps[0].db, account, challenge };
}
const wrong = (secret) => {
  const counter = Math.floor(Date.now() / 30000),
    accepted = new Set([-1, 0, 1].map((n) => totp(secret, counter + n)));
  return ["000000", "111111", "222222", "333333"].find(
    (code) => !accepted.has(code),
  );
};
const quota = (db, user) =>
  db
    .prepare("SELECT attempts,reset FROM rate_limits WHERE key=?")
    .get(`mfa-account:${user.id}`);

test("MFA账号额度跨来源、服务连接和新挑战累计，另一账号独立，过期后恢复", async (t) => {
  const f = await setup(t),
    first = await f.account("limited@test.local");
  for (let n = 0; n < 10; n++) {
    const proof = await f.challenge(first);
    assert.equal((await proof.verify(wrong(first.secret))).status, 401);
  }
  assert.equal(quota(f.db, first.user)?.attempts, 10);
  const blocked = await f.challenge(first);
  assert.equal((await blocked.verify(first.codes[0])).status, 429);
  assert.equal(quota(f.db, first.user).attempts, 10);
  assert.equal(
    f.db
      .prepare("SELECT attempts FROM auth_challenges WHERE id=?")
      .get(hashToken(blocked.id)).attempts,
    0,
  );

  const other = await f.account("independent@test.local"),
    independent = await f.challenge(other);
  assert.equal((await independent.verify(wrong(other.secret))).status, 401);
  assert.equal(quota(f.db, other.user).attempts, 1);
  assert.equal(quota(f.db, first.user).attempts, 10);

  f.db
    .prepare("UPDATE rate_limits SET reset=0 WHERE key=?")
    .run(`mfa-account:${first.user.id}`);
  assert.equal((await blocked.verify(wrong(first.secret))).status, 401);
  assert.equal(quota(f.db, first.user).attempts, 1);
});

test("两个共享数据库服务并发领取不同挑战，账号最多记录十次验证", async (t) => {
  const f = await setup(t),
    target = await f.account("concurrent@test.local"),
    proofs = [];
  for (let n = 0; n < 16; n++) proofs.push(await f.challenge(target));
  const responses = await Promise.all(
    proofs.map((proof) => proof.verify(wrong(target.secret))),
  );
  assert.equal(responses.filter((r) => r.status === 401).length, 10);
  assert.equal(responses.filter((r) => r.status === 429).length, 6);
  assert.equal(quota(f.db, target.user)?.attempts, 10);
  assert.equal(
    f.db
      .prepare("SELECT SUM(attempts) n FROM auth_challenges WHERE user_id=?")
      .get(target.user.id).n,
    10,
  );
});

test("完整MFA成功事务消费恢复码并清除账号计数，新挑战从一次开始", async (t) => {
  const f = await setup(t),
    target = await f.account("success@test.local");
  const proof = await f.challenge(target);
  for (let n = 0; n < 3; n++)
    assert.equal((await proof.verify(wrong(target.secret))).status, 401);
  assert.equal(quota(f.db, target.user)?.attempts, 3);
  const success = await proof.verify(target.codes[0]);
  assert.equal(success.status, 200);
  assert.equal(success.data.user.id, target.user.id);
  assert.equal(quota(f.db, target.user), undefined);
  assert.equal(
    f.db
      .prepare("SELECT id FROM auth_challenges WHERE id=?")
      .get(hashToken(proof.id)),
    undefined,
  );
  assert.equal(
    JSON.parse(
      f.db
        .prepare("SELECT recovery FROM mfa WHERE user_id=?")
        .get(target.user.id).recovery,
    ).includes(hashToken(target.codes[0])),
    false,
  );
  const fresh = await f.challenge(target);
  assert.equal((await fresh.verify(wrong(target.secret))).status, 401);
  assert.equal(quota(f.db, target.user).attempts, 1);
});

test("无效、他人、过期或凭据撤销挑战不能消耗目标账号的MFA额度", async (t) => {
  const f = await setup(t),
    target = await f.account("bound@test.local"),
    proof = await f.challenge(target),
    id = hashToken(proof.id),
    row = f.db.prepare("SELECT * FROM auth_challenges WHERE id=?").get(id),
    user = f.db
      .prepare("SELECT password_hash FROM users WHERE id=?")
      .get(target.user.id);
  const stranger = client(f.apps[1].origin);
  assert.equal(
    (
      await stranger.request("/auth/mfa/login", "POST", {
        challenge: "f".repeat(64),
        code: "000000",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await stranger.request("/auth/mfa/login", "POST", {
        challenge: proof.id,
        code: "000000",
      })
    ).status,
    401,
  );
  assert.equal(quota(f.db, target.user), undefined);
  f.db.prepare("UPDATE auth_challenges SET expires=0 WHERE id=?").run(id);
  assert.equal((await proof.verify(target.codes[0])).status, 401);
  assert.equal(quota(f.db, target.user), undefined);
  f.db
    .prepare("UPDATE auth_challenges SET expires=? WHERE id=?")
    .run(row.expires, id);
  f.db
    .prepare("UPDATE users SET password_hash='revoked-password' WHERE id=?")
    .run(target.user.id);
  assert.equal((await proof.verify(target.codes[0])).status, 401);
  assert.equal(quota(f.db, target.user), undefined);
  f.db
    .prepare("UPDATE users SET password_hash=?,disabled=1 WHERE id=?")
    .run(user.password_hash, target.user.id);
  assert.equal((await proof.verify(target.codes[0])).status, 401);
  assert.equal(quota(f.db, target.user), undefined);
  f.db.prepare("UPDATE users SET disabled=0 WHERE id=?").run(target.user.id);
  f.db.prepare("UPDATE mfa SET enabled=0 WHERE user_id=?").run(target.user.id);
  assert.equal((await proof.verify(target.codes[0])).status, 401);
  assert.equal(quota(f.db, target.user), undefined);
  f.db.prepare("UPDATE mfa SET enabled=1 WHERE user_id=?").run(target.user.id);
  assert.equal((await proof.verify(wrong(target.secret))).status, 401);
  assert.equal(quota(f.db, target.user)?.attempts, 1);
  assert.equal(
    f.db.prepare("SELECT attempts FROM auth_challenges WHERE id=?").get(id)
      .attempts,
    1,
  );
});
