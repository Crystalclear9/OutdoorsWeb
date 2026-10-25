import { createApp } from "../server/app.mjs";
import { listenHttp } from "../server/tests/http-listen.mjs";
import { test, expect } from "./browser-fixtures.js";

async function setup(page) {
  const app = await createApp({
    dbPath: ":memory:",
    admin: { email: "delivery-root@test.local", password: "DeliveryRoot123!" },
    captchaTestAnswer: "246789",
    maintenance: { scheduled: false },
  });
  try {
    app.db
      .prepare(
        "INSERT INTO delivery_jobs(id,kind,payload,state,next_at,created) VALUES(?,?,?,?,?,?)",
      )
      .run(
        "isolated-delivery",
        "sms",
        JSON.stringify({ phone: "13800138000", bookingId: "待核实申请" }),
        "uncertain",
        0,
        new Date().toISOString(),
      );
    await listenHttp(app.server);
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    await page.goto(origin);
    await page
      .getByRole("button", { name: "登录 / 注册", exact: true })
      .click();
    await page.locator("[name=email]").fill("delivery-root@test.local");
    await page.locator("[name=password]").fill("DeliveryRoot123!");
    await page.getByLabel("图片验证码", { exact: true }).fill("246789");
    await page.getByRole("button", { name: "登录账号", exact: true }).click();
    await expect(page.locator(".account-link")).toBeVisible();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "运行维护", exact: true })
      .click();
    const card = page.locator("section.card").filter({
      has: page.getByRole("heading", {
        name: "结果通知发送记录",
        exact: true,
      }),
    });
    await expect(
      card.getByRole("row").filter({ hasText: "待核实申请" }),
    ).toBeVisible();
    return { app, origin, card };
  } catch (error) {
    await app.close();
    throw error;
  }
}

test("通知筛选读取失败不允许操作旧记录，刷新恢复后真实核实成功", async ({
  page,
}) => {
  const { app, card } = await setup(page);
  try {
    let unavailable = true;
    await page.route("**/api/operations/deliveries?*", (route) =>
      unavailable
        ? route.fulfill({ status: 503, json: { error: "通知查询暂不可用" } })
        : route.continue(),
    );
    await card.getByLabel("通知范围").selectOption("all");
    await expect(card.getByRole("alert")).toContainText("通知查询暂不可用");
    await expect(
      card.getByRole("button", { name: "核实处理", exact: true }),
    ).toHaveCount(0);
    unavailable = false;
    await card
      .getByRole("button", { name: "刷新通知记录", exact: true })
      .click();
    await card.getByRole("button", { name: "核实处理", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("核实依据或服务商编号")
      .fill("人工核对受理编号 delivery-recovery");
    const saved = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith("/api/operations/deliveries/isolated-delivery") &&
        response.request().method() === "POST",
    );
    await dialog
      .getByRole("button", { name: "保存处理结果", exact: true })
      .click();
    expect((await saved).status()).toBe(200);
    await expect(dialog).toHaveCount(0);
    await expect(card).toContainText("服务商已受理");
    expect(
      app.db
        .prepare(
          "SELECT state,version FROM delivery_jobs WHERE id='isolated-delivery'",
        )
        .get(),
    ).toEqual({ state: "accepted", version: 2 });
  } finally {
    await app.close();
  }
});

test("通知核实的真实版本冲突不被弹窗开启时的迟到列表响应清除", async ({
  page,
}) => {
  const { app, card } = await setup(page);
  let release;
  try {
    let intercepted = false;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    await page.route("**/api/operations/deliveries?*", async (route) => {
      const response = await route.fetch();
      intercepted = true;
      await held;
      await route.fulfill({ response });
    });
    await card.getByRole("button", { name: "核实处理", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("核实依据或服务商编号")
      .fill("保留未提交的核实依据");
    app.db
      .prepare(
        "UPDATE delivery_jobs SET version=version+1 WHERE id='isolated-delivery'",
      )
      .run();
    const rejected = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith("/api/operations/deliveries/isolated-delivery") &&
        response.request().method() === "POST",
    );
    await dialog
      .getByRole("button", { name: "保存处理结果", exact: true })
      .click();
    expect((await rejected).status()).toBe(409);
    await expect(dialog.getByRole("alert")).toContainText("任务已变化，请刷新");
    if (intercepted) {
      const delivered = page.waitForResponse((response) =>
        response.url().includes("/api/operations/deliveries?"),
      );
      release();
      await delivered;
      // The old component marks loading=false only after applying this read.
      await expect(
        page.getByRole("button", {
          name: "核实处理",
          exact: true,
          includeHidden: true,
        }),
      ).toBeEnabled();
    } else release();
    await expect(dialog.getByRole("alert")).toContainText("任务已变化，请刷新");
    await expect(dialog.getByLabel("核实依据或服务商编号")).toHaveValue(
      "保留未提交的核实依据",
    );
    expect(
      app.db
        .prepare("SELECT state FROM delivery_jobs WHERE id='isolated-delivery'")
        .get().state,
    ).toBe("uncertain");
  } finally {
    release?.();
    await app.close();
  }
});
