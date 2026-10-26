import { test, expect } from "./browser-fixtures.js";

test("旧场地接口故障不影响公告，管理员仍可真实发布公告", async ({ page }) => {
  await page.route("**/api/venue?**", (route) =>
    route.fulfill({ status: 503, json: { error: "场地维护中" } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.locator("[name=email]").fill("admin@test.local");
  await page.locator("[name=password]").fill("BrowserAdmin123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.locator(".account-link")).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "通知公告", exact: true })
    .click();
  const composer = page.getByRole("form", { name: "快捷公告投递" });
  const title = `场地故障独立发布-${Date.now()}`;
  await composer.locator("[name=title]").fill(title);
  await composer
    .locator("[name=content]")
    .fill("场地查询维护期间，公告服务正常运行。");
  await expect(
    composer.getByRole("button", { name: "发布公告", exact: true }),
  ).toBeEnabled();
  await composer.getByRole("button", { name: "发布公告", exact: true }).click();
  await expect(
    page.locator(".notice-article").filter({ hasText: title }),
  ).toContainText("场地查询维护期间，公告服务正常运行。");
  await expect(
    page.getByText("公告服务未连接", { exact: true }),
  ).not.toBeVisible();
});

test("公告读取迟迟未完成时，区域示意与申报入口仍可用", async ({ page }) => {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/notices", async (route) => {
    await held;
    await route.fulfill({ json: { items: [] } });
  });
  try {
    await page.goto("/");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "摆放区域示意", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "发起布展申请",
        exact: true,
      }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "发起布展申请", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "登录您的账号" }),
    ).toBeVisible();
  } finally {
    release();
  }
});

test("公告接口失败有独立提示，企业仍可真实提交申请，恢复后清除提示", async ({
  page,
}) => {
  let unavailable = true;
  await page.route("**/api/notices", (route) =>
    unavailable
      ? route.fulfill({ status: 503, json: { error: "公告维护中" } })
      : route.continue(),
  );
  await page.goto("/");
  await expect(page.locator(".dashboard-announcements")).toContainText(
    "公告暂时无法加载，请稍后重试。",
  );
  await expect(
    page.getByText("后端服务尚未连接", { exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "通知公告", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "公告暂时无法加载，请稍后重试。",
  );
  await expect(
    page.getByText("暂无已发布公告", { exact: true }),
  ).not.toBeVisible();

  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.getByRole("button", { name: "企业注册", exact: true }).click();
  const company = `公告隔离企业-${Date.now()}`;
  await page
    .locator("[name=email]")
    .fill(`isolation-${Date.now()}@company.local`);
  await page.locator("[name=company]").fill(company);
  await page.locator("[name=contact]").fill("张老师");
  await page.locator("[name=phone]").fill("13800138000");
  await page.locator("[name=password]").fill("IsolationPassword123!");
  await page.locator("[name=confirm]").fill("IsolationPassword123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "创建账号" }).click();
  await page.getByRole("button", { name: "发起布展申请", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const date = new Date();
  date.setDate(date.getDate() + 19);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  await dialog.locator("[name=start]").fill(day);
  await dialog.locator("[name=end]").fill(day);
  await dialog.locator("[name=builder_contact]").fill("搭建负责人");
  await dialog.locator("[name=builder_phone]").fill("13900139000");
  await dialog.getByLabel("上传桁架设计图").setInputFiles({
    name: "design.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "提交申请", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: company }),
  ).toContainText("待审核");

  unavailable = false;
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "通知公告", exact: true })
    .click();
  await expect(
    page.getByText("公告暂时无法加载，请稍后重试。", { exact: true }),
  ).not.toBeVisible();
});
