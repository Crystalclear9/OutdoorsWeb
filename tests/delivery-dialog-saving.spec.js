import { test, expect } from "./browser-fixtures.js";

async function login(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.locator("[name=email]").fill("admin@test.local");
  await page.locator("[name=password]").fill("BrowserAdmin123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.locator(".account-link")).toBeVisible();
}

for (const failure of [false, true]) {
  test(`通知核实${failure ? "失败" : "成功"}的迟到响应锁定当前任务，完成后可继续处理其他任务`, async ({
    page,
  }) => {
    const items = ["A", "B"].map((letter) => ({
      id: `dialog-task-${letter}`,
      kind: "sms",
      state: "uncertain",
      phone: "13800138000",
      bookingId: `dialog-booking-${letter}`,
      created: new Date().toISOString(),
      attempts: 1,
      last_error: "等待人工核实",
      version: 1,
    }));
    await page.route("**/api/operations/deliveries?*", (route) =>
      route.fulfill({
        json: { items, page: 1, pages: 1, total: items.length },
      }),
    );
    let release, received, submitted;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const hit = new Promise((resolve) => {
      received = resolve;
    });
    await page.route(
      "**/api/operations/deliveries/dialog-task-A",
      async (route) => {
        submitted = route.request().postDataJSON();
        received();
        await held;
        if (failure) {
          await route.fulfill({
            status: 409,
            json: { error: "模拟核实保存失败，任务仍需核对" },
          });
        } else {
          items[0].state = "accepted";
          items[0].version++;
          await route.fulfill({ json: { ok: true } });
        }
      },
    );
    await login(page);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "运行维护", exact: true })
      .click();
    const first = page.getByRole("row").filter({ hasText: "dialog-booking-A" });
    const second = page
      .getByRole("row", { includeHidden: true })
      .filter({ hasText: "dialog-booking-B" });
    await first.getByRole("button", { name: "核实处理", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const reason = "已查服务商记录，受理编号 review-test-A";
    await dialog.getByLabel("核实依据或服务商编号").fill(reason);
    try {
      await dialog
        .getByRole("button", { name: "保存处理结果", exact: true })
        .click();
      await hit;
      expect(submitted).toEqual({ action: "accepted", reason, version: 1 });
      await expect(
        dialog.getByRole("button", { name: "取消", exact: true }),
      ).toBeDisabled();
      await expect(dialog.getByLabel("核实结果")).toBeDisabled();
      await expect(dialog.getByLabel("核实依据或服务商编号")).toBeDisabled();
      await expect(
        second.getByRole("button", {
          name: "核实处理",
          exact: true,
          includeHidden: true,
        }),
      ).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("关闭", { exact: true }).click();
      await expect(dialog).toBeVisible();
    } finally {
      release();
    }
    if (failure) {
      await expect(dialog.getByRole("alert")).toContainText("模拟核实保存失败");
      await expect(dialog.getByLabel("核实依据或服务商编号")).toHaveValue(
        reason,
      );
      await expect(dialog.getByLabel("核实依据或服务商编号")).toBeEnabled();
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
    } else {
      await expect(dialog).toHaveCount(0);
      await expect(first).toContainText("服务商已受理");
    }
    await second.getByRole("button", { name: "核实处理", exact: true }).click();
    await expect(dialog.getByLabel("核实依据或服务商编号")).toHaveValue("");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "保存处理结果", exact: true }),
    ).toBeEnabled();
  });
}

test("历史异常通知翻页后可核实，末页清空回退并可查看全部记录", async ({
  page,
}) => {
  let resolved = false;
  const item = (id) => ({
    id,
    kind: "sms",
    state: "uncertain",
    phone: "138****8000",
    bookingId: id,
    created: "2026-01-01T00:00:00.000Z",
    last_error: "待核实",
    version: 1,
  });
  await page.route("**/api/operations/deliveries?*", (route) => {
    const url = new URL(route.request().url());
    const all = url.searchParams.get("scope") === "all";
    const second = url.searchParams.get("page") === "2" && !resolved;
    return route.fulfill({
      json: {
        items: [
          item(all ? "全部历史记录" : second ? "old-unresolved-last-page" : "异常首页"),
        ],
        page: second ? 2 : 1,
        pages: resolved || all ? 1 : 2,
        total: all ? 101 : resolved ? 50 : 51,
      },
    });
  });
  await page.route("**/api/operations/deliveries/old-unresolved-last-page", (route) => {
    resolved = true;
    return route.fulfill({ json: { ok: true } });
  });
  await login(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "运行维护", exact: true })
    .click();
  const card = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "结果通知发送记录" }) });
  await expect(card.getByLabel("通知范围")).toHaveValue("attention");
  await card.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(card).toContainText("old-unresolved-last-page");
  await card.getByRole("button", { name: "核实处理" }).click();
  await page.getByLabel("核实依据或服务商编号").fill("服务商受理记录已确认");
  await page.getByRole("button", { name: "保存处理结果" }).click();
  await expect(card).toContainText("第 1 / 1 页");
  await expect(card).not.toContainText("old-unresolved-last-page");
  await card.getByLabel("通知范围").selectOption("all");
  await expect(card).toContainText("全部历史记录");
});
