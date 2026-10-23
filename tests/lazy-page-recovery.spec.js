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
  await page.locator("[name=email]").fill("completion@test.local");
  await page.locator("[name=password]").fill("CompletionAccount123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.locator(".account-link")).toBeVisible();

  const session = await (await page.request.get("/api/auth/session")).json();
  const day = new Date(Date.now() + 341 * 86400000).toISOString().slice(0, 10);
  const response = await page.request.post("/api/bookings", {
    headers: { Origin: "http://127.0.0.1:3101", "X-CSRF-Token": session.csrf },
    data: {
      company: "分包恢复测试企业",
      contact: "张老师",
      phone: "13800138000",
      slot: 27,
      start: day,
      end: day,
      image:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=",
    },
  });
  expect(response.status()).toBe(201);
  const { id } = await response.json();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的申请", exact: true })
    .click();
  await page
    .getByRole("row")
    .filter({ hasText: id })
    .getByRole("button", { name: "查看详情" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByText("查看办理时限、电话跟进与费用记录", { exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "办理模块加载异常" }),
  ).toContainText("可能是版本已更新或网络异常");
  await expect(dialog).toContainText("分包恢复测试企业");
  await dialog.getByLabel("关闭", { exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "服务工作台", exact: true })
    .click();
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
