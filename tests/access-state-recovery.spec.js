import { createApp } from "../server/app.mjs";
import { listenHttp } from "../server/tests/http-listen.mjs";
import { test, expect } from "./browser-fixtures.js";

async function setup(page) {
  const app = await createApp({
    dbPath: ":memory:",
    admin: { email: "access-root@test.local", password: "AccessRoot123!" },
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
    await page.locator("[name=email]").fill("access-root@test.local");
    await page.locator("[name=password]").fill("AccessRoot123!");
    await page.getByLabel("图片验证码", { exact: true }).fill("246789");
    await page.getByRole("button", { name: "登录账号", exact: true }).click();
    await expect(page.locator(".account-link")).toBeVisible();
    return { app, origin };
  } catch (error) {
    await page.context().close();
    await app.close();
    throw error;
  }
}
const accessCard = (page) =>
  page.locator("section.card").filter({
    has: page.getByRole("heading", { name: "管理员授权", exact: true }),
  });
const navigate = (page) =>
  page
    .getByRole("navigation")
    .getByRole("button", { name: "授权管理", exact: true })
    .click();

test("旧场地授权账号可直接改为内容审核权限，不携带已退役隐藏权限", async ({
  page,
}) => {
  const { app } = await setup(page);
  try {
    app.db
      .prepare(
        "INSERT INTO users(id,email,password_hash,role,company,contact,phone,created) SELECT 'retired-venue','retired-venue@test.local',password_hash,'admin','活动中心','原场地老师','13800138000',created FROM users LIMIT 1",
      )
      .run();
    app.db
      .prepare(
        "INSERT INTO user_permissions(user_id,permission) VALUES('retired-venue','venue.manage')",
      )
      .run();
    await navigate(page);
    await accessCard(page)
      .getByRole("row")
      .filter({ hasText: "retired-venue@test.local" })
      .getByRole("button", { name: "调整授权", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("场地开放管理", { exact: true })).toHaveCount(
      0,
    );
    await dialog.getByRole("checkbox", { name: /企业申请审核/ }).check();
    await dialog.locator('[name="currentPassword"]').fill("AccessRoot123!");
    const response = page.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" &&
        r.url().includes("/api/access/retired-venue"),
    );
    await dialog.getByRole("button", { name: "保存授权", exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(dialog).toHaveCount(0);
    expect(
      app.db
        .prepare(
          "SELECT permission FROM user_permissions WHERE user_id='retired-venue'",
        )
        .all()
        .map((row) => row.permission),
    ).toEqual(["bookings.review"]);
  } finally {
    await page.context().close();
    await app.close();
  }
});

test("授权列表首次读取失败可原位恢复，未知状态不开放账号操作", async ({
  page,
}) => {
  const { app } = await setup(page);
  try {
    let failed = true;
    await page.route("**/api/access", (route) =>
      failed
        ? route.fulfill({
            status: 503,
            json: { error: "授权列表暂时无法读取" },
          })
        : route.continue(),
    );
    await navigate(page);
    const card = accessCard(page);
    await expect(card.getByRole("alert")).toContainText("授权列表暂时无法读取");
    await expect(
      card.getByRole("button", { name: "新增管理员", exact: true }),
    ).toBeDisabled();
    failed = false;
    await card
      .getByRole("button", { name: "刷新授权列表", exact: true })
      .click();
    await expect(card.getByRole("alert")).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "新增管理员", exact: true }),
    ).toBeEnabled();
    await expect(
      card.getByRole("row").filter({ hasText: "access-root@test.local" }),
    ).toBeVisible();
  } finally {
    await page.context().close();
    await app.close();
  }
});

test("真实管理员重置密码后回读失败保留一次性密码，纯读重试不重复重置", async ({
  page,
}) => {
  const { app, origin } = await setup(page);
  try {
    const { csrf } = await (
      await page.request.get(`${origin}/api/auth/session`)
    ).json();
    const response = await page.request.post(`${origin}/api/access/staff`, {
      headers: { Origin: origin, "X-CSRF-Token": csrf },
      data: {
        email: "recover-staff@test.local",
        contact: "恢复测试老师",
        permissions: ["notices.manage"],
        currentPassword: "AccessRoot123!",
      },
    });
    expect(response.status()).toBe(201);
    const created = await response.json();
    await navigate(page);
    const card = accessCard(page),
      row = card
        .getByRole("row")
        .filter({ hasText: "recover-staff@test.local" });
    await expect(row).toBeVisible();
    let failed = true,
      writes = 0;
    await page.route("**/api/access", (route) =>
      failed
        ? route.fulfill({
            status: 503,
            json: { error: "重置后的列表读取失败" },
          })
        : route.continue(),
    );
    await page.route("**/api/users/*/reset-password", (route) => {
      writes++;
      return route.continue();
    });
    await row.getByRole("button", { name: "重置密码", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认操作", exact: true })
      .click();
    const dialog = page.getByRole("dialog"),
      password = dialog.locator(".temporary-password");
    await expect(password).toBeVisible();
    const temporary = await password.innerText();
    expect(temporary.length).toBeGreaterThanOrEqual(10);
    expect(
      app.db
        .prepare("SELECT version FROM users WHERE id=?")
        .get(created.user.id).version,
    ).toBe(2);
    await expect(dialog.getByRole("alert")).toContainText(
      "重置后的列表读取失败",
    );
    await expect(dialog.getByRole("alert")).toContainText("已保存");
    failed = false;
    await dialog
      .getByRole("button", { name: "重新读取授权列表", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(password).toHaveText(temporary);
    await dialog
      .getByRole("button", { name: "已妥善记录", exact: true })
      .click();
    await expect(row).toBeVisible();
    expect(writes).toBe(1);
    expect(
      app.db
        .prepare("SELECT version FROM users WHERE id=?")
        .get(created.user.id).version,
    ).toBe(2);
  } finally {
    await page.context().close();
    await app.close();
  }
});
