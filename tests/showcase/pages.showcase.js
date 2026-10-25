import { test, expect } from "@playwright/test";
const entry = "?showcase=1";
async function role(page, key) {
  await page.getByLabel("切换演示身份", { exact: true }).selectOption(key);
  await expect(page.getByLabel("切换演示身份", { exact: true })).toHaveValue(
    key,
  );
}
async function navigate(page, name) {
  const button = page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true });
  if (!(await button.isVisible()))
    await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await button.click();
}

for (const [name, viewport] of [
  ["桌面", { width: 1440, height: 1000 }],
  ["手机", { width: 390, height: 844 }],
])
  test(`无后端${name}可切换全部身份并浏览对应页面`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = [],
      apiRequests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.includes("/api/"))
        apiRequests.push(r.url());
    });
    await page.goto(entry);
    await expect(page.getByLabel("临时成果演示")).toBeVisible();
    await expect(page.locator(".account-link")).toContainText("企业联系人");
    for (const [key, heading, menus] of [
      ["enterprise", "服务工作台", ["我的申请", "场地查询", "通知公告"]],
      ["reviewer", "企业申报审核", ["企业申报审核", "通知公告"]],
      ["finance", "通知与缴费办理", ["通知公告"]],
      ["venue", "场地开放安排", ["场地开放安排"]],
      [
        "super",
        "服务工作台",
        ["账号管理", "授权管理", "操作日志", "运行维护", "通知公告"],
      ],
      ["visitor", "场地查询", ["场地查询", "通知公告"]],
    ]) {
      await role(page, key);
      await expect(
        page.getByRole("heading", { name: heading, exact: true }).first(),
      ).toBeVisible();
      for (const menu of menus) {
        await navigate(page, menu);
        await expect(
          page.getByRole("heading", { name: menu, exact: true }).first(),
        ).toBeVisible();
        await expect(page.getByRole("alert")).toHaveCount(0);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    }
    expect(errors).toEqual([]);
    expect(apiRequests).toEqual([]);
    await role(page, "reviewer");
    await expect(
      page.getByRole("heading", { name: "企业申报审核", exact: true }),
    ).toBeInViewport();
    const headingBox = await page
        .getByRole("heading", { name: "企业申报审核", exact: true })
        .boundingBox(),
      headerBox = await page.locator(".topbar").boundingBox();
    expect(headingBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
    await expect(page.locator(".review-detail img")).toBeVisible();
    await page.screenshot({
      path: `tmp/showcase-preview-${name === "桌面" ? "desktop" : "mobile"}.png`,
      fullPage: true,
    });
  });

test("审批到财务核定及企业查看共享当前标签页数据，刷新保留且重置还原", async ({
  page,
}) => {
  const apiRequests = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.includes("/api/")) apiRequests.push(r.url());
  });
  await page.goto(entry);
  await role(page, "reviewer");
  await page
    .getByRole("button", { name: "审核申请 示例企业 · 青禾文化", exact: true })
    .click();
  await expect(page.getByRole("img", { name: "桁架设计图" })).toBeVisible();
  await page
    .getByRole("button", { name: "通过并审阅下一条", exact: true })
    .click();
  await expect(
    page
      .locator(".review-queue-item")
      .filter({ hasText: "示例企业 · 青禾文化" }),
  ).toHaveCount(0);
  await role(page, "finance");
  await page.locator(".case-row").filter({ hasText: "SHOWCASE-01" }).click();
  const panel = page.getByRole("region", { name: "办理与缴费记录" });
  await panel.getByLabel("应缴金额（元）", { exact: true }).fill("120");
  await panel
    .getByLabel("收费依据或免缴说明", { exact: true })
    .fill("虚构演示金额");
  await panel
    .getByLabel("收款单位与办理说明", { exact: true })
    .fill("演示说明，无需付款");
  await panel
    .getByRole("button", { name: "发送费用办理通知", exact: true })
    .click();
  await expect(panel).toContainText("人民币 120.00 元");
  await role(page, "enterprise");
  await page
    .getByRole("button", { name: "通知与缴费办理", exact: true })
    .click();
  await page.locator(".case-row").filter({ hasText: "SHOWCASE-01" }).click();
  await expect(
    page.getByRole("region", { name: "办理与缴费记录" }),
  ).toContainText("应缴 ¥120.00");
  await page.reload();
  await expect(page.locator(".account-link")).toContainText("企业联系人");
  await role(page, "finance");
  await page.locator(".case-row").filter({ hasText: "SHOWCASE-01" }).click();
  await expect(
    page.getByRole("region", { name: "办理与缴费记录" }),
  ).toContainText("人民币 120.00 元");
  await page.getByRole("button", { name: "重置演示", exact: true }).click();
  await expect(
    page.locator(".case-row").filter({ hasText: "SHOWCASE-01" }),
  ).toHaveCount(0);
  expect(apiRequests).toEqual([]);
});

test("演示企业申报进入审核队列，管理员公告在游客身份可见", async ({ page }) => {
  const calls = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.includes("/api/")) calls.push(r.url());
  });
  await page.goto(entry);
  await page.getByRole("button", { name: "发起布展申请", exact: true }).click();
  const dialog = page.getByRole("dialog"),
    date = new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10);
  await dialog.getByLabel("企业名称", { exact: true }).fill("演示新增申报企业");
  await dialog.locator("[name=slot]").selectOption("10");
  await dialog.getByLabel("开始日期", { exact: true }).fill(date);
  await dialog.getByLabel("结束日期", { exact: true }).fill(date);
  await dialog.getByLabel("上传桁架设计图").setInputFiles({
    name: "demo.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "提交申请", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await role(page, "reviewer");
  await expect(
    page.getByRole("button", {
      name: "审核申请 演示新增申报企业",
      exact: true,
    }),
  ).toBeVisible();
  await role(page, "super");
  await navigate(page, "通知公告");
  const form = page.getByRole("form", { name: "快捷公告投递" });
  await form.getByLabel("公告标题").fill("临时演示新增公告");
  await form
    .getByLabel("公告正文")
    .fill("这是一条仅存在当前标签页的虚构演示公告。");
  await form.getByRole("button", { name: "发布公告", exact: true }).click();
  await expect(
    page.locator(".notice-article").filter({ hasText: "临时演示新增公告" }),
  ).toHaveCount(1);
  await role(page, "visitor");
  await navigate(page, "通知公告");
  await expect(
    page.locator(".notice-article").filter({ hasText: "临时演示新增公告" }),
  ).toBeVisible();
  expect(calls).toEqual([]);
});

test("退出演示切为游客，新标签页与当前标签页数据隔离", async ({
  page,
  context,
}) => {
  await page.goto(entry);
  await role(page, "super");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByLabel("切换演示身份", { exact: true })).toHaveValue(
    "visitor",
  );
  await expect(
    page.getByRole("button", { name: "登录 / 注册", exact: true }),
  ).toBeEnabled();
  const other = await context.newPage();
  try {
    await other.goto(entry);
    await expect(other.getByLabel("切换演示身份", { exact: true })).toHaveValue(
      "enterprise",
    );
  } finally {
    await other.close();
  }
});
