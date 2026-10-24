import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.mjs";
import { listenHttp } from "../server/tests/http-listen.mjs";
import { test, expect } from "./browser-fixtures.js";

async function account(page) {
  // A private in-memory service exercises real consent writes. The injected
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
    await page.locator("[name=company]").fill("通知偏好验证企业");
    await page.locator("[name=contact]").fill("李老师");
    await page.locator("[name=phone]").fill("13800138000");
    await page.locator("[name=password]").fill("IdentityPreference123!");
    await page.locator("[name=confirm]").fill("IdentityPreference123!");
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

const panel = (page) =>
  page.locator(".card").filter({
    has: page.getByRole("heading", { name: "快捷登录与结果通知", exact: true }),
  });

test("保存通知偏好时不能让未提交勾选伪装成已保存，失败保留输入并可重试", async ({
  page,
}) => {
  const { app, origin } = await account(page);
  let release;
  try {
    await page.locator(".account-link").click();
    const box = panel(page);
    const sms = box.getByRole("checkbox", {
      name: "接收审批结果短信",
      exact: true,
    });
    await sms.check();
    let received;
    const hit = new Promise((resolve) => {
      received = resolve;
    });
    const held = new Promise((resolve) => {
      release = resolve;
    });
    let first = true;
    await page.route("**/api/auth/notifications", async (route) => {
      if (!first) return route.continue();
      first = false;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      received();
      await held;
      await route.fulfill({ response });
    });
    const save = box.getByRole("button", { name: "保存通知偏好", exact: true });
    await save.click();
    await hit;
    // The old UI allows this click even though the submitted payload was true.
    if (await sms.isEnabled()) await sms.uncheck();
    release();
    await expect(save).toBeEnabled();
    expect(
      (await (await page.request.get(origin + "/api/auth/identities")).json())
        .preferences.sms,
    ).toBe(1);
    await expect(sms).toBeChecked();
    await sms.uncheck();
    await save.click();
    await expect(save).toBeEnabled();
    expect(
      (await (await page.request.get(origin + "/api/auth/identities")).json())
        .preferences.sms,
    ).toBe(0);
    await page.unroute("**/api/auth/notifications");
    await page.route("**/api/auth/notifications", (route) =>
      route.fulfill({ status: 503, json: { error: "偏好保存暂时失败" } }),
    );
    await sms.check();
    await save.click();
    await expect(box.getByRole("alert")).toContainText("偏好保存暂时失败");
    await expect(sms).toBeChecked();
    await expect(save).toBeEnabled();
    await page.unroute("**/api/auth/notifications");
    await save.click();
    await expect(save).toBeEnabled();
    expect(
      (await (await page.request.get(origin + "/api/auth/identities")).json())
        .preferences.sms,
    ).toBe(1);
  } finally {
    release?.();
    await page.unrouteAll({ behavior: "wait" });
    await app.close();
  }
});

test("绑定状态首次读取失败可原位重试，读取成功后恢复真实通知偏好", async ({
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
      name: "重新读取绑定与通知状态",
      exact: true,
    });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(box).toContainText("13800138000");
    await expect(
      box.getByRole("checkbox", { name: "接收审批结果短信", exact: true }),
    ).toBeEnabled();
    await expect(box.getByRole("alert")).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("手机号实际绑定期间锁定关联操作，完成重读后恢复通知偏好入口", async ({
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
      .fill("IdentityPreference123!");
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
    await expect(
      box.getByRole("checkbox", { name: "接收审批结果短信", exact: true }),
    ).toBeDisabled();
    await expect(
      form.getByLabel("当前账号密码", { exact: true }),
    ).toBeDisabled();
    release();
    await expect(box).toContainText("13900139000");
    await expect(form).toHaveCount(0);
    await expect(
      box.getByRole("button", { name: "保存通知偏好", exact: true }),
    ).toBeEnabled();
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
