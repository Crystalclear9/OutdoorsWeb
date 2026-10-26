import { test, expect } from "@playwright/test";

async function role(page, key) {
  const label = { enterprise: "企业", super: "管理员", visitor: "游客" }[key];
  const button = page
    .getByRole("group", { name: "切换演示身份", exact: true })
    .getByRole("button", { name: label, exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

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
