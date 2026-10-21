import { test, expect } from "./browser-fixtures.js";

async function signupCookie(context) {
  await context.addCookies([
    {
      name: "hust_external",
      value: "signup-browser-binding",
      domain: "127.0.0.1",
      path: "/api/auth",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test("旧账号迟到的未授权响应不会退出新登录的管理员", async ({ page }) => {
  let release, captured;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const requested = new Promise((resolve) => {
    captured = resolve;
  });
  await page.route(
    "**/api/summary",
    async (route) => {
      captured();
      await held;
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "旧会话已失效" }),
      });
    },
    { times: 1 },
  );
  async function login(email, password) {
    await page.locator("[name=email]").fill(email);
    await page.locator("[name=password]").fill(password);
    await page.getByLabel("图片验证码", { exact: true }).fill("246789");
    await page.getByRole("button", { name: "登录账号", exact: true }).click();
    await expect(page.locator(".account-link")).toBeVisible();
  }
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "登录 / 注册" }).click();
    await login("completion@test.local", "CompletionAccount123!");
    await requested;
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await login("admin@test.local", "BrowserAdmin123!");
    const oldResponse = page.waitForResponse(
      (r) => r.url().endsWith("/api/summary") && r.status() === 401,
    );
    release();
    await (await oldResponse).finished();
    await page
      .getByRole("button", { name: "企业申报审核", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "待办队列" }),
    ).toBeVisible();
    await expect(
      page.getByText("旧会话已失效", { exact: true }),
    ).not.toBeVisible();
  } finally {
    release();
  }
});

test("迟到的访客会话响应不会覆盖刚完成的注册登录", async ({
  page,
  context,
}) => {
  await signupCookie(context);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/api/auth/session",
    async (route) => {
      const response = await route.fetch();
      await held;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  try {
    await page.goto(`/#signup=${"e".repeat(64)}`);
    const form = page.locator(".external-signup-form");
    await form.locator("[name=email]").fill("signup-race@test.local");
    await form.locator("[name=company]").fill("会话响应测试企业");
    await form.locator("[name=contact]").fill("陈老师");
    await form.locator("[name=phone]").fill("13500135001");
    await form.locator("[name=password]").fill("NewSignupAccount123!");
    await form.locator("[name=confirm]").fill("NewSignupAccount123!");
    await form.getByRole("checkbox").check();
    await form.getByRole("button", { name: "完成资料并进入工作台" }).click();
    await expect(page.locator(".workspace-welcome")).toContainText("陈老师");
    const oldResponse = page.waitForResponse("**/api/auth/session");
    release();
    await (await oldResponse).finished();
    // A subsequent UI action also verifies that the old response has been rendered.
    await page.locator(".account-link").click();
    await expect(
      page.getByRole("heading", { name: "账号安全", exact: true }),
    ).toBeVisible();
  } finally {
    release();
  }
});

test("注册凭据过期后保留填写内容并提供重新验证入口", async ({
  page,
  context,
}) => {
  await signupCookie(context);
  await page.route("**/api/auth/signup/inspect", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), validForMs: 2000 },
    });
  });
  await page.goto(`/#signup=${"f".repeat(64)}`);
  const form = page.locator(".external-signup-form");
  await form.locator("[name=company]").fill("待完善的企业资料");
  await expect(
    form.getByText(
      "注册凭据已过期，已填写的资料暂时保留，请重新验证登录方式。",
    ),
  ).toBeVisible();
  await expect(form.locator("[name=company]")).toHaveValue("待完善的企业资料");
  await expect(form.locator("[name=company]")).toBeDisabled();
  await expect(
    form.getByRole("button", { name: "完成资料并进入工作台" }),
  ).toBeDisabled();
  await form.getByRole("button", { name: "重新验证登录方式" }).click();
  await expect(
    page.getByRole("heading", { name: "登录您的账号" }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
});

for (const mobile of [false, true])
  test(`首次快捷登录补齐企业资料并保持登录${mobile ? "（手机）" : "（桌面）"}`, async ({
    page,
    context,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await context.addCookies([
      {
        name: "hust_external",
        value: "signup-browser-binding",
        domain: "127.0.0.1",
        path: "/api/auth",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const proof = (mobile ? "d" : "c").repeat(64);
    await page.goto(`/#signup=${proof}`);
    await expect(
      page.getByRole("heading", { name: "完成企业账号" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.locator(".external-signup-form [name=email]"),
    ).toBeVisible();
    const form = page.locator(".external-signup-form");
    await form.locator("[name=email]").fill(`signup-${mobile}@test.local`);
    await form.locator("[name=company]").fill("快捷登录界面测试企业");
    await form.locator("[name=contact]").fill("王老师");
    if (mobile) {
      await expect(form.locator("[name=phone]")).toHaveValue("13600136000");
      await expect(form.locator("[name=phone]")).toHaveAttribute(
        "readonly",
        "",
      );
    } else await form.locator("[name=phone]").fill("13500135000");
    await form.locator("[name=password]").fill("NewSignupAccount123!");
    await form.locator("[name=confirm]").fill("NewSignupAccount123!");
    await form.getByRole("checkbox").check();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await form.getByRole("button", { name: "完成资料并进入工作台" }).click();
    await expect(page.locator(".workspace-welcome")).toContainText("王老师");
    expect(new URL(page.url()).hash).toBe("");
    await page.reload();
    await expect(page.locator(".workspace-welcome")).toContainText("王老师");
    const session = await (await page.request.get("/api/auth/session")).json();
    expect(session.user.role).toBe("enterprise");
    expect(session.user.isSuperAdmin).toBe(false);
  });
