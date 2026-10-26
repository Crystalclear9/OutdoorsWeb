import { test, expect } from "./browser-fixtures.js";

const id = "DAY-EXPIRY-UI";
async function login(page, admin = false) {
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册", exact: true }).click();
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

async function readPreviousEvening(page, admin) {
  const response = await page.request.get(`/api/bookings/${id}`);
  expect(response.status()).toBe(200);
  const { booking } = await response.json();
  expect(booking).toMatchObject({
    id,
    status: admin ? "过期未审核" : "未通过",
    reviewExpired: true,
  });
  await page.clock.install({
    time: new Date(`${booking.start}T23:59:45+08:00`),
  });
  let firstSnapshot = true,
    listReads = 0,
    writes = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.startsWith("/api/bookings")
    )
      writes++;
  });
  await page.route("**/api/bookings?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("q") !== id) return route.continue();
    listReads++;
    if (!firstSnapshot) return route.continue();
    firstSnapshot = false;
    const response = await route.fetch();
    const body = await response.json();
    expect(body.items.some((item) => item.id === id)).toBe(true);
    // Reconstruct only the previously read evening snapshot. All later reads
    // use the actual API, which already classifies this stored pending record
    // as expired; this route never manufactures an approval or a mutation.
    body.items = body.items.map((item) =>
      item.id === id
        ? {
            ...item,
            status: "待审核",
            reviewExpired: false,
            reason: "",
            ...(item.reviewCheck
              ? { reviewCheck: { blockers: [], competing: 0 } }
              : {}),
          }
        : item,
    );
    await route.fulfill({ response, json: body });
  });
  await page
    .getByRole("navigation")
    .getByRole("button", {
      name: admin ? "企业申报审核" : "我的申请",
      exact: true,
    })
    .click();
  if (admin)
    await page
      .getByRole("button", { name: "全部申请与历史", exact: true })
      .click();
  await page.getByLabel("搜索申请", { exact: true }).fill(id);
  const row = page.getByRole("row").filter({ hasText: id });
  await expect(row).toContainText("待审核");
  return {
    row,
    start: booking.start,
    reads: () => listReads,
    writes: () => writes,
  };
}

test("恢复焦点时核对已变化的北京时间日期，不必等待下一次轮询", async ({
  page,
}) => {
  await login(page);
  const snapshot = await readPreviousEvening(page, false);
  await page.clock.setSystemTime(
    new Date(new Date(`${snapshot.start}T23:59:45+08:00`).getTime() + 60000),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(snapshot.row).toContainText("未通过");
  expect(snapshot.reads()).toBeGreaterThanOrEqual(2);
  expect(snapshot.writes()).toBe(0);
});

for (const admin of [false, true]) {
  test(`${admin ? "管理员" : "企业"}历史列表跨北京时间午夜后自动纯读并显示对应过期状态`, async ({
    page,
  }) => {
    await login(page, admin);
    const snapshot = await readPreviousEvening(page, admin);
    await page.clock.fastForward(31000);
    await expect(snapshot.row).toContainText(admin ? "过期未审核" : "未通过");
    await expect(snapshot.row).not.toContainText("待审核");
    await expect(
      snapshot.row.getByRole("button", { name: "查看详情", exact: true }),
    ).toBeVisible();
    expect(snapshot.reads()).toBeGreaterThanOrEqual(2);
    expect(snapshot.writes()).toBe(0);
  });
}

test("已打开审批详情跨午夜核对失败暂停写入，纯GET恢复显示过期并保留审核意见", async ({
  page,
}) => {
  await login(page, true);
  const snapshot = await readPreviousEvening(page, true);
  await snapshot.row
    .getByRole("button", { name: "审核申请", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const approve = dialog.getByRole("button", { name: "审核通过", exact: true });
  await expect(approve).toBeEnabled();
  const draft = "跨日核对前正在填写的桁架审核意见";
  await dialog.getByRole("textbox").fill(draft);
  let unavailable = true,
    stateReads = 0;
  await page.route(`**/api/bookings/${id}`, async (route) => {
    stateReads++;
    if (unavailable)
      await route.fulfill({
        status: 503,
        json: { error: "模拟跨日状态读取失败" },
      });
    else await route.continue();
  });
  await page.clock.fastForward(31000);
  await expect(dialog.getByRole("alert")).toContainText("重新读取当前状态失败");
  await expect(approve).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "未通过", exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByRole("textbox")).toHaveValue(draft);
  await approve.evaluate((button) => button.click());
  expect(snapshot.writes()).toBe(0);
  unavailable = false;
  await dialog
    .getByRole("button", { name: "重新读取申请状态", exact: true })
    .click();
  await expect(dialog).toContainText("最新申请状态已读取");
  await expect(dialog).toContainText("过期未审核");
  await expect(dialog).toContainText("保留的审核意见草稿");
  await expect(dialog).toContainText(draft);
  await expect(approve).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "未通过", exact: true }),
  ).toHaveCount(0);
  expect(stateReads).toBeGreaterThanOrEqual(2);
  expect(snapshot.writes()).toBe(0);
  const saved = (await (await page.request.get(`/api/bookings/${id}`)).json())
    .booking;
  expect(saved).toMatchObject({
    status: "过期未审核",
    reviewExpired: true,
    reviewed: null,
    version: 1,
  });
});
