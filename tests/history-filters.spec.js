import { test, expect } from "./browser-fixtures.js";

async function login(
  page,
  email = "admin@test.local",
  password = "BrowserAdmin123!",
) {
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.locator("[name=email]").fill(email);
  await page.locator("[name=password]").fill(password);
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.locator(".account-link")).toBeVisible();
}
const row = (company = "未筛选企业") => ({
  id: "HISTORY-FILTER-001",
  company,
  contact: "李老师",
  phone: "13800138000",
  start: "2030-01-01",
  end: "2030-01-01",
  slot: 1,
  status: "已通过",
  version: 2,
  created: "2026-10-21T16:30:00.000Z",
  reviewer: "reviewer-old",
  reviewerName: "历史审核员（已停用）",
});

test("历史按提交日期与审批人筛选，重置页码、缩页回退并隐藏无效区间旧结果", async ({
  page,
}) => {
  const requests = [];
  let reduced = false;
  await page.route("**/api/bookings/reviewers", (r) =>
    r.fulfill({
      json: { items: [{ id: "reviewer-old", name: "历史审核员（已停用）" }] },
    }),
  );
  await page.route("**/api/bookings?**", (r) => {
    const p = new URL(r.request().url()).searchParams;
    requests.push(Object.fromEntries(p));
    if (p.get("status") === "待审核")
      return r.fulfill({ json: { items: [], total: 0, pages: 1, page: 1 } });
    const filtered = p.get("from") && p.get("to") && p.get("reviewer");
    return r.fulfill({
      json: {
        items: [row(filtered ? "条件匹配企业" : undefined)],
        total: reduced ? 1 : 31,
        pages: reduced ? 1 : 3,
        page: Number(p.get("page")) || 1,
      },
    });
  });
  await login(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "企业申报审核", exact: true })
    .click();
  await page
    .getByRole("button", { name: "全部申请与历史", exact: true })
    .click();
  await expect(
    page.getByRole("row").filter({ hasText: "未筛选企业" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", {
      name: "提交时间（北京时间）",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "未筛选企业" }),
  ).toContainText("2026/10/22");
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator(".pagination")).toContainText("第 2 / 3 页");
  reduced = true;
  await page.getByRole("button", { name: "刷新申请列表", exact: true }).click();
  await expect(page.locator(".pagination")).toContainText("第 1 / 1 页");
  await page.getByLabel("提交开始日期（北京时间）").fill("2026-10-21");
  await page.getByLabel("提交结束日期（北京时间）").fill("2026-10-22");
  await page.getByLabel("审批人", { exact: true }).selectOption("reviewer-old");
  await expect(
    page.getByRole("row").filter({ hasText: "条件匹配企业" }),
  ).toBeVisible();
  expect(
    requests.some(
      (r) =>
        r.from === "2026-10-21" &&
        r.to === "2026-10-22" &&
        r.reviewer === "reviewer-old" &&
        r.page === "1",
    ),
  ).toBe(true);
  await page.getByLabel("提交开始日期（北京时间）").fill("2026-10-23");
  await expect(
    page.getByText("提交开始日期不能晚于结束日期。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "条件匹配企业" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "下一页", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("提交开始日期（北京时间）").fill("2026-10-21");
  await expect(
    page.getByRole("row").filter({ hasText: "条件匹配企业" }),
  ).toBeVisible();
  await page.screenshot({
    path: "tmp/history-filters-admin.png",
    fullPage: true,
  });
});

test("企业手机端仅筛选自身提交日期，不请求或展示内部审批人且页面不横向溢出", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let reviewerReads = 0;
  const requests = [];
  await page.route("**/api/bookings/reviewers", (r) => {
    reviewerReads++;
    return r.fulfill({ json: { items: [] } });
  });
  await page.route("**/api/bookings?**", (r) => {
    const p = new URL(r.request().url()).searchParams;
    requests.push(Object.fromEntries(p));
    return r.fulfill({
      json: { items: [row("本企业申请")], total: 1, pages: 1, page: 1 },
    });
  });
  await login(page, "completion@test.local", "CompletionAccount123!");
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的申请", exact: true })
    .click();
  await expect(
    page.getByRole("row").filter({ hasText: "本企业申请" }),
  ).toBeVisible();
  await page.getByLabel("提交开始日期（北京时间）").fill("2026-10-22");
  await page.getByLabel("提交结束日期（北京时间）").fill("2026-10-22");
  await expect(
    page.getByRole("row").filter({ hasText: "本企业申请" }),
  ).toBeVisible();
  expect(
    requests.some(
      (r) =>
        r.from === "2026-10-22" &&
        r.to === "2026-10-22" &&
        !Object.hasOwn(r, "reviewer"),
    ),
  ).toBe(true);
  await expect(page.getByLabel("审批人", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("columnheader", { name: "审批人", exact: true }),
  ).toHaveCount(0);
  expect(reviewerReads).toBe(0);
  await page.screenshot({
    path: "tmp/history-filters-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
