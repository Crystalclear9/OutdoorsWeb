import { test, expect } from "./browser-fixtures.js";

const IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=";
async function login(page, admin = false) {
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
async function headers(page) {
  const { csrf } = await (await page.request.get("/api/auth/session")).json();
  return { Origin: "http://127.0.0.1:3101", "X-CSRF-Token": csrf };
}
async function createCase(owner, admin, index) {
  const day = new Date(Date.now() + (311 + index) * 86400000)
    .toISOString()
    .slice(0, 10);
  const made = await owner.request.post("/api/bookings", {
    headers: await headers(owner),
    data: {
      company: `办理导航保存企业-${index}`,
      contact: "张老师",
      phone: "13800138000",
      slot: 24,
      start: day,
      end: day,
      image: IMAGE,
    },
  });
  expect(made.status()).toBe(201);
  const { id } = await made.json();
  expect(
    (
      await admin.request.post(`/api/bookings/${id}/review`, {
        headers: { ...(await headers(admin)), "If-Match": '"1"' },
        data: { status: "已通过" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await admin.request.post(`/api/casework/${id}/fee`, {
        headers: await headers(admin),
        data: {
          action: "issue",
          amountFen: 1234,
          instructions: "单位窗口",
          note: "核定费用",
        },
      })
    ).status(),
  ).toBe(200);
  return id;
}

test("独立办理页保存期间锁定记录切换，失败后草稿及错误保留并恢复切换", async ({
  page,
  browser,
  extraHTTPHeaders,
}) => {
  const adminContext = await browser.newContext({ extraHTTPHeaders });
  let release;
  try {
    const admin = await adminContext.newPage();
    await login(page);
    await login(admin, true);
    const first = await createCase(page, admin, 0),
      second = await createCase(page, admin, 1);
    // Keep the records and writes real, exposing an extra list page so the
    // pagination lock is tested while "next page" would otherwise be enabled.
    await page.route("**/api/casework?**", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({ response, json: { ...data, pages: 2, total: 16 } });
    });
    await page
      .getByRole("button", { name: "通知与缴费办理", exact: true })
      .click();
    await page.getByLabel("搜索办理记录").fill("办理导航保存企业-");
    const firstRow = page.locator(".case-row").filter({ hasText: first }),
      secondRow = page.locator(".case-row").filter({ hasText: second });
    await firstRow.click();
    const nextPage = page.getByRole("button", { name: "下一页", exact: true });
    await expect(nextPage).toBeEnabled();
    const panel = page.getByRole("region", { name: "办理与缴费记录" });
    const input = panel.getByLabel("线下付款时间及流水号");
    await input.fill("BANK-NAVIGATION-DRAFT");
    let received;
    const held = new Promise((resolve) => {
        release = resolve;
      }),
      hit = new Promise((resolve) => {
        received = resolve;
      });
    await page.route(`**/api/casework/${first}/fee`, async (route) => {
      received();
      await held;
      await route.fulfill({
        status: 503,
        json: { error: "模拟保存失败，保留本单草稿" },
      });
    });
    await panel
      .getByRole("button", { name: "提交付款流水", exact: true })
      .click();
    await hit;
    await expect(secondRow).toBeDisabled();
    await expect(page.getByLabel("办理范围")).toBeDisabled();
    await expect(page.getByLabel("搜索办理记录")).toBeDisabled();
    await expect(nextPage).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "刷新办理队列", exact: true }),
    ).toBeDisabled();
    release();
    await expect(panel.getByRole("alert")).toContainText(
      "模拟保存失败，保留本单草稿",
    );
    await expect(input).toHaveValue("BANK-NAVIGATION-DRAFT");
    await expect(secondRow).toBeEnabled();
    await expect(page.getByLabel("办理范围")).toBeEnabled();
    await expect(nextPage).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "刷新办理队列", exact: true }),
    ).toBeEnabled();
    await page.unroute(`**/api/casework/${first}/fee`);
    await panel
      .getByRole("button", { name: "提交付款流水", exact: true })
      .click();
    await expect(
      panel.getByRole("region", { name: "当前办理与下一步" }),
    ).toContainText("等待财务核实到账");
    expect(
      (await (await page.request.get(`/api/casework/${first}`)).json()).item.fee
        .state,
    ).toBe("submitted");
    await secondRow.click();
    await expect(panel).toContainText("办理导航保存企业-1");
  } finally {
    release?.();
    await adminContext.close();
  }
});
