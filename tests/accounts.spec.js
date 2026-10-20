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
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
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
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
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
  const summaryResponse = manager.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/summary" && response.ok(),
  );
  await adminLogin(manager);
  const summary = await (await summaryResponse).json();
  expect(summary.counts["待审核"]).toBeGreaterThan(0);
  // Wait for the badge to render: the navigation name must stay stable after
  // asynchronous counts arrive, rather than relying on a fast click before it.
  await expect(
    manager
      .locator("nav button")
      .filter({ hasText: "企业申报审核" })
      .locator("b"),
  ).toHaveText(String(summary.counts["待审核"]));
  await expect(
    manager.getByRole("button", { name: "企业申报审核", exact: true }),
  ).toBeVisible();
  await manager
    .getByRole("button", { name: "企业申报审核", exact: true })
    .click();
  await manager
    .getByRole("row")
    .filter({ hasText: company })
    .getByRole("button", { name: `审核申请 ${company}`, exact: true })
    .click();
  await expect(
    manager.getByRole("region", { name: "申请审阅区" }).locator("img"),
  ).toBeVisible();
  await manager
    .getByRole("button", { name: "通过并审阅下一条", exact: true })
    .click();
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
    page.getByRole("button", { name: "03号 已占用", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "登录您的账号" }),
  ).toBeVisible();
  await page.locator("[name=email]").fill(email);
  await page.locator("[name=password]").fill(password);
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
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
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
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
  await manager.locator("[name=title]").fill("预约管理通知");
  await manager.locator("[name=content]").fill("请按预约时间使用场地。");
  await manager.getByRole("button", { name: "发布公告", exact: true }).click();
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
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
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
  await page.emulateMedia({ reducedMotion: "reduce" });
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

test("工作台独立于场地查询，原图五段桁架与区域筛选一致", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1512, height: 1050 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "预约办理指引" }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "按 PDF 原图对齐的29个桁架位置" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("查询日期")).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "场地查询", exact: true })
    .click();
  const map = page.getByRole("group", {
    name: "按 PDF 原图对齐的29个桁架位置",
  });
  await expect(map.getByRole("button")).toHaveCount(29);
  await expect(page.getByRole("heading", { name: "预约办理指引" })).toHaveCount(
    0,
  );
  for (const [zone, count] of [
    ["绿地边缘", 6],
    ["B 座通道", 4],
    ["A 座通道", 4],
    ["东侧直线", 7],
    ["南侧直线", 8],
  ]) {
    await expect(map.locator(`[data-segment="${zone}"]`)).toHaveCount(count);
  }
  await map.getByRole("button", { name: "11号 可预约", exact: true }).click();
  await expect(page.locator(".position-card>p")).toHaveText("A 座通道");
  await page.screenshot({
    path: "tmp/corrected-venue-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "位置列表", exact: true }).click();
  for (const [value, count, label] of [
    ["green", 6, "绿地边缘"],
    ["b-passage", 4, "B 座通道"],
    ["a-passage", 4, "A 座通道"],
    ["east", 7, "东侧直线"],
    ["south", 8, "南侧直线"],
  ]) {
    await page.getByLabel("筛选区域").selectOption(value);
    await expect(page.locator(".slot-grid>button")).toHaveCount(count);
    await expect(page.locator(".position-card>p")).toHaveText(label);
  }
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "服务工作台", exact: true })
    .click();
  await expect(page.getByLabel("查询日期")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开导航" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "场地查询", exact: true })
    .click();
  await page.getByRole("button", { name: "分布图", exact: true }).click();
  await page.getByLabel("筛选区域").selectOption("all");
  await page.getByRole("button", { name: "放大场地图" }).click();
  await page.getByRole("button", { name: "重置场地图" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "tmp/corrected-venue-mobile.png",
    fullPage: true,
  });
});

test("管理员在工作台直接处理待办，不必通过场地查询", async ({
  page,
  browser,
}) => {
  const company = `工作台待办-${Date.now()}`;
  await register(page, company);
  await submit(page, "20");
  const context = await browser.newContext(),
    manager = await context.newPage();
  await adminLogin(manager);
  await expect(
    manager.getByRole("heading", { name: "待办申请" }),
  ).toBeVisible();
  await expect(
    manager.getByRole("group", { name: "按 PDF 原图对齐的29个桁架位置" }),
  ).toHaveCount(0);
  await manager
    .locator(".dashboard-rows button")
    .filter({ hasText: company })
    .click();
  await manager.getByRole("dialog").getByRole("textbox").fill("请补充活动方案");
  await manager.getByRole("button", { name: "未通过", exact: true }).click();
  await expect(
    manager.locator(".dashboard-rows button").filter({ hasText: company }),
  ).toHaveCount(0);
  await manager.screenshot({ path: "tmp/admin-workspace.png", fullPage: true });
  await page.reload();
  await expect(page.locator(".dashboard-rows")).toContainText("请补充活动方案");
  await context.close();
});

test("公告可直接投递，失败保留内容，发布后游客立即可读", async ({
  page,
  browser,
}) => {
  await adminLogin(page);
  await page
    .getByRole("button", { name: "编写并发布公告", exact: true })
    .click();
  const form = page.getByRole("form", { name: "快捷公告投递" }),
    title = `快捷通知-${Date.now()}`;
  await form.getByLabel("公告标题").fill(title);
  await form.getByLabel("公告正文").fill("明日上午场地维护，请合理安排布展。");
  await form.getByRole("checkbox").check();
  await page.route("**/api/notices", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "发布服务暂时不可用" }),
        })
      : route.continue(),
  );
  await form.getByRole("button", { name: "发布公告", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("发布服务暂时不可用");
  await expect(form.getByLabel("公告标题")).toHaveValue(title);
  await page.unroute("**/api/notices");
  await form.getByLabel("公告正文").press("Control+Enter");
  await expect(
    page.locator("article").filter({ hasText: title }),
  ).toBeVisible();
  await expect(form.getByLabel("公告标题")).toHaveValue("");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: "tmp/admin-quick-notice.png", fullPage: true });
  const context = await browser.newContext(),
    visitor = await context.newPage();
  await visitor.goto("/");
  await visitor
    .getByRole("navigation")
    .getByRole("button", { name: "通知公告", exact: true })
    .click();
  const article = visitor.locator("article").filter({ hasText: title });
  await expect(article).toContainText("明日上午场地维护");
  await expect(article).toContainText("置顶");
  await expect(visitor.getByRole("form", { name: "快捷公告投递" })).toHaveCount(
    0,
  );
  await context.close();
});

test("超级管理员创建工作人员、按职责授权并即时撤销旧登录", async ({
  page,
  browser,
}) => {
  await adminLogin(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "授权管理", exact: true })
    .click();
  await page.getByRole("button", { name: "新增管理员" }).click();
  const email = `publisher-${Date.now()}@staff.local`;
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("管理员姓名").fill("公告工作人员");
  await dialog.getByLabel("登录邮箱").fill(email);
  await dialog.getByRole("checkbox", { name: /公告管理/ }).check();
  await dialog.locator("[name=currentPassword]").fill("BrowserAdmin123!");
  await dialog.getByRole("button", { name: "创建并授权", exact: true }).click();
  const temporary = await page.locator(".temporary-password").textContent();
  await page.getByRole("button", { name: "已妥善记录" }).click();
  const context = await browser.newContext(),
    staff = await context.newPage();
  await staff.goto("/");
  await staff.getByRole("button", { name: "登录 / 注册" }).click();
  await staff.locator("[name=email]").fill(email);
  await staff.locator("[name=password]").fill(temporary);
  await staff.getByLabel("图片验证码", { exact: true }).fill("246789");
  await staff.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(
    staff.getByText("您正在使用临时密码，请先设置新密码，再继续使用业务功能。"),
  ).toBeVisible();
  await staff.locator("[name=currentPassword]").fill(temporary);
  await staff.locator("[name=newPassword]").fill("ScopedStaffPassword123");
  await staff.locator("[name=confirm]").fill("ScopedStaffPassword123");
  await staff.getByRole("button", { name: "更新密码" }).click();
  await expect(
    staff.getByRole("heading", { name: "登录您的账号" }),
  ).toBeVisible();
  await staff.locator("[name=email]").fill(email);
  await staff.locator("[name=password]").fill("ScopedStaffPassword123");
  await staff.getByLabel("图片验证码", { exact: true }).fill("246789");
  await staff.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(
    staff
      .getByRole("navigation")
      .getByRole("button", { name: "企业申报审核", exact: true }),
  ).toHaveCount(0);
  await expect(
    staff
      .getByRole("navigation")
      .getByRole("button", { name: "授权管理", exact: true }),
  ).toHaveCount(0);
  await expect(
    staff
      .getByRole("navigation")
      .getByRole("button", { name: "账号管理", exact: true }),
  ).toHaveCount(0);
  await staff
    .getByRole("navigation")
    .getByRole("button", { name: "通知公告", exact: true })
    .click();
  await expect(staff.getByRole("form", { name: "快捷公告投递" })).toBeVisible();
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "授权管理", exact: true })
    .click();
  const row = page.getByRole("row").filter({ hasText: email });
  await row.getByRole("button", { name: "调整授权" }).click();
  await page
    .getByRole("dialog")
    .getByRole("checkbox", { name: /公告管理/ })
    .uncheck();
  await page
    .getByRole("dialog")
    .getByRole("checkbox", { name: /场地开放管理/ })
    .check();
  await page
    .getByRole("dialog")
    .locator("[name=currentPassword]")
    .fill("BrowserAdmin123!");
  await page.getByRole("button", { name: "保存授权", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await staff.getByLabel("公告标题").fill("已撤销权限不得发布");
  await staff.getByLabel("公告正文").fill("此请求应被服务端拒绝");
  await staff.getByRole("button", { name: "发布公告", exact: true }).click();
  await expect(
    staff.getByRole("button", { name: "登录 / 注册" }),
  ).toBeVisible();
  await staff.getByRole("button", { name: "登录 / 注册" }).click();
  await staff.locator("[name=email]").fill(email);
  await staff.locator("[name=password]").fill("ScopedStaffPassword123");
  await staff.getByLabel("图片验证码", { exact: true }).fill("246789");
  await staff.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(
    staff
      .getByRole("navigation")
      .getByRole("button", { name: "场地开放安排", exact: true }),
  ).toBeVisible();
  await staff
    .getByRole("navigation")
    .getByRole("button", { name: "通知公告", exact: true })
    .click();
  await expect(staff.getByRole("form", { name: "快捷公告投递" })).toHaveCount(
    0,
  );
  await context.close();
});

test("账号可查看登录设备，并退出其他设备", async ({ page, browser }) => {
  const email = await register(page, "设备会话管理企业");
  const context = await browser.newContext(),
    other = await context.newPage();
  await other.goto("/");
  await other.getByRole("button", { name: "登录 / 注册" }).click();
  await other.locator("[name=email]").fill(email);
  await other.locator("[name=password]").fill(password);
  await other.getByLabel("图片验证码", { exact: true }).fill("246789");
  await other.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(
    other.getByRole("heading", { name: "场地有序，活动从容。" }),
  ).toBeVisible();
  await page.locator(".account-link").click();
  await expect(page.locator(".session-list>div")).toHaveCount(2);
  await page.getByRole("button", { name: "退出其他设备", exact: true }).click();
  await expect(page.locator(".session-list>div")).toHaveCount(1);
  await other.reload();
  await expect(
    other.getByRole("button", { name: "登录 / 注册" }),
  ).toBeVisible();
  await context.close();
});

async function seedPending(page, company, slot, offset = 30) {
  const session = await (await page.request.get("/api/auth/session")).json();
  const date = new Date(Date.now() + offset * 86400000)
    .toISOString()
    .slice(0, 10);
  const response = await page.request.post("/api/bookings", {
    headers: { Origin: "http://127.0.0.1:3101", "X-CSRF-Token": session.csrf },
    data: {
      company,
      contact: "张老师",
      phone: "13800138000",
      slot,
      start: date,
      end: date,
      image: "data:image/png;base64," + design.buffer.toString("base64"),
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id;
}

test("连续审阅自动进入下一条，快捷原因退回，手机端无溢出", async ({
  page,
  browser,
}) => {
  const prefix = "连续审阅-" + Date.now();
  await register(page, prefix);
  await seedPending(page, prefix + "-A", 21);
  await seedPending(page, prefix + "-B", 22);
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    manager = await context.newPage();
  await adminLogin(manager);
  await manager
    .getByRole("navigation")
    .getByRole("button", { name: "企业申报审核", exact: true })
    .click();
  await manager.getByLabel("搜索待办申请").fill(prefix);
  const detail = manager.getByRole("region", { name: "申请审阅区" });
  await expect(
    detail.getByRole("heading", { name: prefix + "-A", exact: true }),
  ).toBeVisible();
  await expect(detail.locator("img")).toBeVisible();
  await expect(detail).toContainText("日期与占用检查通过");
  await manager.screenshot({
    path: "tmp/review-desk-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await detail
    .getByRole("button", { name: "通过并审阅下一条", exact: true })
    .click();
  await expect(
    detail.getByRole("heading", { name: prefix + "-B", exact: true }),
  ).toBeVisible();
  await detail
    .getByRole("button", { name: "设计图不清晰", exact: true })
    .click();
  await expect(detail.getByLabel("审批意见")).toHaveValue(
    "设计图内容不清晰，请上传清晰完整的桁架设计图。",
  );
  await manager.setViewportSize({ width: 390, height: 844 });
  expect(
    await manager.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await manager.screenshot({
    path: "tmp/review-desk-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await detail
    .getByRole("button", { name: "退回并审阅下一条", exact: true })
    .click();
  await expect(
    manager.getByRole("heading", { name: "暂无待办申请" }),
  ).toBeVisible();
  const results = await (await page.request.get("/api/bookings")).json();
  expect(results.items.find((b) => b.company === prefix + "-A").status).toBe(
    "已通过",
  );
  expect(
    results.items.find((b) => b.company === prefix + "-B").reason,
  ).toContain("清晰完整");
  await context.close();
});

test("批量操作需确认，冲突逐条返回，剩余待办可统一退回", async ({
  page,
  browser,
}) => {
  const prefix = "批量审阅-" + Date.now();
  await register(page, prefix);
  await seedPending(page, prefix + "-A", 25, 35);
  await seedPending(page, prefix + "-B", 26, 35);
  const enterpriseContext = await browser.newContext(),
    other = await enterpriseContext.newPage();
  await register(other, prefix + "竞争");
  await seedPending(other, prefix + "-C", 25, 35);
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    manager = await context.newPage();
  await adminLogin(manager);
  await manager
    .getByRole("navigation")
    .getByRole("button", { name: "企业申报审核", exact: true })
    .click();
  await manager.getByLabel("搜索待办申请").fill(prefix);
  await expect(manager.locator(".review-queue-item")).toHaveCount(3);
  await manager.getByLabel("选择本页全部申请").check();
  await manager.getByRole("button", { name: "批量通过", exact: true }).click();
  const dialog = manager.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "确认通过 3 条" }),
  ).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await manager.screenshot({
    path: "tmp/review-batch-confirm.png",
    fullPage: true,
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "确认通过 3 条" }).click();
  await expect(manager.locator(".review-report")).toContainText(
    "成功 2 条，未完成 1 条",
  );
  await expect(manager.locator(".review-queue-item")).toHaveCount(1);
  await expect(
    manager.getByRole("region", { name: "申请审阅区" }),
  ).toContainText("与已通过预约冲突");
  await expect(
    manager.getByRole("button", { name: "通过并审阅下一条", exact: true }),
  ).toBeDisabled();
  await manager.getByLabel("选择本页全部申请").check();
  await manager.getByRole("button", { name: "批量退回", exact: true }).click();
  await dialog.getByRole("button", { name: "时段冲突", exact: true }).click();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "确认退回 1 条" }).click();
  await expect(manager.locator(".review-report")).toContainText(
    "成功 1 条，未完成 0 条",
  );
  await expect(
    manager.getByRole("heading", { name: "暂无待办申请" }),
  ).toBeVisible();
  await enterpriseContext.close();
  await context.close();
});

test("地图适配屏幕、比例缩放、展开与退出保持原图纵横比", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "场地查询", exact: true })
    .click();
  const map = page.locator(".reference-map"),
    svg = map.locator("svg.venue-svg");
  await expect(page.getByLabel("地图缩放比例")).toHaveText("100%");
  const size = await svg.boundingBox();
  expect(size.height).toBeLessThanOrEqual(600);
  expect(Math.abs(size.width / size.height - 1350 / 1185)).toBeLessThan(0.01);
  await page.getByRole("button", { name: "放大场地图" }).click();
  await expect(page.getByLabel("地图缩放比例")).toHaveText("125%");
  await page.getByRole("button", { name: "重置场地图" }).click();
  await page.getByRole("button", { name: "展开场地图" }).click();
  await expect(map).toHaveClass(/map-expanded/);
  await page.screenshot({
    path: "tmp/map-expanded.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(map).not.toHaveClass(/map-expanded/);
  await page.screenshot({
    path: "tmp/map-fit-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "tmp/map-fit-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("验证码错误后自动刷新且保留账号输入，手机端可使用", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.locator("[name=email]").fill("admin@test.local");
  await page.locator("[name=password]").fill("BrowserAdmin123!");
  const image = page.getByRole("img", {
    name: "图片验证码，请输入图中六位数字",
  });
  await expect(image).toBeVisible();
  expect(await image.evaluate((el) => el.naturalWidth)).toBe(220);
  const before = await image.getAttribute("src");
  await page.getByLabel("图片验证码", { exact: true }).fill("111111");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("验证码错误或已过期");
  await expect(page.getByLabel("图片验证码", { exact: true })).toHaveValue("");
  await expect(image).not.toHaveAttribute("src", before);
  await expect(page.locator("[name=email]")).toHaveValue("admin@test.local");
  await expect(page.locator("[name=password]")).toHaveValue("BrowserAdmin123!");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "tmp/captcha-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.getByRole("button", { name: "打开导航" })).toBeVisible();
});

test("已通过预约可从界面确认取消并释放位置，工作台收到消息", async ({
  page,
  browser,
}) => {
  const company = "取消流程-" + Date.now();
  await register(page, company);
  const id = await seedPending(page, company, 29, 60);
  const context = await browser.newContext(),
    manager = await context.newPage();
  await adminLogin(manager);
  const session = await (await manager.request.get("/api/auth/session")).json();
  const approved = await manager.request.post(
    "/api/bookings/" + id + "/review",
    {
      headers: {
        Origin: "http://127.0.0.1:3101",
        "X-CSRF-Token": session.csrf,
      },
      data: { status: "已通过" },
    },
  );
  expect(approved.ok()).toBe(true);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的申请", exact: true })
    .click();
  await page
    .getByRole("row")
    .filter({ hasText: company })
    .getByRole("button", { name: "查看详情" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "取消已通过预约" }).click();
  await expect(
    dialog.getByRole("button", { name: "确认取消预约" }),
  ).toBeDisabled();
  await dialog.getByLabel("取消预约原因").fill("活动计划调整");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "确认取消预约" }).click();
  await expect(
    page.getByRole("row").filter({ hasText: company }),
  ).toContainText("已取消");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "服务工作台", exact: true })
    .click();
  await expect(page.locator(".notification-items")).toContainText(
    "布展预约已取消",
  );
  await page.screenshot({
    path: "tmp/notifications-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await context.close();
});

test("超级管理员从运行维护界面执行备份，日志支持检索和导出", async ({
  page,
}) => {
  await adminLogin(page);
  const accountBox = await page.locator(".sidebar-account").boundingBox();
  expect(accountBox.y + accountBox.height).toBeLessThanOrEqual(
    page.viewportSize().height + 1,
  );
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "运行维护", exact: true })
    .click();
  await page.getByRole("button", { name: "立即备份并清理" }).click();
  await expect(page.locator(".operations-grid")).toContainText("auto-", {
    timeout: 20000,
  });
  await expect(page.locator(".operations-grid")).toContainText("检查正常");
  await page.screenshot({
    path: "tmp/operations-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "操作日志", exact: true })
    .click();
  await page.getByLabel("搜索操作日志").fill("maintenance.requested");
  await expect(page.locator("tbody")).toContainText("手动启动备份与清理");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出本页" }).click();
  expect((await download).suggestedFilename()).toContain("审计日志");
});
