import { test, expect } from "@playwright/test";
test("登录、现场登记与审批台固定视觉基线", async ({ page }, info) => {
  await page.clock.install({ time: new Date("2026-10-20T00:00:00Z") });
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await expect(page.locator(".captcha-image img")).toBeVisible();
  await expect.soft(page).toHaveScreenshot("login.png", {
    mask: [page.locator(".captcha-image")],
  });
  await page.locator("[name=email]").fill("visual@test.local");
  await page.locator("[name=password]").fill("VisualAccount123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.locator(".workspace-welcome")).toBeVisible();
  async function navigate(name) {
    if (info.project.name === "mobile")
      await page.getByRole("button", { name: "打开导航" }).click();
    await page
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
  }
  await navigate("场地开放安排");
  await expect(
    page.getByRole("button", { name: "保存现场登记" }),
  ).toBeVisible();
  await page.locator(".toast").waitFor({ state: "hidden" });
  await expect.soft(page).toHaveScreenshot("onsite.png");
  await navigate("企业申报审核");
  await expect(
    page.getByRole("img", { name: "校园创新科技有限公司的桁架设计图" }),
  ).toBeVisible();
  if (info.project.name === "desktop") {
    await expect(page.locator(".review-material")).toHaveCSS("display", "grid");
    const actions = await page
      .locator(".review-decision-actions")
      .boundingBox();
    expect(actions.y + actions.height).toBeLessThanOrEqual(
      page.viewportSize().height,
    );
  }
  await expect.soft(page).toHaveScreenshot("review.png");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
