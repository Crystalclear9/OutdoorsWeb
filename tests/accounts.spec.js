import { test, expect } from "@playwright/test";

const password = "EnterprisePassword123!";
const design = {
  name: "design.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  ),
};
async function register(page, company = "浏览器测试企业") {
  const email = `test-${Date.now()}-${Math.random().toString(16).slice(2)}@company.local`;
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.getByRole("button", { name: "企业注册", exact: true }).click();
  await page.locator("[name=email]").fill(email);
  await page.locator("[name=company]").fill(company);
  await page.locator("[name=contact]").fill("张老师");
  await page.locator("[name=phone]").fill("13800138000");
  await page.locator("[name=password]").fill(password);
  await page.locator("[name=confirm]").fill(password);
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(
    page.getByRole("heading", { name: "场地有序，活动从容。" }),
  ).toBeVisible();
  return email;
}
async function adminLogin(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.locator("[name=email]").fill("admin@test.local");
  await page.locator("[name=password]").fill("BrowserAdmin123!");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "账号管理", exact: true }),
  ).toBeVisible();
}
async function submit(page, slot = "3") {
  await page.getByRole("button", { name: "发起布展申请", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("[name=slot]").selectOption(slot);
  await dialog.getByLabel("上传桁架设计图").setInputFiles(design);
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "提交申请", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "待审核" }).first(),
  ).toBeVisible();
}

test("注册、真实跨账号审核、刷新、退出与登录", async ({ page, browser }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const company = `完整流程企业-${Date.now()}`;
  const email = await register(page, company);
  await submit(page, "3");
  const context = await browser.newContext();
  const manager = await context.newPage();
  await adminLogin(manager);
  await manager
    .getByRole("button", { name: "企业申报审核", exact: true })
    .click();
  await manager
    .getByRole("row")
    .filter({ hasText: company })
    .getByRole("button", { name: "审核申请" })
    .click();
  await expect(manager.getByRole("dialog").locator("img")).toBeVisible();
  await manager.getByRole("button", { name: "审核通过", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "我的申请", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("row").filter({ hasText: company }),
  ).toContainText("已通过");
  await page.getByRole("button", { name: "场地查询", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "A-03 已占用", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "登录您的账号" }),
  ).toBeVisible();
  await page.locator("[name=email]").fill(email);
  await page.locator("[name=password]").fill(password);
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "场地有序，活动从容。" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});
test("企业资料修改与密码更新后会话失效", async ({ page }) => {
  const email = await register(page);
  await page.locator(".account-link").click();
  await page.locator(".card-form [name=company]").fill("已更新企业资料");
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect(page.locator(".account-profile h2")).toHaveText(
    "已更新企业资料",
  );
  await page.locator("[name=currentPassword]").fill(password);
  await page.locator("[name=newPassword]").fill("UpdatedAccountPassword456");
  await page.locator("[name=confirm]").fill("UpdatedAccountPassword456");
  await page.getByRole("button", { name: "更新密码" }).click();
  await expect(
    page.getByRole("heading", { name: "登录您的账号" }),
  ).toBeVisible();
  await page.locator("[name=email]").fill(email);
  await page.locator("[name=password]").fill("UpdatedAccountPassword456");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "场地有序，活动从容。" }),
  ).toBeVisible();
});
test("管理员发布公告、场地安排、停用与密码恢复界面", async ({
  page,
  browser,
}) => {
  const company = `管理测试企业-${Date.now()}`;
  const email = await register(page, company);
  const context = await browser.newContext();
  const manager = await context.newPage();
  await adminLogin(manager);
  await manager.getByRole("button", { name: "通知公告", exact: true }).click();
  await manager.getByRole("button", { name: "发布公告" }).click();
  await manager.locator("[name=title]").fill("预约管理通知");
  await manager.locator("[name=content]").fill("请按预约时间使用场地。");
  await manager.getByRole("button", { name: "保存公告" }).click();
  await expect(
    manager.locator("article").filter({ hasText: "预约管理通知" }),
  ).toBeVisible();
  await manager
    .getByRole("button", { name: "场地开放安排", exact: true })
    .click();
  await manager.getByRole("button", { name: "新增暂停安排" }).click();
  await manager.locator("[name=slot]").selectOption("29");
  await manager.locator("[name=reason]").fill("设备维护");
  await manager.getByRole("button", { name: "保存安排" }).click();
  await expect(
    manager.getByRole("row").filter({ hasText: "设备维护" }),
  ).toBeVisible();
  await manager.getByRole("button", { name: "账号管理", exact: true }).click();
  let row = manager.getByRole("row").filter({ hasText: company });
  await row.getByRole("button", { name: "停用", exact: true }).click();
  await manager.getByRole("button", { name: "确认操作" }).click();
  await expect(row).toContainText("已停用");
  await page.reload();
  await expect(page.getByRole("button", { name: "登录 / 注册" })).toBeVisible();
  await row.getByRole("button", { name: "启用", exact: true }).click();
  await manager.getByRole("button", { name: "确认操作" }).click();
  await row.getByRole("button", { name: "重置密码" }).click();
  await manager.getByRole("button", { name: "确认操作" }).click();
  const temporary = await manager.locator(".temporary-password").textContent();
  await manager.getByRole("button", { name: "已妥善记录" }).click();
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.locator("[name=email]").fill(email);
  await page.locator("[name=password]").fill(temporary);
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(
    page.getByText("您正在使用临时密码，请先设置新密码，再继续使用业务功能。"),
  ).toBeVisible();
  await page.locator("[name=currentPassword]").fill(temporary);
  await page.locator("[name=newPassword]").fill(password);
  await page.locator("[name=confirm]").fill(password);
  await page.getByRole("button", { name: "更新密码" }).click();
  await expect(
    page.getByRole("heading", { name: "登录您的账号" }),
  ).toBeVisible();
  await context.close();
});
test("手机端注册、账号页面与无横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "tmp/account-home-mobile.png",
    fullPage: true,
  });
  await page.locator(".account-link").click();
  await expect(page.getByRole("heading", { name: "账号安全" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "通知公告", exact: true }).click();
  await expect(page.locator(".sidebar")).not.toHaveClass(/is-open/);
});
test("完整服务桌面视觉与登录页面", async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 1050 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "发起布展申请" }),
  ).toBeEnabled();
  await page.screenshot({
    path: "tmp/account-home-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.screenshot({
    path: "tmp/account-login-desktop.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
