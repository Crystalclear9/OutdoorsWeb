import { test, expect } from "./browser-fixtures.js";

async function login(page, admin) {
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
async function metric(page, label, status) {
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/bookings" &&
      new URL(r.url()).searchParams.get("status") === status &&
      r.ok(),
  );
  await page
    .locator(".dashboard-metrics button")
    .filter({ hasText: label })
    .click();
  await response;
  await expect(page.locator(".records-card .tabs button.selected")).toHaveText(
    status || "全部申请",
  );
}

test("管理员过期和已通过统计直达对应历史分类，待处理仍直达审批队列", async ({
  page,
}) => {
  await login(page, true);
  await metric(page, "过期未审核", "过期未审核");
  await expect(
    page.getByRole("row").filter({ hasText: "EXPIRED-CONTENT-UI" }),
  ).toContainText("过期未审核");
  await expect(page.locator(".review-topbar .tabs button.selected")).toHaveText(
    "全部申请与历史",
  );
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "服务工作台", exact: true })
    .click();
  await metric(page, "已通过", "已通过");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "服务工作台", exact: true })
    .click();
  await metric(page, "累计申报", "");
  await expect(page.locator(".review-topbar .tabs button.selected")).toHaveText(
    "全部申请与历史",
  );
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "服务工作台", exact: true })
    .click();
  await page
    .locator(".dashboard-metrics button")
    .filter({ hasText: "待处理申请" })
    .click();
  await expect(page.locator(".review-topbar .tabs button.selected")).toHaveText(
    "待办审批",
  );
});

test("企业未通过统计直达本人未通过记录，不显示内部过期分类", async ({
  page,
}) => {
  await login(page, false);
  await metric(page, "未通过", "未通过");
  await expect(
    page.getByRole("row").filter({ hasText: "EXPIRED-CONTENT-UI" }),
  ).toContainText("未通过");
  await expect(
    page.getByRole("button", { name: "过期未审核", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "服务工作台", exact: true })
    .click();
  await metric(page, "我的待审核", "待审核");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "服务工作台", exact: true })
    .click();
  await metric(page, "我的申请总数", "");
});
