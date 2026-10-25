import { test, expect } from "@playwright/test";

async function role(page, value) {
  await page.getByLabel("切换演示身份", { exact: true }).selectOption(value);
}

test("演示审批历史的审批人选项显示真实可读姓名并可筛选", async ({ page }) => {
  await page.goto("?showcase=1");
  await role(page, "reviewer");
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

test("演示不能暂停已批准预约，改为无冲突位置后游客可见开放安排", async ({
  page,
}) => {
  await page.goto("?showcase=1");
  await role(page, "venue");
  await page.getByRole("button", { name: "新增暂停安排", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("[name=slot]").selectOption("3");
  await dialog
    .getByLabel("暂停原因", { exact: true })
    .fill("演示冲突暂停不应保存");
  await dialog.getByRole("button", { name: "保存安排", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("已有预约");
  await expect(dialog.locator("[name=slot]")).toHaveValue("3");
  await dialog.locator("[name=slot]").selectOption("22");
  await dialog.getByRole("button", { name: "保存安排", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("已有暂停安排");
  await dialog.locator("[name=slot]").selectOption("13");
  await dialog.getByRole("button", { name: "保存安排", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await role(page, "visitor");
  await page.getByRole("button", { name: "位置列表", exact: true }).click();
  await expect(
    page.locator(".slot-grid button").filter({ hasText: "13号" }),
  ).toContainText("暂停开放");
  await expect(
    page.locator(".slot-grid button").filter({ hasText: "03号" }),
  ).toContainText("已占用");
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
