import test from "node:test";
import assert from "node:assert/strict";
import { fixture, PASSWORD } from "./helpers.mjs";
import { hashToken } from "../security.mjs";

const details = (proof) => ({
  proof,
  email: "new-company@test.local",
  password: PASSWORD,
  company: "首次快捷登录企业",
  contact: "李老师",
  phone: "13900139000",
  confirmed: true,
  role: "admin",
  isSuperAdmin: true,
});
async function smsProof(f, messages, phone = "13900139000") {
  const client = f.client(),
    cap = (await client.request("/auth/captcha")).data;
  const sent = await client.request("/auth/sms/send", "POST", {
    phone,
    purpose: "login",
    captchaId: cap.id,
    captcha: "246789",
  });
  assert.equal(sent.status, 200);
  const verified = await client.request("/auth/sms/verify", "POST", {
    id: sent.data.id,
    code: messages.at(-1).match(/\d{6}/)[0],
  });
  assert.equal(verified.data.registrationRequired, true);
  return { client, proof: verified.data.proof };
}
test("首次短信验证后补齐资料建号，凭据绑定浏览器且只消费一次，不能提升为管理员", async (t) => {
  const messages = [],
    f = await fixture(t, ":memory:", {
      integrations: {
        sendPhone: async (kind, phone, text) => {
          messages.push(text);
          return "sid";
        },
      },
    });
  const { client, proof } = await smsProof(f, messages);
  assert.equal((await client.request("/auth/session")).data.user, null);
  assert.equal(
    (await f.client().request("/auth/signup/inspect", "POST", { proof }))
      .status,
    400,
  );
  assert.equal(
    (await client.request("/auth/signup/inspect", "POST", { proof })).data
      .phone,
    "13900139000",
  );
  assert.equal(
    (
      await client.request("/auth/signup/complete", "POST", {
        ...details(proof),
        phone: "13800138000",
      })
    ).status,
    400,
  );
  const result = await Promise.all([
    client.request("/auth/signup/complete", "POST", details(proof)),
    client.request("/auth/signup/complete", "POST", details(proof)),
  ]);
  assert.deepEqual(result.map((r) => r.status).sort(), [201, 400]);
  const made = result.find((r) => r.status === 201).data;
  assert.equal(made.user.role, "enterprise");
  assert.equal(made.user.isSuperAdmin, false);
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM users WHERE email='new-company@test.local'",
      )
      .get().n,
    1,
  );
  assert.equal(
    (await client.request("/auth/identities")).data.phone,
    "13900139000",
  );
  assert.equal(
    (await client.request("/auth/signup/complete", "POST", details(proof)))
      .status,
    400,
  );
});

test("注册凭据过期不可用，已有邮箱不会自动合并，校验失败允许保留资料重试", async (t) => {
  const messages = [],
    f = await fixture(t, ":memory:", {
      integrations: {
        sendPhone: async (kind, phone, text) => {
          messages.push(text);
          return "sid";
        },
      },
    });
  const a = await smsProof(f, messages);
  f.db
    .prepare("UPDATE signup_proofs SET expires=0 WHERE id=?")
    .run(hashToken(a.proof));
  assert.equal(
    (await a.client.request("/auth/signup/complete", "POST", details(a.proof)))
      .status,
    400,
  );
  const b = await smsProof(f, messages, "13700137000");
  const payload = {
    ...details(b.proof),
    phone: "13700137000",
    email: "root@test.local",
  };
  assert.equal(
    (await b.client.request("/auth/signup/complete", "POST", payload)).status,
    409,
  );
  assert.equal(
    (
      await b.client.request("/auth/signup/complete", "POST", {
        ...payload,
        confirmed: false,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await b.client.request("/auth/signup/complete", "POST", {
        ...payload,
        email: "other@test.local",
      })
    ).status,
    201,
  );
});

test("QQ和微信首次授权均进入补资料页，完成后绑定OpenID且保持企业权限", async (t) => {
  const names = [
      "PUBLIC_URL",
      "QQ_CLIENT_ID",
      "QQ_CLIENT_SECRET",
      "WECHAT_CLIENT_ID",
      "WECHAT_CLIENT_SECRET",
    ],
    previous = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  for (const n of names) process.env[n] = "test-config";
  t.after(() => {
    for (const n of names) {
      if (previous[n] === undefined) delete process.env[n];
      else process.env[n] = previous[n];
    }
  });
  const f = await fixture(t, ":memory:", {
    integrations: {
      oauthFetch: async (url) =>
        new Response(
          JSON.stringify({
            openid: new URL(url).hostname + "-subject",
            access_token: "server-only",
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    },
  });
  process.env.PUBLIC_URL = f.origin;
  for (const provider of ["qq", "wechat"]) {
    const start = await fetch(f.origin + `/api/auth/oauth/${provider}/start`, {
      redirect: "manual",
    });
    const cookie = start.headers.getSetCookie()[0].split(";")[0],
      state = new URL(start.headers.get("location")).searchParams.get("state");
    const callback = await fetch(
      f.origin +
        `/api/auth/oauth/${provider}/callback?state=${state}&code=verified-code`,
      { headers: { Cookie: cookie }, redirect: "manual" },
    );
    assert.equal(callback.status, 303);
    assert.equal(
      callback.headers
        .getSetCookie()
        .some((c) => c.startsWith("hust_session=")),
      false,
    );
    assert.ok(
      callback.headers
        .getSetCookie()
        .some(
          (c) => c.startsWith("hust_external=") && c.includes("Max-Age=600"),
        ),
    );
    const proof = new URL(callback.headers.get("location")).hash.slice(8);
    assert.match(proof, /^[a-f0-9]{64}$/);
    const request = (route, data) =>
      fetch(f.origin + `/api/auth/signup/${route}`, {
        method: "POST",
        headers: {
          Origin: f.origin,
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });
    assert.equal(
      (await (await request("inspect", { proof })).json()).provider,
      provider,
    );
    const complete = await request("complete", {
      ...details(proof),
      email: `${provider}@test.local`,
    });
    assert.equal(complete.status, 201);
    const user = (await complete.json()).user;
    assert.equal(user.role, "enterprise");
    assert.equal(
      f.db
        .prepare("SELECT provider FROM external_identities WHERE user_id=?")
        .get(user.id).provider,
      provider,
    );
  }
});
