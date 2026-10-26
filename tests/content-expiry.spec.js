import { test, expect } from "./browser-fixtures.js";

async function login(page, admin = false) {
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page
    .locator("[name=email]")
    .fill(admin ? "admin@test.local" : "completion@test.local");
  await page
    .locator("[name=password]")
    .fill(admin ? "BrowserAdmin123!" : "CompletionAccount123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.locator(".account-link")).toBeVisible();
}

test("真实过期待审在企业显示未通过、管理员显示过期未审核，保留未人工审核事实", async ({
  page,
  browser,
  extraHTTPHeaders,
}) => {
  const id = "EXPIRED-CONTENT-UI";
  await login(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的申请", exact: true })
    .click();
  await page.getByRole("button", { name: "未通过", exact: true }).click();
  const enterpriseRow = page.getByRole("row").filter({ hasText: id });
  await expect(enterpriseRow).toContainText("未通过");
  await expect(enterpriseRow).not.toContainText("过期未审核");
  await enterpriseRow.getByRole("button", { name: "查看详情" }).click();
  const detail = page.getByRole("dialog");
  await expect(detail).toContainText("过期说明");
  await expect(detail).toContainText("申请日期已过期");
  await expect(
    detail.getByRole("button", { name: "撤回申请", exact: true }),
  ).toHaveCount(0);
  await expect(detail.locator(".case-details, .case-panel")).toHaveCount(0);
  const enterpriseBooking = (
    await (await page.request.get(`/api/bookings/${id}`)).json()
  ).booking;
  expect(enterpriseBooking).toMatchObject({
    status: "未通过",
    reviewExpired: true,
    reviewed: null,
  });

  const context = await browser.newContext({ extraHTTPHeaders });
  try {
    const manager = await context.newPage();
    await login(manager, true);
    await manager
      .getByRole("navigation")
      .getByRole("button", { name: "企业申报审核", exact: true })
      .click();
    await manager
      .getByRole("button", { name: "全部申请与历史", exact: true })
      .click();
    await manager
      .getByRole("button", { name: "过期未审核", exact: true })
      .click();
    const managerRow = manager.getByRole("row").filter({ hasText: id });
    await expect(managerRow).toContainText("过期未审核");
    await expect(managerRow).toContainText("未记录");
    await managerRow.getByRole("button", { name: "查看详情" }).click();
    await expect(manager.getByRole("dialog")).toContainText("过期未审核");
    await expect(
      manager
        .getByRole("dialog")
        .getByRole("button", { name: "审核通过", exact: true }),
    ).toHaveCount(0);
    await expect(
      manager
        .getByRole("dialog")
        .getByRole("button", { name: "未通过", exact: true }),
    ).toHaveCount(0);
    const session = await (
      await manager.request.get("/api/auth/session")
    ).json();
    const review = await manager.request.post(`/api/bookings/${id}/review`, {
      headers: {
        Origin: "http://127.0.0.1:3101",
        "X-CSRF-Token": session.csrf,
        "If-Match": '"1"',
      },
      data: { status: "已通过" },
    });
    expect(review.status()).toBe(409);
    const current = (
      await (await manager.request.get(`/api/bookings/${id}`)).json()
    ).booking;
    expect(current).toMatchObject({
      status: "过期未审核",
      reviewExpired: true,
      reviewed: null,
      version: 1,
    });
    expect(current.reviewer).toBeFalsy();
  } finally {
    await context.close();
  }
});
