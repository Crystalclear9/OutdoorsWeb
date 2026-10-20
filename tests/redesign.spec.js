import { test, expect } from "@playwright/test";

test("校园界面使用真实会话，预览参数不能切换身份，字体由完整服务提供", async ({
  page,
}) => {
  const font = page.waitForResponse((r) => r.url().endsWith(".woff2"));
  await page.goto("/?preview=admin");
  const response = await font;
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("font/woff2");
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
