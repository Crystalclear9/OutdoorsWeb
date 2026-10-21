import { test, expect } from "./browser-fixtures.js";
async function login(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.locator("[name=email]").fill("admin@test.local");
  await page.locator("[name=password]").fill("BrowserAdmin123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.locator(".account-link")).toBeVisible();
  await page
    .getByRole("button", { name: "通知与缴费办理", exact: true })
    .click();
}
const record = () => ({
  id: "PRODUCT-REVIEW",
  company: "产品复核企业",
  slot: 1,
  status: "已通过",
  phone: "13800138000",
  cancelled: 1,
  due: "2030-01-01T02:00:00Z",
  contactResult: { state: "reached", attempts: 1, version: 2, note: "原记录" },
  fee: { state: "void", version: 2, amount_fen: 1200, note: "已取消" },
});
test("财务显式登记取消后到账并全额退款，电话完成登记可显式纠正", async ({
  page,
}) => {
  const item = record();
  const actions = [];
  await page.route("**/api/casework?**", (r) =>
    r.fulfill({ json: { items: [item], pages: 1, page: 1, total: 1 } }),
  );
  await page.route("**/api/casework/PRODUCT-REVIEW**", async (r) => {
    if (r.request().method() === "POST") {
      const data = r.request().postDataJSON();
      actions.push(data);
      expect(r.request().headers()["if-match"]).toBe(
        `"${r.request().url().endsWith("/contact") ? item.contactResult.version : item.fee.version}"`,
      );
      if (data.action === "late_confirm")
        item.fee = {
          ...item.fee,
          state: "paid",
          reference: data.reference,
          version: 3,
        };
      if (data.action === "refund")
        item.fee = { ...item.fee, state: "refunded", version: 4 };
      if (data.action === "reopen")
        item.contactResult = {
          ...item.contactResult,
          state: "unreachable",
          version: 3,
        };
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({ json: { item } });
  });
  await login(page);
  await page.locator(".case-row").click();
  const panel = page.getByRole("region", { name: "办理与缴费记录" });
  await panel.getByLabel("取消后到账流水").fill("BANK-LATE-UI");
  await panel.getByLabel("迟到到账核对依据").fill("核对学校账户实际到账");
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "登记取消后到账" }).click();
  await expect(panel).toContainText("已核实收款");
  await panel.getByLabel("财务核对依据").fill("已线下全额退款 REFUND-UI");
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "保存费用核对" }).click();
  await expect(panel).toContainText("已登记全额退款");
  item.cancelled = 0;
  await panel.getByRole("button", { name: "刷新办理记录" }).click();
  await panel.getByLabel("重新跟进原因").fill("原登记有误，需要重新拨号");
  await panel.getByRole("button", { name: "纠正登记并重新跟进" }).click();
  await expect(panel.getByLabel("结果电话状态")).toBeVisible();
  expect(actions.map((a) => a.action)).toEqual([
    "late_confirm",
    "refund",
    "reopen",
  ]);
});
test("办理队列末页缩减自动回退，工作日历首次读取失败可直接重试", async ({
  page,
}) => {
  let shrunk = false,
    calendarAttempts = 0;
  const item = record();
  await page.route("**/api/casework?**", (r) => {
    const requested = Number(
      new URL(r.request().url()).searchParams.get("page"),
    );
    return r.fulfill({
      json: {
        items: shrunk && requested === 2 ? [] : [item],
        page: requested,
        pages: shrunk ? 1 : 2,
        total: shrunk ? 1 : 16,
      },
    });
  });
  await page.route("**/api/casework/calendar", (r) => {
    calendarAttempts++;
    return calendarAttempts === 1
      ? r.fulfill({ status: 503, json: { error: "日历读取暂时失败" } })
      : r.fulfill({ json: { version: 1, items: [] } });
  });
  await login(page);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator(".pagination")).toContainText("2");
  shrunk = true;
  await page.getByRole("button", { name: "刷新办理队列" }).click();
  await expect(page.locator(".pagination")).toContainText("1 / 1");
  await expect(page.locator(".case-row")).toHaveCount(1);
  await page.getByText("维护工作日历（超级管理员）", { exact: true }).click();
  const calendar = page.locator(".case-calendar");
  await expect(calendar).toContainText("日历读取暂时失败");
  await calendar.getByRole("button", { name: "重新读取工作日历" }).click();
  await expect(calendar.getByLabel("调整日期")).toBeVisible();
  await expect(calendar).not.toContainText("日历读取暂时失败");
});
