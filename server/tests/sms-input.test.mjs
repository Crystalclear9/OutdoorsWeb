import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.mjs";
import { deliverPhone } from "../integrations.mjs";

const invalidPhones = [
  ["13800138000"],
  13800138000,
  null,
  undefined,
  {},
  { toString: null },
  "not-a-phone",
  "1380013800",
  " 13800138000",
  "13800138000 ",
];

test("短信发送拒绝非字符串及非法号码，不外发或保存验证码，正常字符串仍可发送", async (t) => {
  let sends = 0;
  const f = await fixture(t, ":memory:", {
    integrations: {
      sendPhone: async () => {
        sends++;
        return "isolated-sms-receipt";
      },
    },
  });
  const c = f.client();
  for (const phone of invalidPhones) {
    const captcha = (await c.request("/auth/captcha")).data;
    const response = await c.request("/auth/sms/send", "POST", {
      phone,
      purpose: "login",
      captchaId: captcha.id,
      captcha: "246789",
    });
    assert.equal(response.status, 400, JSON.stringify({ phone, response }));
    assert.equal(sends, 0);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) AS n FROM sms_codes").get().n,
      0,
    );
  }
  const captcha = (await c.request("/auth/captcha")).data;
  const valid = await c.request("/auth/sms/send", "POST", {
    phone: "13800138000",
    purpose: "login",
    captchaId: captcha.id,
    captcha: "246789",
  });
  assert.equal(valid.status, 200);
  assert.equal(sends, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sms_codes").get().n, 1);
});

test("真实短信和语音适配器在网络调用前拒绝非字符串或非法号码", async (t) => {
  const names = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"],
    previous = names.map((name) => process.env[name]),
    realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  });
  process.env.TWILIO_ACCOUNT_SID = "AC" + "a".repeat(32);
  process.env.TWILIO_AUTH_TOKEN = "isolated-test-token";
  process.env.TWILIO_FROM = "+12025550123";
  let sends = 0;
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /^https:\/\/api\.twilio\.com\//);
    assert.equal(options.body.get("To"), "+8613800138000");
    sends++;
    return new Response(JSON.stringify({ sid: "isolated-provider-receipt" }));
  };
  for (const kind of ["sms", "voice"])
    for (const phone of invalidPhones) {
      await assert.rejects(deliverPhone(kind, phone, "test message"), {
        status: 400,
      });
      assert.equal(sends, 0);
    }
  assert.equal(
    await deliverPhone("sms", "13800138000", "test message"),
    "isolated-provider-receipt",
  );
  assert.equal(sends, 1);
});
