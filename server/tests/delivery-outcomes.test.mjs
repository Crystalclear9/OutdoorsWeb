import test from "node:test";
import assert from "node:assert/strict";
import { fixture, register, manager, booking } from "./helpers.mjs";
import { createDelivery } from "../delivery.mjs";

for (const scenario of [
  {
    name: "500语音响应",
    status: 500,
    body: { code: 20500 },
    state: "uncertain",
  },
  {
    name: "503短信响应",
    status: 503,
    body: {},
    kind: "sms",
    state: "uncertain",
  },
  { name: "408超时响应", status: 408, body: {}, state: "uncertain" },
  { name: "201缺失受理编号", status: 201, body: {}, state: "uncertain" },
  {
    name: "201非字符串编号",
    status: 201,
    body: { sid: {} },
    state: "uncertain",
  },
  { name: "401凭据拒绝", status: 401, body: {}, state: "failed" },
  { name: "403权限拒绝", status: 403, body: {}, state: "failed" },
  { name: "429限流退避", status: 429, body: {}, state: "pending", retry: true },
  {
    name: "201明确受理",
    status: 201,
    body: { sid: "provider-receipt" },
    state: "accepted",
  },
]) {
  test(`真实通信适配器与队列区分${scenario.name}，不盲目重发`, async (t) => {
    const names = [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_FROM",
      "ALERT_WEBHOOK_URL",
    ];
    const previous = names.map((name) => process.env[name]);
    process.env.TWILIO_ACCOUNT_SID = "AC" + "a".repeat(32);
    process.env.TWILIO_AUTH_TOKEN = "test-only-token";
    process.env.TWILIO_FROM = "+12025550123";
    delete process.env.ALERT_WEBHOOK_URL;
    const realFetch = globalThis.fetch;
    t.after(() => {
      globalThis.fetch = realFetch;
      names.forEach((name, i) => {
        if (previous[i] === undefined) delete process.env[name];
        else process.env[name] = previous[i];
      });
    });
    const f = await fixture(t),
      owner = f.client(),
      root = f.client();
    const user = await register(owner);
    await manager(root);
    const made = await owner.request("/bookings", "POST", booking());
    assert.equal(made.status, 201);
    assert.equal(
      (
        await root.request(
          `/bookings/${made.data.id}/review`,
          "POST",
          {
            status: "已通过",
          },
          { "If-Match": '"1"' },
        )
      ).status,
      200,
    );
    f.db
      .prepare("INSERT INTO verified_phones VALUES('13800138000',?)")
      .run(user.id);
    f.db.prepare("INSERT INTO contact_preferences VALUES(?,1,1)").run(user.id);
    f.db
      .prepare(
        "INSERT INTO delivery_jobs(id,kind,payload,next_at,created) VALUES('outcome-job',?,?,0,?)",
      )
      .run(
        scenario.kind || "voice",
        JSON.stringify({
          userId: user.id,
          bookingId: made.data.id,
          phone: "13800138000",
          message: "审核结果",
        }),
        new Date().toISOString(),
      );
    let sends = 0;
    globalThis.fetch = async (url, options) => {
      if (String(url).startsWith("https://api.twilio.com/")) {
        sends++;
        return new Response(JSON.stringify(scenario.body), {
          status: scenario.status,
          headers: {
            "Content-Type": "application/json",
            ...(scenario.retry ? { "Retry-After": "600" } : {}),
          },
        });
      }
      return realFetch(url, options);
    };
    const delivery = createDelivery(f.db, f.maintenance, { scheduled: false });
    t.after(() => delivery.close());
    const before = Date.now();
    await delivery.run();
    let row = f.db
      .prepare("SELECT * FROM delivery_jobs WHERE id='outcome-job'")
      .get();
    assert.equal(row.state, scenario.state);
    assert.equal(row.attempts, 1);
    assert.equal(row.version, 3);
    assert.equal(!!row.delivered, scenario.state === "accepted");
    await delivery.run();
    assert.equal(sends, 1);
    if (scenario.retry) {
      assert.ok(
        row.next_at >= before + 600000,
        "遵守服务商Retry-After，不提前重试",
      );
      f.db
        .prepare("UPDATE delivery_jobs SET next_at=0 WHERE id='outcome-job'")
        .run();
      await delivery.run();
      row = f.db
        .prepare("SELECT * FROM delivery_jobs WHERE id='outcome-job'")
        .get();
      assert.equal(sends, 2);
      assert.equal(row.state, "pending");
      assert.equal(row.attempts, 2);
    } else {
      f.db
        .prepare("UPDATE delivery_jobs SET next_at=0 WHERE id='outcome-job'")
        .run();
      await delivery.run();
      assert.equal(sends, 1, "失败或不确定任务不会被自动重新领取");
    }
    if (scenario.state === "uncertain") {
      const attempted = await root.request(
        "/operations/deliveries/outcome-job",
        "POST",
        {
          action: "retry",
          reason: "未核实",
          version: row.version,
        },
      );
      assert.equal(attempted.status, 400);
      assert.equal(
        f.db
          .prepare("SELECT state FROM delivery_jobs WHERE id='outcome-job'")
          .get().state,
        "uncertain",
      );
    }
  });
}
