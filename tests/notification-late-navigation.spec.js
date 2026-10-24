import { test, expect } from "./browser-fixtures.js";

const IMAGE =
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
  const { csrf } = await (await page.request.get("/api/auth/session")).json();
  return { Origin: "http://127.0.0.1:3101", "X-CSRF-Token": csrf };
}
async function approved(owner, admin, index) {
  const day = new Date(Date.now() + (321 + index) * 86400000)
    .toISOString()
    .slice(0, 10);
  const response = await owner.request.post("/api/bookings", {
    headers: await headers(owner),
    data: {
      company: `迟到导航保护企业-${index}`,
      contact: "李老师",
      phone: "13800138000",
      start: day,
      end: day,
      slot: 23,
      image: IMAGE,
    },
  });
  expect(response.status()).toBe(201);
  const { id } = await response.json();
  expect(
    (
      await admin.request.post(`/api/bookings/${id}/review`, {
        headers: { ...(await headers(admin)), "If-Match": '"1"' },
        data: { status: "已通过" },
      })
    ).status(),
  ).toBe(200);
  return id;
}
async function hold(page, pattern, fail = false) {
  let release, received;
  const gate = new Promise((resolve) => {
      release = resolve;
    }),
    hit = new Promise((resolve) => {
      received = resolve;
    });
  await page.route(pattern, async (route) => {
    const response = fail ? null : await route.fetch();
    received();
    await gate;
    await route.fulfill(
      fail
        ? { status: 503, json: { error: "模拟费用保存失败，保留新单草稿" } }
        : { response },
    );
  });
  return { release, hit };
}

test("离开消息页后迟到的已读响应不能跳走正在保存的新办理记录", async ({
  page,
  browser,
  extraHTTPHeaders,
}) => {
  const ownerContext = await browser.newContext({ extraHTTPHeaders }),
    adminContext = await browser.newContext({ extraHTTPHeaders });
  let delayedRead, delayedSave;
  try {
    const owner = await ownerContext.newPage(),
      admin = await adminContext.newPage();
    await login(owner, "completion@test.local", "CompletionAccount123!");
    await login(admin, "admin@test.local", "BrowserAdmin123!");
    await approved(owner, admin, 0);
    const second = await approved(owner, admin, 1);
    await login(page, "finance-ui@test.local", "BrowserAdmin123!");
    const message = page
      .locator(".notification-items button")
      .filter({ hasText: "迟到导航保护企业-0" });
    await expect(message).toHaveCount(1);
    delayedRead = await hold(page, "**/api/notifications/read");
    await message.click();
    await delayedRead.hit;
    // Navigation is deliberately allowed before the old notification settles.
    await page
      .getByRole("button", { name: "通知与缴费办理", exact: true })
      .click();
    await page.getByLabel("搜索办理记录").fill("迟到导航保护企业-");
    await page.locator(".case-row").filter({ hasText: second }).click();
    const panel = page.getByRole("region", { name: "办理与缴费记录" });
    await panel.getByLabel("应缴金额（元）").fill("23.45");
    await panel.getByLabel("收款单位与办理说明").fill("单位财务窗口");
    await panel.getByLabel("收费依据或免缴说明").fill("不可丢失的新单收费草稿");
    delayedSave = await hold(page, `**/api/casework/${second}/fee`, true);
    await panel
      .getByRole("button", { name: "发送费用办理通知", exact: true })
      .click();
    await delayedSave.hit;
    delayedRead.release();
    delayedSave.release();
    await expect(panel.getByRole("alert")).toContainText(
      "模拟费用保存失败，保留新单草稿",
    );
    await expect(panel).toContainText("迟到导航保护企业-1");
    await expect(panel.getByLabel("收费依据或免缴说明")).toHaveValue(
      "不可丢失的新单收费草稿",
    );
    await expect(panel.getByLabel("应缴金额（元）")).toHaveValue("23.45");
    await expect(page.getByLabel("搜索办理记录")).toHaveValue(
      "迟到导航保护企业-",
    );
  } finally {
    delayedRead?.release();
    delayedSave?.release();
    await ownerContext.close();
    await adminContext.close();
  }
});
