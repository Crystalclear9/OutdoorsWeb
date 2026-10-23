import { test, expect } from "./browser-fixtures.js";

test("退出已撤销会话但响应未到时，其他401不能提前重新打开认证入口", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.locator("[name=email]").fill("completion@test.local");
  await page.locator("[name=password]").fill("CompletionAccount123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.locator(".account-link")).toBeVisible();
  let release, received;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const hit = new Promise((resolve) => {
    received = resolve;
  });
  await page.route("**/api/auth/logout", async (route) => {
    const response = await route.fetch();
    received();
    await held;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await hit;
    const denied = page.waitForResponse(
      (response) =>
        response.url().includes("/api/bookings?") && response.status() === 401,
    );
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "我的申请", exact: true })
      .click();
    await denied;
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.locator(".account-link")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "退出登录", exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole("button", { name: "登录 / 注册" })).toHaveCount(
      0,
    );
  } finally {
    release();
  }
  await expect(
    page.getByRole("heading", { name: "登录您的账号" }),
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/auth/session")).json()).user,
  ).toBeNull();
});

test("退出等待期间不能重复发送，失败后可重试并正常重新登录", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  async function login() {
    await page.locator("[name=email]").fill("completion@test.local");
    await page.locator("[name=password]").fill("CompletionAccount123!");
    await page.getByLabel("图片验证码", { exact: true }).fill("246789");
    await page.getByRole("button", { name: "登录账号", exact: true }).click();
    await expect(page.locator(".account-link")).toBeVisible();
  }
  await login();
  let release, received;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const hit = new Promise((resolve) => {
    received = resolve;
  });
  let attempts = 0;
  await page.route("**/api/auth/logout", async (route) => {
    attempts++;
    received();
    await held;
    await route.fulfill({ status: 503, json: { error: "退出暂时不可用" } });
  });
  try {
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await hit;
    await expect(
      page.getByRole("button", { name: "退出登录", exact: true }),
    ).toBeDisabled();
    await page.locator(".account-link").click();
    await expect(
      page.getByRole("button", { name: "安全退出登录", exact: true }),
    ).toBeDisabled();
    expect(attempts).toBe(1);
  } finally {
    release();
  }
  await expect(page.getByText("退出暂时不可用", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "退出登录", exact: true }),
  ).toBeEnabled();
  await page.unroute("**/api/auth/logout");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "登录您的账号" }),
  ).toBeVisible();
  await login();
  await page.reload();
  await expect(page.locator(".account-link")).toBeVisible();
  expect(
    (await (await page.request.get("/api/auth/session")).json()).user,
  ).not.toBeNull();
});
