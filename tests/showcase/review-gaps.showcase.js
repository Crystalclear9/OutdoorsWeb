import { test, expect } from "@playwright/test";

async function role(page, key) {
  const label = { enterprise: "企业", super: "管理员", visitor: "游客" }[key];
  const button = page
    .getByRole("group", { name: "切换演示身份", exact: true })
    .getByRole("button", { name: label, exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

test("演示提交日期筛选按北京时间包含当日边界，不按UTC日期错分", async ({
  page,
}) => {
  await page.goto("?showcase=1");
  await page.evaluate(() => {
    const key = "outdoors-temporary-showcase-v1",
      saved = JSON.parse(sessionStorage.getItem(key)),
      times = {
        "SHOWCASE-01": "2026-10-25T16:00:00.000Z",
        "SHOWCASE-03": "2026-10-26T15:59:59.999Z",
        "SHOWCASE-05": "2026-10-25T15:59:59.999Z",
        "SHOWCASE-06": "2026-10-26T16:00:00.000Z",
      };
    for (const row of saved.bookings)
      row.created = times[row.id] || "2026-10-20T00:00:00.000Z";
    sessionStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的申请", exact: true })
    .click();
  const from = page.getByLabel("提交开始日期（北京时间）", { exact: true }),
    to = page.getByLabel("提交结束日期（北京时间）", { exact: true }),
    rows = page.getByRole("table").locator("tbody tr");
  await from.fill("2026-10-26");
  await to.fill("2026-10-26");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "SHOWCASE-01" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "SHOWCASE-03" })).toHaveCount(1);
  await from.fill("2026-10-25");
  await to.fill("2026-10-25");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText(["SHOWCASE-05"]);
  await to.fill("2026-10-27");
  await from.fill("2026-10-27");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText(["SHOWCASE-06"]);
});

test("演示操作日志日期筛选按北京时间排除前后相邻日期", async ({ page }) => {
  await page.goto("?showcase=1");
  await role(page, "super");
  await page.evaluate(() => {
    const key = "outdoors-temporary-showcase-v1",
      saved = JSON.parse(sessionStorage.getItem(key));
    saved.audit = [
      ["BEFORE-DAY", "2026-10-25T15:59:59.999Z"],
      ["DAY-START", "2026-10-25T16:00:00.000Z"],
      ["DAY-END", "2026-10-26T15:59:59.999Z"],
      ["AFTER-DAY", "2026-10-26T16:00:00.000Z"],
    ].map(([target, created]) => ({
      id: target,
      email: "admin@showcase.invalid",
      action: "notice.saved",
      target,
      details: "{}",
      created,
    }));
    sessionStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "操作日志", exact: true })
    .click();
  const from = page.getByLabel("日志起始日期", { exact: true }),
    to = page.getByLabel("日志结束日期", { exact: true }),
    rows = page.getByRole("table").locator("tbody tr");
  await from.fill("2026-10-26");
  await to.fill("2026-10-26");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "DAY-START" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "DAY-END" })).toHaveCount(1);
  await from.fill("2026-10-25");
  await to.fill("2026-10-25");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText(["BEFORE-DAY"]);
  await to.fill("2026-10-27");
  await from.fill("2026-10-27");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText(["AFTER-DAY"]);
});

test("演示审批历史的审批人选项显示真实可读姓名并可筛选", async ({ page }) => {
  await page.goto("?showcase=1");
  await role(page, "super");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "企业申报审核", exact: true })
    .click();
  await page
    .getByRole("button", { name: "全部申请与历史", exact: true })
    .click();
  const filter = page.getByLabel("审批人", { exact: true });
  await expect(filter.locator('option[value="reviewer"]')).toHaveText(
    "审核老师",
  );
  await filter.selectOption("reviewer");
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(4);
});

test("同一过期未审核申请在管理员显示过期未审核、企业显示未通过", async ({
  page,
}) => {
  await page.goto("?showcase=1");
  await role(page, "super");
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "场地开放安排", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "企业申报审核", exact: true })
    .click();
  await expect(
    page.locator(".review-queue-item").filter({ hasText: "SHOWCASE-07" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "全部申请与历史", exact: true })
    .click();
  await page.getByRole("button", { name: "过期未审核", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "SHOWCASE-07" }),
  ).toContainText("过期未审核");
  await role(page, "enterprise");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的申请", exact: true })
    .click();
  await page.getByRole("button", { name: "未通过", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "SHOWCASE-07" });
  await expect(row).toContainText("未通过");
  await row.getByRole("button", { name: "查看详情", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("申请日期已过期");
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "撤回申请", exact: true }),
  ).toHaveCount(0);
});

test("演示存储为缺字段的合法JSON时恢复完整样本而不是陷入服务错误", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "outdoors-temporary-showcase-v1",
      JSON.stringify({
        schema: 1,
        role: "enterprise",
        users: [],
        bookings: [],
      }),
    ),
  );
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("?showcase=1");
  await expect(page.locator(".account-link")).toContainText("企业联系人");
  await expect(page.getByText("后端服务尚未连接", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "发起布展申请", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(errors).toEqual([]);
});

test("演示工作日历仅供查看，不假称已保存或重新计算真实办理时限", async ({
  page,
}) => {
  await page.goto("?showcase=1");
  await role(page, "super");
  await page
    .locator(".workspace-actions")
    .getByRole("button", { name: "通知与缴费办理", exact: true })
    .click();
  const calendar = page.locator(".case-calendar");
  await calendar.locator("summary").click();
  await calendar.getByLabel("调整日期", { exact: true }).fill("2026-10-29");
  await calendar
    .getByRole("button", { name: "保存日历调整", exact: true })
    .click();
  await expect(calendar.getByRole("alert")).toContainText(
    "临时演示仅供查看工作日历",
  );
  await expect(calendar.locator("li")).toHaveCount(0);
});
