import { test, expect } from "./browser-fixtures.js";

for (const admin of [true, false]) {
  test(`${admin ? "管理员" : "企业"}工作台读取失败不显示零统计或已处理空态，纯读恢复后再次故障清除旧数`, async ({
    page,
  }) => {
    let unavailable = true,
      writes = 0;
    await page.route("**/api/summary", (route) =>
      unavailable
        ? route.fulfill({ status: 503, json: { error: "统计服务测试故障" } })
        : route.continue(),
    );
    await page.route("**/api/bookings?**", (route) =>
      unavailable
        ? route.fulfill({ status: 503, json: { error: "申请列表测试故障" } })
        : route.continue(),
    );
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname.startsWith("/api/bookings")
      )
        writes++;
    });
    await page.clock.install();
    await page.goto("/");
    await page
      .getByRole("button", { name: "登录 / 注册", exact: true })
      .click();
    await page
      .locator("[name=email]")
      .fill(admin ? "admin@test.local" : "completion@test.local");
    await page
      .locator("[name=password]")
      .fill(admin ? "BrowserAdmin123!" : "CompletionAccount123!");
    await page.getByLabel("图片验证码", { exact: true }).fill("246789");
    await page.getByRole("button", { name: "登录账号", exact: true }).click();
    const retry = page.getByRole("button", {
      name: "重新读取申请统计",
      exact: true,
    });
    const cards = page.locator(".dashboard-metrics button");
    async function unknown() {
      await expect(retry).toBeVisible();
      await expect(
        page.getByText("申请列表测试故障", { exact: true }),
      ).toBeVisible();
      await expect(cards).toHaveCount(4);
      for (const card of await cards.all()) {
        await expect(card).toBeDisabled();
        await expect(card.locator("strong")).toContainText("—");
      }
      await expect(
        page.getByText(admin ? "待办已处理完毕" : "还没有提交申请", {
          exact: true,
        }),
      ).toHaveCount(0);
      if (admin)
        await expect(page.getByText(/当前有 \d+ 条申请等待审核/)).toHaveCount(
          0,
        );
    }
    await unknown();
    unavailable = false;
    await retry.click();
    await expect(retry).toHaveCount(0);
    await expect(cards.first()).toBeEnabled();
    await expect(cards.last().locator("strong")).toHaveText(/\d+条/);
    unavailable = true;
    await page.clock.fastForward(31000);
    await unknown();
    unavailable = false;
    await retry.click();
    await expect(cards.first()).toBeEnabled();
    await expect(retry).toHaveCount(0);
    expect(writes).toBe(0);
  });
}
