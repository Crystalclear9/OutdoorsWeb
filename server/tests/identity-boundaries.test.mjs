import test from "node:test";
import assert from "node:assert/strict";
import { fixture, register, PASSWORD } from "./helpers.mjs";

test("手机号绑定验证码不能用于同一浏览器切换后的其他账号", async (t) => {
  const messages = [],
    f = await fixture(t, ":memory:", {
      integrations: {
        sendPhone: async (kind, phone, text) => {
          messages.push(text);
          return "sid";
        },
      },
    });
  const a = f.client(),
    b = f.client();
  const owner = await register(a, "owner@test.local");
  await register(b, "other@test.local");
  const captcha = (await a.request("/auth/captcha")).data;
  const sent = await a.request("/auth/sms/send", "POST", {
    phone: "13900139000",
    purpose: "link",
    captchaId: captcha.id,
    captcha: "246789",
  });
  const code = messages[0].match(/\d{6}/)[0];
  assert.equal(sent.status, 200);
  assert.equal(
    f.db.prepare("SELECT user_id FROM sms_codes").get().user_id,
    owner.id,
  );
  await a.request("/auth/logout", "POST");
  await a.request("/auth/login", "POST", {
    email: "other@test.local",
    password: PASSWORD,
  });
  assert.equal(
    (
      await a.request("/auth/sms/verify", "POST", {
        id: sent.data.id,
        code,
        currentPassword: PASSWORD,
      })
    ).status,
    403,
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM verified_phones").get().n,
    0,
  );
  await a.request("/auth/logout", "POST");
  await a.request("/auth/login", "POST", {
    email: "owner@test.local",
    password: PASSWORD,
  });
  assert.equal(
    (
      await a.request("/auth/sms/verify", "POST", {
        id: sent.data.id,
        code,
        currentPassword: PASSWORD,
      })
    ).status,
    200,
  );
});

test("手机号绑定在密码验证期间过期时，事务重新校验且不写入绑定", async (t) => {
  const messages = [],
    f = await fixture(t, ":memory:", {
      integrations: {
        sendPhone: async (kind, phone, text) => {
          messages.push(text);
          return "sid";
        },
      },
    }),
    c = f.client();
  await register(c);
  const captcha = (await c.request("/auth/captcha")).data;
  const sent = await c.request("/auth/sms/send", "POST", {
    phone: "13700137000",
    purpose: "link",
    captchaId: captcha.id,
    captcha: "246789",
  });
  const pending = c.request("/auth/sms/verify", "POST", {
    id: sent.data.id,
    code: messages[0].match(/\d{6}/)[0],
    currentPassword: PASSWORD,
  });
  const deadline = Date.now() + 1000;
  while (
    f.db.prepare("SELECT attempts FROM sms_codes").get()?.attempts === 0 &&
    Date.now() < deadline
  )
    await new Promise((resolve) => setImmediate(resolve));
  f.db.prepare("UPDATE sms_codes SET expires=0").run();
  assert.equal((await pending).status, 400);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM verified_phones").get().n,
    0,
  );
});
