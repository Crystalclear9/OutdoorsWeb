import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.mjs";
import { listenHttp } from "../server/tests/http-listen.mjs";
import { test, expect } from "./browser-fixtures.js";

async function account(page) {
  // A private in-memory service exercises real account binding and reads. The injected
  // phone adapter only advertises test availability and never contacts a provider.
  const messages = [];
  const app = await createApp({
    dbPath: ":memory:",
    admin: { email: "identity-root@test.local", password: "IdentityRoot123!" },
    captchaTestAnswer: "246789",
    integrations: {
      sendPhone: async (kind, phone, text) => {
        messages.push({ kind, phone, text });
        return "isolated-browser-message";
      },
    },
    maintenance: { scheduled: false },
  });
  try {
    await listenHttp(app.server);
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    await page.goto(origin);
    await page
      .getByRole("button", { name: "登录 / 注册", exact: true })
      .click();
    await page.getByRole("button", { name: "企业注册", exact: true }).click();
    const email = `identity-${randomUUID()}@company.local`;
    await page.locator("[name=email]").fill(email);
    await page.locator("[name=company]").fill("账号绑定验证企业");
    await page.locator("[name=contact]").fill("李老师");
    await page.locator("[name=phone]").fill("13800138000");
    await page.locator("[name=password]").fill("IdentityBinding123!");
    await page.locator("[name=confirm]").fill("IdentityBinding123!");
    await page.getByLabel("图片验证码", { exact: true }).fill("246789");
    await page.getByRole("button", { name: "创建账号", exact: true }).click();
    await expect(page.locator(".account-link")).toBeVisible();
    const user = app.db
      .prepare("SELECT id FROM users WHERE email=?")
      .get(email);
    app.db
      .prepare("INSERT INTO verified_phones(phone,user_id) VALUES(?,?)")
      .run("13800138000", user.id);
    return { app, origin, user, messages };
  } catch (error) {
    await app.close();
    throw error;
  }
}

// Locate the actual account-binding panel independently of its title so the
// retired notification controls are detected even in the previous UI.
const panel = (page) =>
  page.locator(".card").filter({ has: page.locator(".identity-content") });

test("企业已验证手机且短信可用时仍不显示通知订阅，也不更改既有通知偏好", async ({
  page,
}) => {
  const { app, origin, user, messages } = await account(page);
  try {
    app.db
      .prepare(
        "INSERT INTO contact_preferences(user_id,sms,voice) VALUES(?,1,1)",
      )
      .run(user.id);
    let preferenceWrites = 0;
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/api/auth/notifications" &&
        request.method() === "POST"
      )
        preferenceWrites++;
    });
    await page.locator(".account-link").click();
    const box = panel(page);
    await expect(box).toContainText("13800138000");
    const actual = await (
      await page.request.get(origin + "/api/auth/identities")
    ).json();
    expect(actual.configured.sms).toBe(true);
    expect(actual.phone).toBe("13800138000");
    expect(actual.preferences).toMatchObject({ sms: 1, voice: 1 });
    // The previous UI renders these real, enabled subscription controls here.
    await expect(box.getByRole("checkbox")).toHaveCount(0);
    await expect(
      box.getByRole("button", { name: "保存通知偏好", exact: true }),
    ).toHaveCount(0);
    await expect(box.getByText("审批结果通知", { exact: true })).toHaveCount(0);
    await expect(
      box.getByRole("heading", { name: "快捷登录与账号绑定", exact: true }),
    ).toBeVisible();
    await box
      .getByRole("button", { name: "更换绑定手机号", exact: true })
      .click();
    await expect(box.locator(".sms-form")).toBeVisible();
    await box.getByRole("button", { name: "收起绑定", exact: true }).click();
    await expect(box.locator(".sms-form")).toHaveCount(0);
    expect(preferenceWrites).toBe(0);
    expect(messages).toHaveLength(0);
    expect(
      app.db
        .prepare("SELECT sms,voice FROM contact_preferences WHERE user_id=?")
        .get(user.id),
    ).toMatchObject({ sms: 1, voice: 1 });
  } finally {
    await app.close();
  }
});

test("绑定状态首次读取失败可原位纯读恢复，成功后展示真实手机号与可用绑定操作", async ({
  page,
}) => {
  const { app } = await account(page);
  try {
    await page.route("**/api/auth/identities", (route) =>
      route.fulfill({ status: 503, json: { error: "绑定状态暂时不可用" } }),
    );
    await page.locator(".account-link").click();
    const box = panel(page);
    await expect(box.getByRole("alert")).toContainText("绑定状态暂时不可用");
    await expect(box.getByRole("checkbox")).toHaveCount(0);
    await page.unroute("**/api/auth/identities");
    const retry = box.getByRole("button", {
      name: "重新读取绑定状态",
      exact: true,
    });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(box).toContainText("13800138000");
    await expect(
      box.getByRole("button", { name: "更换绑定手机号", exact: true }),
    ).toBeEnabled();
    await expect(box.getByRole("checkbox")).toHaveCount(0);
    await expect(box.getByRole("alert")).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("手机号实际换绑期间锁定关联操作与验证字段，成功重读后恢复绑定入口", async ({
  page,
}) => {
  const { app, origin, messages } = await account(page);
  let release;
  try {
    await page.locator(".account-link").click();
    const box = panel(page);
    await box
      .getByRole("button", { name: "更换绑定手机号", exact: true })
      .click();
    const form = box.locator(".sms-form");
    await form.getByLabel("手机号码", { exact: true }).fill("13900139000");
    await form.getByLabel("图片验证码", { exact: true }).fill("246789");
    await form
      .getByRole("button", { name: "发送短信验证码", exact: true })
      .click();
    await expect(form.getByLabel("短信验证码", { exact: true })).toBeVisible();
    expect(messages).toHaveLength(1);
    await form
      .getByLabel("短信验证码", { exact: true })
      .fill(messages[0].text.match(/\d{6}/)[0]);
    await form
      .getByLabel("当前账号密码", { exact: true })
      .fill("IdentityBinding123!");
    let received;
    const hit = new Promise((resolve) => {
      received = resolve;
    });
    const held = new Promise((resolve) => {
      release = resolve;
    });
    await page.route("**/api/auth/sms/verify", async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      received();
      await held;
      await route.fulfill({ response });
    });
    await form
      .getByRole("button", { name: "验证并绑定手机号", exact: true })
      .click();
    await hit;
    await expect(
      box.getByRole("button", { name: "收起绑定", exact: true }),
    ).toBeDisabled();
    await expect(form.getByLabel("手机号码", { exact: true })).toBeDisabled();
    await expect(form.getByLabel("短信验证码", { exact: true })).toBeDisabled();
    await expect(
      form.getByRole("button", { name: "重新填写手机号", exact: true }),
    ).toBeDisabled();
    await expect(box.getByRole("checkbox")).toHaveCount(0);
    await expect(
      form.getByLabel("当前账号密码", { exact: true }),
    ).toBeDisabled();
    release();
    await expect(box).toContainText("13900139000");
    await expect(form).toHaveCount(0);
    await expect(
      box.getByRole("button", { name: "更换绑定手机号", exact: true }),
    ).toBeEnabled();
    await expect(
      box.getByRole("button", { name: "保存通知偏好", exact: true }),
    ).toHaveCount(0);
    expect(
      (await (await page.request.get(origin + "/api/auth/identities")).json())
        .phone,
    ).toBe("13900139000");
  } finally {
    release?.();
    await page.unrouteAll({ behavior: "wait" });
    await app.close();
  }
});
