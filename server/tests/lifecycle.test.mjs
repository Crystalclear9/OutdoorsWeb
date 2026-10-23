import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createApp } from "../app.mjs";
import { fixture, register } from "./helpers.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

test("未监听的服务可以关闭，多次调用共享同一关闭结果", async () => {
  const app = await createApp({
    dbPath: ":memory:",
    maintenance: { scheduled: false },
  });
  const closing = app.close();
  assert.equal(app.close(), closing);
  await closing;
  assert.equal(app.close(), closing);
  await app.close();
  assert.throws(() => app.db.prepare("SELECT 1"), /not open/);
});

test("端口占用导致启动失败后仍可安全关闭", async () => {
  const blocker = createServer();
  const app = await createApp({
    dbPath: ":memory:",
    maintenance: { scheduled: false },
  });
  try {
    blocker.listen(0, "127.0.0.1");
    await once(blocker, "listening");
    const failed = once(app.server, "error");
    app.server.listen(blocker.address().port, "127.0.0.1");
    const [error] = await failed;
    assert.equal(error.code, "EADDRINUSE");
    await app.close();
    await app.close();
    assert.throws(() => app.db.prepare("SELECT 1"), /not open/);
  } finally {
    await app.close();
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test("后台任务排空期间停止接入，数据库在所有任务结束后关闭", async (t) => {
  const f = await fixture(t);
  const gate = deferred();
  const originalClose = f.delivery.close;
  let workersClosed = 0;
  f.delivery.close = async () => {
    await gate.promise;
    await originalClose();
    workersClosed++;
  };
  const closing = f.close();
  try {
    assert.equal(f.close(), closing);
    assert.equal(f.server.listening, false);
    await assert.rejects(fetch(f.origin + "/api/health"));
    assert.equal(f.db.prepare("SELECT 1 AS alive").get().alive, 1);
  } finally {
    gate.resolve();
    await closing;
  }
  assert.equal(workersClosed, 1);
  await f.close();
  assert.throws(() => f.db.prepare("SELECT 1"), /not open/);
});

test(
  "关闭等待正在发送验证码的HTTP请求完成写入，再关闭后台任务和数据库",
  { timeout: 10000 },
  async (t) => {
    const entered = deferred();
    const gate = deferred();
    const f = await fixture(t, ":memory:", {
      integrations: {
        sendPhone: async () => {
          entered.resolve();
          await gate.promise;
          return "lifecycle-sms";
        },
      },
    });
    const owner = f.client();
    await register(owner);
    const captcha = (await owner.request("/auth/captcha")).data;
    const request = owner.request("/auth/sms/send", "POST", {
      phone: "13900139000",
      purpose: "link",
      captchaId: captcha.id,
      captcha: "246789",
    });
    await entered.promise;
    let workersClosed = false;
    const originalClose = f.delivery.close;
    f.delivery.close = async () => {
      workersClosed = true;
      await originalClose();
    };
    const closing = f.close();
    try {
      assert.equal(f.server.listening, false);
      assert.equal(workersClosed, false);
      assert.equal(f.db.prepare("SELECT 1 AS alive").get().alive, 1);
    } finally {
      gate.resolve();
      const response = await request;
      await closing;
      assert.equal(response.status, 200);
      assert.ok(response.data.id);
    }
    assert.equal(workersClosed, true);
    assert.throws(() => f.db.prepare("SELECT 1"), /not open/);
  },
);

test(
  "客户端断连后关闭仍等待异步处理完成，验证码落库后才关闭数据库",
  { timeout: 10000 },
  async (t) => {
    const entered = deferred();
    const gate = deferred();
    const disconnected = deferred();
    const f = await fixture(t, ":memory:", {
      integrations: {
        sendPhone: async () => {
          entered.resolve();
          await gate.promise;
          return "disconnected-sms";
        },
      },
    });
    const owner = f.client();
    await register(owner);
    const captcha = (await owner.request("/auth/captcha")).data;
    const controller = new AbortController();
    f.server.once("request", (_req, res) => {
      res.once("close", disconnected.resolve);
    });
    const request = fetch(f.origin + "/api/auth/sms/send", {
      method: "POST",
      headers: { ...owner.headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: "13900139000",
        purpose: "link",
        captchaId: captcha.id,
        captcha: "246789",
      }),
      signal: controller.signal,
    });
    // Attach the rejection observer before aborting to avoid unhandled errors.
    const aborted = assert.rejects(request, { name: "AbortError" });
    await entered.promise;
    controller.abort();
    await aborted;
    await disconnected.promise;
    let persistedCodes;
    const originalClose = f.delivery.close;
    f.delivery.close = async () => {
      persistedCodes = f.db
        .prepare("SELECT count(*) AS n FROM sms_codes")
        .get().n;
      await originalClose();
    };
    let closed = false;
    const closing = f.close().then(() => (closed = true));
    try {
      // Allow the HTTP server's close callback to run before checking the gate.
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(closed, false);
      assert.equal(persistedCodes, undefined);
      assert.equal(f.db.prepare("SELECT 1 AS alive").get().alive, 1);
    } finally {
      gate.resolve();
      await closing;
    }
    assert.equal(persistedCodes, 1);
    assert.throws(() => f.db.prepare("SELECT 1"), /not open/);
  },
);
