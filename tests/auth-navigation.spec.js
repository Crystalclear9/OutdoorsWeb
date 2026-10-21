import { test, expect } from "./browser-fixtures.js";

async function openLogin(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
}
function deferResponse(page, pattern, respond) {
  let release, received;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const hit = new Promise((resolve) => {
    received = resolve;
  });
  return page
    .route(pattern, async (route) => {
      const response = respond ? await respond(route) : await route.fetch();
      received();
      await held;
      await route.fulfill(response);
    })
    .then(() => ({ release, hit }));
}
async function expectLocked(page) {
  await expect(
    page.getByRole("button", { name: "返回场地浏览" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "账号登录", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "企业注册", exact: true }),
  ).toBeDisabled();
}

test("真实登录等待响应期间不能退出或切换认证，失败后恢复操作", async ({
  page,
}) => {
  await openLogin(page);
  const deferred = await deferResponse(
    page,
    "**/api/auth/login",
    async (route) => ({ response: await route.fetch() }),
  );
  await page.locator("[name=email]").fill("completion@test.local");
  await page.locator("[name=password]").fill("WrongPassword123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await deferred.hit;
  await expectLocked(page);
  deferred.release();
  await expect(
    page.getByRole("button", { name: "返回场地浏览" }),
  ).toBeEnabled();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.unroute("**/api/auth/login");
  const success = await deferResponse(
    page,
    "**/api/auth/login",
    async (route) => ({ response: await route.fetch() }),
  );
  await page.locator("[name=password]").fill("CompletionAccount123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await success.hit;
  await expectLocked(page);
  success.release();
  await expect(page.locator(".account-link")).toBeVisible();
});

test("短信验证期间不能切换密码登录、收起短信或前往第三方认证", async ({
  page,
}) => {
  await page.route("**/api/auth/providers", (route) =>
    route.fulfill({ json: { sms: true, qq: true, wechat: true } }),
  );
  await page.route("**/api/auth/sms/send", (route) =>
    route.fulfill({ json: { id: "navigation-test" } }),
  );
  await openLogin(page);
  await page.getByRole("button", { name: "手机号登录", exact: true }).click();
  const form = page.locator(".sms-form");
  await form.locator("[name=phone]").fill("13900139000");
  await form.locator("[name=captcha]").fill("246789");
  await form.getByRole("button", { name: "发送短信验证码" }).click();
  await form.locator("[name=code]").fill("123456");
  const deferred = await deferResponse(page, "**/api/auth/sms/verify", () => ({
    status: 400,
    json: { error: "验证码错误" },
  }));
  await form.getByRole("button", { name: "使用短信登录" }).click();
  await deferred.hit;
  await expectLocked(page);
  await expect(
    page.getByRole("button", { name: "收起短信登录" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "登录账号", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("link", { name: "QQ 登录" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  deferred.release();
  await expect(
    page.getByRole("button", { name: "返回场地浏览" }),
  ).toBeEnabled();
  await expect(form).toContainText("验证码错误");
});

test("两步验证请求期间禁止返回重新登录，失败后可以退出", async ({ page }) => {
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      json: { mfaRequired: true, challenge: "navigation-test" },
    }),
  );
  await openLogin(page);
  await page.locator("[name=email]").fill("admin@test.local");
  await page.locator("[name=password]").fill("BrowserAdmin123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  const deferred = await deferResponse(page, "**/api/auth/mfa/login", () => ({
    status: 400,
    json: { error: "动态验证码错误" },
  }));
  await page.getByLabel("动态验证码或恢复码").fill("123456");
  await page.getByRole("button", { name: "完成两步验证" }).click();
  await deferred.hit;
  await expect(
    page.getByRole("button", { name: "返回重新登录" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "返回场地浏览" }),
  ).toBeDisabled();
  deferred.release();
  await expect(
    page.getByRole("button", { name: "返回重新登录" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "返回重新登录" }).click();
  await expect(
    page.getByRole("button", { name: "登录账号", exact: true }),
  ).toBeVisible();
});

test("第三方注册完成请求期间外层和内层返回都锁定", async ({ page }) => {
  await page.route("**/api/auth/signup/inspect", (route) =>
    route.fulfill({ json: { provider: "qq", validForMs: 600000 } }),
  );
  await page.goto(`/#signup=${"a".repeat(64)}`);
  const form = page.locator(".external-signup-form");
  await form.locator("[name=email]").fill("navigation-proof@test.local");
  await form.locator("[name=company]").fill("认证导航测试企业");
  await form.locator("[name=contact]").fill("李老师");
  await form.locator("[name=phone]").fill("13900139000");
  await form.locator("[name=password]").fill("NavigationProof123!");
  await form.locator("[name=confirm]").fill("NavigationProof123!");
  await form.getByRole("checkbox").check();
  const deferred = await deferResponse(
    page,
    "**/api/auth/signup/complete",
    () => ({ status: 409, json: { error: "邮箱已被注册" } }),
  );
  await form.getByRole("button", { name: "完成资料并进入工作台" }).click();
  await deferred.hit;
  await expect(
    page.getByRole("button", { name: "返回场地浏览" }),
  ).toBeDisabled();
  await expect(
    form.getByRole("button", { name: "返回账号登录" }),
  ).toBeDisabled();
  deferred.release();
  await expect(
    page.getByRole("button", { name: "返回场地浏览" }),
  ).toBeEnabled();
  await expect(form).toContainText("邮箱已被注册");
});
