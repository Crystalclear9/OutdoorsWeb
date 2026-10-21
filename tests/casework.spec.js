import { test, expect } from "./browser-fixtures.js";
const IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=";
async function login(page, email, password) {
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.locator("[name=email]").fill(email);
  await page.locator("[name=password]").fill(password);
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.locator(".account-link")).toBeVisible();
}
async function headers(page) {
  const session = await (await page.request.get("/api/auth/session")).json();
  return { Origin: "http://127.0.0.1:3101", "X-CSRF-Token": session.csrf };
}
async function openCase(page, id) {
  await page
    .getByRole("button", { name: "通知与缴费办理", exact: true })
    .click();
  await page.getByLabel("搜索办理记录").fill(id);
  await page.locator(".case-row").filter({ hasText: id }).click();
  await expect(
    page.getByRole("region", { name: "办理与缴费记录" }),
  ).toBeVisible();
  return page.getByRole("region", { name: "办理与缴费记录" });
}
test("真实企业、管理员和独立财务完成费用通知、流水核对、电话跟进及取消退款，手机端可用", async ({
  page,
  browser,
}, info) => {
  const ownContext = await browser.newContext(),
    financeContext = await browser.newContext();
  try {
    const owner = await ownContext.newPage(),
      finance = await financeContext.newPage();
    await login(owner, "completion@test.local", "CompletionAccount123!");
    const date = new Date(Date.now() + 220 * 86400000)
      .toISOString()
      .slice(0, 10);
    const made = await owner.request.post("/api/bookings", {
      headers: await headers(owner),
      data: {
        company: "费用闭环界面测试企业",
        contact: "李老师",
        phone: "13900139000",
        slot: 27,
        start: date,
        end: date,
        image: IMAGE,
      },
    });
    expect(made.status()).toBe(201);
    const id = (await made.json()).id;
    await login(page, "admin@test.local", "BrowserAdmin123!");
    expect(
      (
        await page.request.post(`/api/bookings/${id}/review`, {
          headers: await headers(page),
          data: { status: "已通过" },
        })
      ).ok(),
    ).toBe(true);
    const panel = await openCase(page, id);
    await panel.getByLabel("应缴金额（元）").fill("23.45");
    await panel
      .getByLabel("收款单位与办理说明")
      .fill("校财务窗口，核对单位收款信息后付款");
    await panel.getByLabel("收费依据或免缴说明").fill("已批准的场地收费依据");
    await panel.getByRole("button", { name: "发送费用办理通知" }).click();
    await expect(panel).toContainText("人民币 23.45 元");
    const ownPanel = await openCase(owner, id);
    await expect(
      ownPanel.getByRole("button", { name: "保存费用核对" }),
    ).toHaveCount(0);
    await ownPanel
      .getByLabel("线下付款时间及流水号")
      .fill("2026-10-21 银行流水 UI-2345");
    await ownPanel.getByRole("button", { name: "提交付款流水" }).click();
    await expect(ownPanel).toContainText("流水待核对");
    await login(finance, "finance-ui@test.local", "BrowserAdmin123!");
    await expect(
      finance
        .getByRole("navigation")
        .getByRole("button", { name: "企业申报审核", exact: true }),
    ).toHaveCount(0);
    const finPanel = await openCase(finance, id);
    await finPanel
      .getByLabel("财务核对依据")
      .fill("已核对学校账户入账流水 BANK-2345");
    await finPanel.getByRole("checkbox").check();
    await finPanel.getByRole("button", { name: "保存费用核对" }).click();
    await expect(finPanel).toContainText("已核实收款");
    await expect(
      finPanel.getByRole("button", { name: "保存电话跟进" }),
    ).toHaveCount(0);
    await panel.getByLabel("结果电话状态").selectOption("reached");
    await panel
      .getByLabel("联系核对说明")
      .fill("已接通并告知审核通过及线下缴费办理方式");
    await panel.getByRole("button", { name: "保存电话跟进" }).click();
    await expect(panel).toContainText("已登记电话告知");
    await ownPanel.getByRole("button", { name: "刷新办理记录" }).click();
    await expect(ownPanel).toContainText("已登记电话告知");
    await expect(ownPanel).toContainText("已核实收款");
    await owner.setViewportSize({ width: 390, height: 844 });
    expect(
      await owner.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await owner.screenshot({
      path: info.outputPath("casework-mobile.png"),
      fullPage: true,
      animations: "disabled",
    });
    expect(
      (
        await owner.request.post(`/api/bookings/${id}/cancel`, {
          headers: { ...(await headers(owner)), "If-Match": '"2"' },
          data: { reason: "活动取消，申请线下全额退款" },
        })
      ).ok(),
    ).toBe(true);
    await finPanel.getByRole("button", { name: "刷新办理记录" }).click();
    await expect(finPanel).toContainText("预约已取消，请停止付款");
    await finPanel
      .getByLabel("财务核对依据")
      .fill("核实已全额退款，银行退款流水 REFUND-2345");
    await finPanel.getByRole("checkbox").check();
    await finPanel.getByRole("button", { name: "保存费用核对" }).click();
    await expect(finPanel).toContainText("已登记全额退款");
  } finally {
    await ownContext.close();
    await financeContext.close();
  }
});
test("超级管理员通过工作日历录入调休并恢复默认", async ({ page }) => {
  await login(page, "admin@test.local", "BrowserAdmin123!");
  await page
    .getByRole("button", { name: "通知与缴费办理", exact: true })
    .click();
  await page.getByText("维护工作日历（超级管理员）", { exact: true }).click();
  const calendar = page.locator(".case-calendar");
  const date = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  await calendar.getByLabel("调整日期").fill(date);
  await calendar.getByLabel("当日安排").selectOption("false");
  await calendar.getByRole("button", { name: "保存日历调整" }).click();
  await expect(calendar.getByRole("listitem")).toContainText(
    date + " · 休息日",
  );
  await calendar.getByLabel("当日安排").selectOption("default");
  await calendar.getByRole("button", { name: "保存日历调整" }).click();
  await expect(
    calendar.getByRole("listitem").filter({ hasText: date }),
  ).toHaveCount(0);
});
