import test from "node:test";
import assert from "node:assert/strict";
import { fixture, register, PASSWORD } from "./helpers.mjs";
import { totp } from "../mfa.mjs";

async function accountPair(t, options = {}) {
  const messages = [];
  const f = await fixture(t, ":memory:", {
    integrations: {
      sendPhone: async (kind, phone, text) => {
        messages.push(text);
        return "isolated-provider";
      },
      ...options,
    },
  });
  const browser = f.client(),
    target = f.client(),
    otherDevice = f.client();
  const first = await register(browser, "rotation-first@test.local");
  const second = await register(target, "rotation-second@test.local");
  assert.equal(
    (
      await otherDevice.request("/auth/login", "POST", {
        email: first.email,
        password: PASSWORD,
      })
    ).status,
    200,
  );
  return {
    ...f,
    browser,
    target,
    otherDevice,
    first,
    second,
    messages,
    old: { ...browser.headers },
  };
}
async function session(f, headers) {
  return (
    await (await fetch(f.origin + "/api/auth/session", { headers })).json()
  ).user;
}
async function smsLogin(f) {
  f.db
    .prepare("INSERT INTO verified_phones VALUES(?,?)")
    .run("13900139000", f.second.id);
  const captcha = (await f.browser.request("/auth/captcha")).data;
  const sent = await f.browser.request("/auth/sms/send", "POST", {
    phone: "13900139000",
    purpose: "login",
    captchaId: captcha.id,
    captcha: "246789",
  });
  assert.equal(sent.status, 200);
  return f.browser.request("/auth/sms/verify", "POST", {
    id: sent.data.id,
    code: f.messages[0].match(/\d{6}/)[0],
  });
}
async function assertRotated(f, expectedUser) {
  assert.equal(
    await session(f, f.old),
    null,
    "切换前当前浏览器的旧 Cookie 必须失效",
  );
  assert.equal((await session(f, f.browser.headers)).id, expectedUser);
  assert.equal(
    (await session(f, f.otherDevice.headers)).id,
    f.first.id,
    "不撤销其他设备",
  );
}

test("短信、密码登录及普通注册成功统一替换当前浏览器旧会话，保留其他设备", async (t) => {
  for (const flow of ["sms", "password", "register"]) {
    const f = await accountPair(t);
    // Failed authentication must not revoke the still-valid current account.
    assert.equal(
      (
        await f.browser.request("/auth/login", "POST", {
          email: f.second.email,
          password: "WrongAccount123!",
        })
      ).status,
      401,
    );
    assert.equal((await session(f, f.old)).id, f.first.id);
    let expected = f.second.id;
    if (flow === "sms") assert.equal((await smsLogin(f)).status, 200);
    else if (flow === "password")
      assert.equal(
        (
          await f.browser.request("/auth/login", "POST", {
            email: f.second.email,
            password: PASSWORD,
          })
        ).status,
        200,
      );
    else expected = (await register(f.browser, "rotation-new@test.local")).id;
    await assertRotated(f, expected);
  }
});

test("短信和密码登录的MFA挑战未完成时保留原账号，MFA成功后只撤销当前旧会话", async (t) => {
  for (const flow of ["sms", "password"]) {
    const f = await accountPair(t);
    const setup = await f.target.request("/auth/mfa/setup", "POST", {
      currentPassword: PASSWORD,
    });
    assert.equal(setup.status, 200);
    const enabled = await f.target.request("/auth/mfa/enable", "POST", {
      code: totp(setup.data.secret),
    });
    assert.equal(enabled.status, 200);
    const login =
      flow === "sms"
        ? await smsLogin(f)
        : await f.browser.request("/auth/login", "POST", {
            email: f.second.email,
            password: PASSWORD,
          });
    assert.equal(login.data.mfaRequired, true);
    assert.equal((await session(f, f.old)).id, f.first.id);
    assert.equal(
      (
        await f.browser.request("/auth/mfa/login", "POST", {
          challenge: login.data.challenge,
          code: "not-a-valid-code",
        })
      ).status,
      401,
    );
    assert.equal((await session(f, f.old)).id, f.first.id);
    assert.equal(
      (
        await f.browser.request("/auth/mfa/login", "POST", {
          challenge: login.data.challenge,
          code: enabled.data.codes[0],
        })
      ).status,
      200,
    );
    await assertRotated(f, f.second.id);
  }
});

test("QQ与微信登录成功后当前旧Cookie失效，其他设备会话不受影响", async (t) => {
  const names = [
    "PUBLIC_URL",
    "QQ_CLIENT_ID",
    "QQ_CLIENT_SECRET",
    "WECHAT_CLIENT_ID",
    "WECHAT_CLIENT_SECRET",
  ];
  const previous = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  for (const n of names) process.env[n] = "isolated-test-config";
  t.after(() => {
    for (const n of names) {
      if (previous[n] === undefined) delete process.env[n];
      else process.env[n] = previous[n];
    }
  });
  for (const provider of ["qq", "wechat"]) {
    const f = await accountPair(t, {
      oauthFetch: async () =>
        new Response(
          JSON.stringify({
            openid: "rotation-subject",
            access_token: "server-only",
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        ),
    });
    process.env.PUBLIC_URL = f.origin;
    f.db
      .prepare("INSERT INTO external_identities VALUES(?,?,?)")
      .run(provider, "rotation-subject", f.second.id);
    const start = await fetch(f.origin + `/api/auth/oauth/${provider}/start`, {
      headers: f.old,
      redirect: "manual",
    });
    assert.equal(start.status, 303);
    const state = new URL(start.headers.get("location")).searchParams.get(
      "state",
    );
    const binding = start.headers.getSetCookie()[0].split(";")[0];
    const callback = await fetch(
      f.origin +
        `/api/auth/oauth/${provider}/callback?state=${state}&code=valid-code`,
      {
        headers: { ...f.old, Cookie: f.old.Cookie + "; " + binding },
        redirect: "manual",
      },
    );
    assert.equal(callback.status, 303);
    const newCookie = callback.headers
      .getSetCookie()
      .find((c) => c.startsWith("hust_session="))
      .split(";")[0];
    assert.equal(await session(f, f.old), null);
    assert.equal((await session(f, { Cookie: newCookie })).id, f.second.id);
    assert.equal((await session(f, f.otherDevice.headers)).id, f.first.id);
  }
});
