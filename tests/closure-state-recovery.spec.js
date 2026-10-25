import { createApp } from "../server/app.mjs";
import { listenHttp } from "../server/tests/http-listen.mjs";
import { test, expect } from "./browser-fixtures.js";

async function setup(page) {
  const app = await createApp({
    dbPath: ":memory:",
    admin: { email: "closure-root@test.local", password: "ClosureRoot123!" },
    captchaTestAnswer: "246789",
    maintenance: { scheduled: false },
  });
  try {
    await listenHttp(app.server);
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    await page.goto(origin);
    await page
      .getByRole("button", { name: "登录 / 注册", exact: true })
      .click();
    await page.locator("[name=email]").fill("closure-root@test.local");
    await page.locator("[name=password]").fill("ClosureRoot123!");
    await page.getByLabel("图片验证码", { exact: true }).fill("246789");
    await page.getByRole("button", { name: "登录账号", exact: true }).click();
    await expect(page.locator(".account-link")).toBeVisible();
    const { csrf } = await (
      await page.request.get(`${origin}/api/auth/session`)
    ).json();
    const date = new Date(Date.now() + 501 * 86400000)
      .toISOString()
      .slice(0, 10);
    const created = await page.request.post(`${origin}/api/closures`, {
      headers: { Origin: origin, "X-CSRF-Token": csrf },
      data: { slot: "23", start: date, end: date, reason: "状态恢复测试暂停" },
    });
    expect(created.status()).toBe(201);
    const { items } = await (
      await page.request.get(`${origin}/api/closures`)
    ).json();
    expect(items).toHaveLength(1);
    return {
      app,
      origin,
      id: items[0].id,
      card: page.locator("section.card").filter({
        has: page.getByRole("heading", { name: "场地开放安排", exact: true }),
      }),
    };
  } catch (error) {
    await app.close();
    throw error;
  }
}
async function navigate(page) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "场地开放安排", exact: true })
    .click();
}

test("暂停安排首次读取失败不宣称全部开放，可原位重新读取实际暂停", async ({
  page,
}) => {
  const { app, card } = await setup(page);
  try {
    let unavailable = true;
    await page.route("**/api/closures", (route) =>
      unavailable
        ? route.fulfill({
            status: 503,
            json: { error: "暂停安排暂时无法读取" },
          })
        : route.continue(),
    );
    await navigate(page);
    await expect(card.getByRole("alert")).toContainText("暂停安排暂时无法读取");
    await expect(
      card.getByText("当前没有暂停安排", { exact: true }),
    ).toHaveCount(0);
    unavailable = false;
    await card
      .getByRole("button", { name: "重新读取暂停安排", exact: true })
      .click();
    await expect(card.getByRole("alert")).toHaveCount(0);
    await expect(
      card.getByRole("row").filter({ hasText: "状态恢复测试暂停" }),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});

test("恢复开放已生效但回读失败时清除旧恢复操作，重试只读不重放删除", async ({
  page,
}) => {
  const { app, origin, id, card } = await setup(page);
  try {
    await navigate(page);
    const row = card.getByRole("row").filter({ hasText: "状态恢复测试暂停" });
    await expect(row).toBeVisible();
    let unavailable = true,
      writes = 0;
    await page.route("**/api/closures", (route) =>
      unavailable
        ? route.fulfill({
            status: 503,
            json: { error: "恢复后的暂停安排读取失败" },
          })
        : route.continue(),
    );
    await page.route("**/api/closures/*", (route) => {
      if (route.request().method() === "DELETE") writes++;
      return route.continue();
    });
    await row.getByRole("button", { name: "恢复开放", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "恢复开放", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(card.getByRole("alert")).toContainText(
      "恢复后的暂停安排读取失败",
    );
    const current = await (
      await page.request.get(`${origin}/api/closures`)
    ).json();
    expect(current.items.some((item) => item.id === id)).toBe(false);
    await expect(
      card.getByRole("button", { name: "恢复开放", exact: true }),
    ).toHaveCount(0);
    await expect(card.getByRole("alert")).toContainText("已恢复开放");
    unavailable = false;
    await card
      .getByRole("button", { name: "重新读取暂停安排", exact: true })
      .click();
    await expect(card.getByRole("alert")).toHaveCount(0);
    await expect(
      card.getByText("当前没有暂停安排", { exact: true }),
    ).toBeVisible();
    expect(writes).toBe(1);
  } finally {
    await app.close();
  }
});
