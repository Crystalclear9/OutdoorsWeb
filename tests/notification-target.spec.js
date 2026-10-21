import { test, expect } from "./browser-fixtures.js";
const image =
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
  const r = await (await page.request.get("/api/auth/session")).json();
  return { Origin: "http://127.0.0.1:3101", "X-CSRF-Token": r.csrf };
}
test("独立财务点击付款消息直接定位对应申请，无需手工翻页搜索", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext();
  try {
    const owner = await context.newPage();
    await login(owner, "completion@test.local", "CompletionAccount123!");
    const date = new Date(Date.now() + 444 * 86400000)
        .toISOString()
        .slice(0, 10),
      company = "通知定位测试-" + Date.now();
    const created = await owner.request.post("/api/bookings", {
      headers: await headers(owner),
      data: {
        company,
        contact: "李老师",
        phone: "13900139000",
        slot: 22,
        start: date,
        end: date,
        image,
      },
    });
    expect(created.status()).toBe(201);
    const id = (await created.json()).id;
    await login(page, "admin@test.local", "BrowserAdmin123!");
    expect(
      (
        await page.request.post(`/api/bookings/${id}/review`, {
          headers: await headers(page),
          data: { status: "已通过" },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await page.request.post(`/api/casework/${id}/fee`, {
          headers: await headers(page),
          data: {
            action: "issue",
            amountFen: 100,
            instructions: "测试单位窗口",
            note: "已核准收费",
          },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await owner.request.post(`/api/casework/${id}/fee`, {
          headers: { ...(await headers(owner)), "If-Match": '"1"' },
          data: { action: "submit", reference: "测试流水-定位" },
        })
      ).ok(),
    ).toBe(true);
    await page.getByRole("button", { name: "退出登录" }).click();
    await page.goto("/");
    await login(page, "finance-ui@test.local", "BrowserAdmin123!");
    await page
      .locator(".notification-items button")
      .filter({ hasText: company })
      .click();
    await expect(page.getByLabel("搜索办理记录")).toHaveValue(id);
    const panel = page.getByRole("region", { name: "办理与缴费记录" });
    await expect(panel).toContainText(company);
    await expect(panel).toContainText("流水待核对");
    await expect(page.getByLabel("办理范围")).toHaveValue("all");
  } finally {
    await context.close();
  }
});
