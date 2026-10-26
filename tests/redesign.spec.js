import { test, expect } from "./browser-fixtures.js";

test("校园界面使用真实会话，预览参数不能切换身份，标题与正文使用统一字体", async ({
  page,
}) => {
  await page.goto("/?preview=admin");
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() =>
      [...document.fonts].some(
        (font) => font.family === "Campus Sans" && font.status === "loaded",
      ),
    ),
  ).toBe(true);
  const bodyFont = await page
    .locator("body")
    .evaluate((el) => getComputedStyle(el).fontFamily);
  await expect(page.locator("h1").first()).toHaveCSS("font-family", bodyFont);
  await expect(page.locator("button").first()).toHaveCSS(
    "font-family",
    bodyFont,
  );
  await expect(
    page.getByRole("img", { name: "华中科技大学", exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "账号管理", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("身份预览")).toHaveCount(0);
  expect(
    (await (await page.request.get("/api/auth/session")).json()).user,
  ).toBeNull();
  expect((await page.request.get("/api/summary")).status()).toBe(401);
  const help = page
    .getByRole("button", { name: "打开使用指南", exact: true })
    .filter({ visible: true });
  await help.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(help).toBeFocused();
});

test("真实管理员在手机、平板和桌面均可进入全部功能且页面不横向溢出", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.locator("[name=email]").fill("admin@test.local");
  await page.locator("[name=password]").fill("BrowserAdmin123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.locator(".account-link")).toBeVisible();
  for (const width of [320, 390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of [
      "服务工作台",
      "企业申报审核",
      "通知公告",
      "账号管理",
      "授权管理",
      "操作日志",
      "运行维护",
    ]) {
      if (width <= 760)
        await page.getByRole("button", { name: "打开导航" }).click();
      await page
        .getByRole("navigation")
        .getByRole("button", { name, exact: true })
        .click();
      await expect(page.locator(".breadcrumb strong")).toHaveText(name);
      await expect(page.locator(".nav-scrim")).toHaveCount(0);
      const overflow = await page.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
      }));
      expect(overflow.document, `${width}px / ${name}`).toBeLessThanOrEqual(
        overflow.viewport,
      );
    }
    await page.locator(".account-link").click();
    await expect(
      page.getByRole("heading", { name: "账号安全", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `${width}px / 账号设置`,
    ).toBeLessThanOrEqual(width);
  }
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "登录您的账号", exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/auth/session")).json()).user,
  ).toBeNull();
});
