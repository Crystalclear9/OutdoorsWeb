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

for (const outcome of ["success", "failure"]) {
  test(`新备份完成后旧维护轮询${outcome}不能覆盖最新结果`, async ({ page }) => {
    await login(page);
    await page.clock.install();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "运行维护", exact: true })
      .click();
    const run = page.getByRole("button", {
      name: "立即备份并清理",
      exact: true,
    });
    await expect(run).toBeEnabled();
    await page.waitForLoadState("networkidle");
    const initial = await (await page.request.get("/api/operations")).json();
    let release,
      received,
      delayed = false;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const hit = new Promise((resolve) => {
      received = resolve;
    });
    await page.route("**/api/operations", async (route) => {
      if (delayed) return route.continue();
      delayed = true;
      const response = await route.fetch();
      received();
      await held;
      await route.fulfill(
        outcome === "failure"
          ? { status: 503, json: { error: "旧维护轮询迟到错误" } }
          : { response },
      );
    });
    try {
      await page.clock.fastForward(10000);
      await hit;
      await run.click();
      let latest;
      await expect
        .poll(async () => {
          latest = await (await page.request.get("/api/operations")).json();
          return (
            !!latest.backup?.file && latest.backup.file !== initial.backup?.file
          );
        })
        .toBe(true);
      await expect(page.locator(".operations-grid")).toContainText(
        latest.backup.file,
      );
      await expect(run).toBeEnabled();
      const oldResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/operations" &&
          response.request().method() === "GET",
      );
      release();
      await (await oldResponse).finished();
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await expect(page.locator(".operations-grid")).toContainText(
        latest.backup.file,
      );
      await expect(
        page.getByRole("alert").filter({ hasText: "旧维护轮询迟到错误" }),
      ).toHaveCount(0);
    } finally {
      release();
    }
  });
}

test("维护状态读取慢于执行中轮询间隔时仍能显示完成结果", async ({ page }) => {
  await login(page);
  let first = true;
  await page.route("**/api/operations", async (route) => {
    const response = await route.fetch();
    const status = await response.json();
    if (first) {
      first = false;
      await route.fulfill({ response, json: { ...status, running: true } });
      return;
    }
    // A healthy response can take longer than the 1.5-second running poll.
    // It must settle before another automatic read supersedes it.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.fulfill({ response, json: { ...status, running: false } });
  });
  try {
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "运行维护", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "正在后台执行", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "立即备份并清理", exact: true }),
    ).toBeEnabled({ timeout: 6500 });
  } finally {
    await page.unrouteAll({ behavior: "wait" });
  }
});
