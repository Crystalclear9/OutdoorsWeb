import { test, expect } from "./browser-fixtures.js";

async function openCalendar(page) {
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
  await page.getByText("维护工作日历（超级管理员）", { exact: true }).click();
  return page.locator(".case-calendar");
}

for (const failReload of [false, true]) {
  test(`日历保存冲突后${failReload ? "读取失败禁止旧版本重试并可人工恢复" : "读取成功仍保留保存错误和待核对输入"}`, async ({
    page,
  }) => {
    const date = new Date(Date.now() + 41 * 86400000)
      .toISOString()
      .slice(0, 10);
    let gets = 0,
      puts = 0,
      release,
      received,
      submitted;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const hit = new Promise((resolve) => {
      received = resolve;
    });
    await page.route("**/api/casework/calendar", async (route) => {
      gets++;
      if (gets === 1) {
        await route.fulfill({ json: { version: 1, items: [] } });
        return;
      }
      if (gets === 2) {
        received();
        await held;
        if (failReload) {
          await route.fulfill({
            status: 503,
            json: { error: "日历重读暂时失败" },
          });
          return;
        }
      }
      await route.fulfill({
        json: { version: 2, items: [{ date, working: true }] },
      });
    });
    await page.route(`**/api/casework/calendar/${date}`, async (route) => {
      puts++;
      submitted = {
        version: route.request().headers()["if-match"],
        body: route.request().postDataJSON(),
      };
      await route.fulfill({
        status: 409,
        json: { error: "日历已被其他管理员修改" },
      });
    });
    const calendar = await openCalendar(page);
    await calendar.getByLabel("调整日期").fill(date);
    await calendar.getByLabel("当日安排").selectOption("false");
    try {
      await calendar
        .getByRole("button", { name: "保存日历调整", exact: true })
        .click();
      await hit;
      expect(submitted).toEqual({ version: '"1"', body: { working: false } });
      await expect(
        calendar.getByRole("button", { name: "保存日历调整", exact: true }),
      ).toBeDisabled();
      await expect(
        calendar.getByRole("button", { name: "重新读取工作日历", exact: true }),
      ).toBeDisabled();
      await expect(calendar.getByLabel("调整日期")).toBeDisabled();
      await expect(calendar.getByLabel("当日安排")).toBeDisabled();
      expect(puts).toBe(1);
    } finally {
      release();
    }
    await expect(calendar.getByRole("alert")).toContainText(
      "日历已被其他管理员修改",
    );
    await expect(calendar.getByLabel("调整日期")).toHaveValue(date);
    await expect(calendar.getByLabel("当日安排")).toHaveValue("false");
    if (failReload) {
      await expect(calendar.getByRole("alert")).toContainText(
        "日历重读暂时失败",
      );
      await expect(
        calendar.getByRole("button", { name: "保存日历调整", exact: true }),
      ).toBeDisabled();
      await calendar
        .getByRole("button", { name: "重新读取工作日历", exact: true })
        .click();
      await expect(calendar.getByRole("alert")).toHaveCount(0);
      expect(gets).toBe(3);
    } else {
      await expect(calendar.getByRole("alert")).toContainText(
        "请核对日期与安排后重新提交",
      );
      expect(gets).toBe(2);
    }
    await expect(calendar.getByRole("listitem")).toContainText(
      `${date} · 工作日`,
    );
    await expect(calendar.getByLabel("调整日期")).toHaveValue(date);
    await expect(calendar.getByLabel("当日安排")).toHaveValue("false");
    await expect(
      calendar.getByRole("button", { name: "保存日历调整", exact: true }),
    ).toBeEnabled();
    expect(puts).toBe(1);
  });
}
