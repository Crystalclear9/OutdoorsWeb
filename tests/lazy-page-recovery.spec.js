import { test, expect } from "./browser-fixtures.js";

test("办理分包失效仅显示局部提示，详情和导航保留，手动刷新可恢复", async ({
  page,
}) => {
  let blocked = true;
  await page.route("**/assets/Casework-*.js", (route) =>
    blocked ? route.abort("failed") : route.continue(),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.locator("[name=email]").fill("admin@test.local");
  await page.locator("[name=password]").fill("BrowserAdmin123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.locator(".account-link")).toBeVisible();

  await page
    .getByRole("button", { name: "通知与缴费办理", exact: true })
    .click();
  const fallback = page.getByRole("region", { name: "办理模块加载异常" });
  await expect(fallback).toContainText("刷新会清除当前页面未提交的内容");
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.locator(".account-link")).toBeVisible();

  blocked = false;
  await fallback.getByRole("button", { name: "刷新页面后重试" }).click();
  await expect(page.locator(".account-link")).toBeVisible();
  await page
    .getByRole("button", { name: "通知与缴费办理", exact: true })
    .click();
  await expect(page.getByLabel("搜索办理记录")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "办理模块加载异常" }),
  ).toHaveCount(0);
});
