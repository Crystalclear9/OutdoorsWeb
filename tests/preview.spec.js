import { test, expect } from "@playwright/test";

test("身份预览可切换企业、管理员和审核人员，预览写操作不请求服务器", async ({ page }) => {
  const apiRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
  });
  await page.goto("/?preview=enterprise");
  await expect(page.getByRole("group", { name: "29个桁架位置" })).toBeVisible();
  await page.getByRole("navigation").getByRole("button", { name: "我的申请", exact: true }).click();
  await expect(page.getByText("PREVIEW-001", { exact: true })).toBeVisible();
  await page.getByLabel("身份预览").selectOption("admin");
  await page.getByRole("navigation").getByRole("button", { name: "企业申报审核", exact: true }).click();
  await expect(page.locator(".review-design img")).toBeVisible();
  await page.locator(".review-decision-actions").getByRole("button", { name: /通过/ }).last().click();
  await expect(page.getByRole("alert")).toContainText("当前为身份预览");
  await page.getByRole("navigation").getByRole("button", { name: "授权管理", exact: true }).click();
  await expect(page.getByText("reviewer@example.com", { exact: true })).toBeVisible();
  await page.getByLabel("身份预览").selectOption("reviewer");
  await expect(page.getByRole("navigation").getByRole("button", { name: "企业申报审核", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation").getByRole("button", { name: "授权管理", exact: true })).toHaveCount(0);
  expect(apiRequests).toEqual([]);
  await page.getByLabel("身份预览").selectOption("");
  await expect(page.getByRole("button", { name: "登录 / 注册" })).toBeVisible();
});

test("手机端身份切换与首页地图不溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?preview=admin");
  await expect(page.getByLabel("身份预览")).toHaveValue("admin");
  await expect(page.getByRole("group", { name: "29个桁架位置" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel("身份预览").selectOption("enterprise");
  await expect(page.getByRole("button", { name: "申请此位置" })).toBeVisible();
});
