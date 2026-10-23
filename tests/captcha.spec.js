import { test, expect } from "./browser-fixtures.js";

async function openLogin(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await expect(page.locator("[name=captcha]")).toBeEnabled();
}

test("点击验证码图片和换一张都会更新图片、清空输入并保留账号", async ({
  page,
}) => {
  await openLogin(page);
  await page.locator("[name=email]").fill("admin@test.local");
  for (const name of ["刷新图片验证码", "换一张"]) {
    const image = page.locator(".captcha-image img");
    const before = await image.getAttribute("src");
    await page.locator("[name=captcha]").fill("246789");
    await page.getByRole("button", { name, exact: true }).click();
    await expect(image).not.toHaveAttribute("src", before);
    await expect(page.locator("[name=captcha]")).toHaveValue("");
    await expect(page.locator("[name=captcha]")).toBeFocused();
    await expect(page.locator("[name=email]")).toHaveValue("admin@test.local");
  }
});

test("刷新失败后不能提交旧图，重试成功后恢复填写", async ({ page }) => {
  await openLogin(page);
  await page.route("**/api/auth/captcha", (route) =>
    route.fulfill({ status: 503, json: { error: "临时故障" } }),
  );
  await page.getByRole("button", { name: "换一张", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "验证码加载失败，请重试",
  );
  await expect(page.locator("[name=captcha]")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "登录账号", exact: true }),
  ).toBeDisabled();
  await page.unroute("**/api/auth/captcha");
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.locator("[name=captcha]")).toBeEnabled();
});

test("验证码到期后清空输入并提示换图，不自动打断填写", async ({ page }) => {
  await page.clock.install();
  await openLogin(page);
  await page.locator("[name=captcha]").fill("246789");
  await page.clock.fastForward(301000);
  await expect(page.getByRole("status")).toContainText(
    "验证码已过期，请换一张",
  );
  await expect(page.locator("[name=captcha]")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "登录账号", exact: true }),
  ).toBeDisabled();
});

test("短信图片验证码刷新也会清空旧输入，手机页面不溢出", async ({ page }) => {
  await page.route("**/api/auth/providers", (route) =>
    route.fulfill({ json: { sms: true } }),
  );
  await openLogin(page);
  await page.getByRole("button", { name: "手机号登录", exact: true }).click();
  const form = page.locator(".sms-form");
  await form.locator("[name=captcha]").fill("246789");
  const before = await form.locator(".captcha-image img").getAttribute("src");
  await form.getByRole("button", { name: "刷新短信图片验证码" }).click();
  await expect(form.locator(".captcha-image img")).not.toHaveAttribute(
    "src",
    before,
  );
  await expect(form.locator("[name=captcha]")).toHaveValue("");
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});
