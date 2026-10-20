import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openStore } from "../store.mjs";
import { hashToken } from "../security.mjs";

test("两个服务进程并发猜测短信和MFA凭据，最多记录五次尝试，耗尽后正确凭据也不可用", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "outdoor-proof-race-"));
  const dbPath = path.join(dir, "app.sqlite"),
    db = openStore(dbPath),
    children = [];
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode !== null) continue;
      await new Promise((resolve) => {
        child.once("exit", resolve);
        child.send("close");
      });
    }
    db.close();
    assert.ok(
      path
        .resolve(dir)
        .startsWith(
          path.resolve(os.tmpdir()) + path.sep + "outdoor-proof-race-",
        ),
    );
    await rm(dir, { recursive: true, force: true });
  });
  const password = "unused-password-hash",
    binding = "concurrent-proof-browser";
  db.prepare(
    "INSERT INTO users(id,email,password_hash,role,company,contact,phone,created) VALUES('proof-user','proof@test.local',?,'enterprise','测试企业','测试人','13800138000',?)",
  ).run(password, new Date().toISOString());
  db.prepare(
    "INSERT INTO mfa(user_id,secret,enabled,recovery) VALUES('proof-user','',1,?)",
  ).run(JSON.stringify([hashToken("recovery-for-concurrency")]));
  const sms = "a".repeat(64),
    mfa = "b".repeat(64);
  db.prepare(
    "INSERT INTO sms_codes(id,phone,binding,answer,purpose,expires) VALUES(?,?,?,?,?,?)",
  ).run(
    hashToken(sms),
    "13800138000",
    hashToken(binding),
    hashToken(sms + "123456"),
    "login",
    Date.now() + 300000,
  );
  db.prepare(
    "INSERT INTO auth_challenges(id,user_id,kind,payload,expires) VALUES(?,'proof-user','mfa',?,?)",
  ).run(
    hashToken(mfa),
    JSON.stringify({
      binding: hashToken(binding),
      password: hashToken(password),
    }),
    Date.now() + 300000,
  );
  async function launch() {
    const child = fork(new URL("./worker.mjs", import.meta.url), [], {
      env: {
        ...process.env,
        DB_PATH: dbPath,
        ADMIN_EMAIL: "",
        ADMIN_PASSWORD: "",
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    children.push(child);
    return new Promise((resolve, reject) => {
      child.once("message", (m) => resolve(m.origin));
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error("worker exited " + code)));
    });
  }
  const origins = await Promise.all([launch(), launch()]);
  async function request(origin, route, body) {
    const response = await fetch(origin + "/api" + route, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: `hust_external=${binding}; hust_mfa=${binding}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    await response.json();
    return response.status;
  }
  const smsResults = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      request(origins[i % 2], "/auth/sms/verify", { id: sms, code: "000000" }),
    ),
  );
  assert.ok(smsResults.every((status) => status === 400));
  assert.equal(db.prepare("SELECT attempts FROM sms_codes").get().attempts, 5);
  assert.equal(
    await request(origins[0], "/auth/sms/verify", { id: sms, code: "123456" }),
    400,
  );
  const mfaResults = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      request(origins[i % 2], "/auth/mfa/login", {
        challenge: mfa,
        code: "wrong",
      }),
    ),
  );
  assert.ok(mfaResults.every((status) => status === 401));
  assert.equal(
    db.prepare("SELECT attempts FROM auth_challenges").get().attempts,
    5,
  );
  assert.equal(
    await request(origins[1], "/auth/mfa/login", {
      challenge: mfa,
      code: "recovery-for-concurrency",
    }),
    401,
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions").get().n, 0);
});
