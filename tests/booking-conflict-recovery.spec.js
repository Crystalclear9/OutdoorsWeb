import { randomUUID } from "node:crypto";
import { test, expect } from "./browser-fixtures.js";

const origin = "http://127.0.0.1:3101";
const image =
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
async function headers(page, version) {
  const session = await (await page.request.get("/api/auth/session")).json();
  return {
    Origin: origin,
    "X-CSRF-Token": session.csrf,
    ...(version ? { "If-Match": `"${version}"` } : {}),
  };
}
async function createBooking(owner) {
  await login(owner);
  const date = new Date(Date.now() + 227 * 86400000).toISOString().slice(0, 10);
  const response = await owner.request.post("/api/bookings", {
    headers: await headers(owner),
    data: {
      company: `详情冲突恢复-${randomUUID()}`,
      contact: "企业联系人",
      phone: "13800138000",
      builder_contact: "搭建联系人",
      builder_phone: "027-87540000",
      start: date,
      end: date,
      image,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id;
}
async function managerDetail(manager, id) {
  await login(manager, true);
  await manager
    .getByRole("navigation")
    .getByRole("button", { name: "企业申报审核", exact: true })
    .click();
  await manager
    .getByRole("button", { name: "全部申请与历史", exact: true })
    .click();
  await manager.getByLabel("搜索申请", { exact: true }).fill(id);
  await manager
    .getByRole("row")
    .filter({ hasText: id })
    .getByRole("button", { name: "审核申请", exact: true })
    .click();
  const dialog = manager.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "审核通过", exact: true }),
  ).toBeEnabled();
  return dialog;
}

test("跨账号撤回导致审批409且回读503时暂停旧操作，纯GET恢复保留意见并显示真实结果", async ({
  page,
  browser,
  extraHTTPHeaders,
}) => {
  const id = await createBooking(page);
  const context = await browser.newContext({ extraHTTPHeaders });
  try {
    const manager = await context.newPage();
    const dialog = await managerDetail(manager, id);
    const draft = "需要保留的桁架内容审核意见";
    await dialog.getByRole("textbox").fill(draft);
    const withdrawn = await page.request.post(`/api/bookings/${id}/withdraw`, {
      headers: await headers(page, 1),
    });
    expect(withdrawn.status()).toBe(200);
    let failRead = true,
      reads = 0,
      writes = 0;
    await manager.route(`**/api/bookings/${id}`, async (route) => {
      reads++;
      if (failRead)
        await route.fulfill({
          status: 503,
          json: { error: "模拟状态读取失败" },
        });
      else await route.continue();
    });
    await manager.route(`**/api/bookings/${id}/review`, async (route) => {
      writes++;
      await route.continue();
    });
    const approve = dialog.getByRole("button", {
      name: "审核通过",
      exact: true,
    });
    await approve.click();
    await expect(dialog.getByRole("alert")).toContainText(
      "重新读取当前状态失败",
    );
    await expect(dialog.getByRole("textbox")).toHaveValue(draft);
    await expect(dialog.getByRole("textbox")).toBeDisabled();
    await expect(approve).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "未通过", exact: true }),
    ).toBeDisabled();
    await approve.evaluate((button) => button.click());
    expect(writes).toBe(1);
    failRead = false;
    await dialog
      .getByRole("button", { name: "重新读取申请状态", exact: true })
      .click();
    await expect(dialog).toContainText("最新申请状态已读取");
    await expect(dialog).toContainText("已撤回");
    await expect(dialog).toContainText("保留的审核意见草稿");
    await expect(dialog).toContainText(draft);
    await expect(approve).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "未通过", exact: true }),
    ).toHaveCount(0);
    await expect(dialog).toBeVisible();
    expect(reads).toBe(2);
    expect(writes).toBe(1);
    const saved = (await (await page.request.get(`/api/bookings/${id}`)).json())
      .booking;
    expect(saved).toMatchObject({ status: "已撤回", version: 2 });
  } finally {
    await context.close();
  }
});

test("管理员取消后企业旧改期提交409，纯读恢复保留草稿且禁止再次提交已取消申请", async ({
  page,
  browser,
  extraHTTPHeaders,
}) => {
  const id = await createBooking(page);
  const context = await browser.newContext({ extraHTTPHeaders });
  let releaseRead;
  const held = new Promise((resolve) => {
    releaseRead = resolve;
  });
  try {
    const manager = await context.newPage();
    await login(manager, true);
    expect(
      (
        await manager.request.post(`/api/bookings/${id}/review`, {
          headers: await headers(manager, 1),
          data: { status: "已通过" },
        })
      ).status(),
    ).toBe(200);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "我的申请", exact: true })
      .click();
    await page.getByLabel("搜索申请", { exact: true }).fill(id);
    await page
      .getByRole("row")
      .filter({ hasText: id })
      .getByRole("button", { name: "查看详情", exact: true })
      .click();
    await page.getByRole("button", { name: "申请改期", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const next = new Date(Date.now() + 228 * 86400000)
      .toISOString()
      .slice(0, 10);
    await dialog.getByLabel("新开始日期", { exact: true }).fill(next);
    await dialog.getByLabel("新结束日期", { exact: true }).fill(next);
    await dialog
      .getByLabel("搭建方联系人", { exact: true })
      .fill("改期草稿搭建人");
    expect(
      (
        await manager.request.post(`/api/bookings/${id}/cancel`, {
          headers: await headers(manager, 2),
          data: { reason: "管理员已确认活动取消" },
        })
      ).status(),
    ).toBe(200);
    let failRead = true,
      reads = 0,
      writes = 0;
    let retryReceived;
    const retryHit = new Promise((resolve) => {
      retryReceived = resolve;
    });
    await page.route(`**/api/bookings/${id}`, async (route) => {
      reads++;
      if (failRead)
        return route.fulfill({
          status: 503,
          json: { error: "模拟改期状态核对失败" },
        });
      const response = await route.fetch();
      retryReceived();
      await held;
      await route.fulfill({ response });
    });
    await page.route(`**/api/bookings/${id}/reschedule`, async (route) => {
      writes++;
      await route.continue();
    });
    const submit = dialog.getByRole("button", {
      name: "提交改期申请",
      exact: true,
    });
    await submit.click();
    await expect(dialog.getByRole("alert")).toContainText(
      "重新读取当前状态失败",
    );
    await expect(submit).toBeDisabled();
    await expect(dialog.getByLabel("新开始日期", { exact: true })).toHaveValue(
      next,
    );
    await expect(
      dialog.getByLabel("搭建方联系人", { exact: true }),
    ).toHaveValue("改期草稿搭建人");
    failRead = false;
    await dialog
      .getByRole("button", { name: "重新读取申请状态", exact: true })
      .click();
    await retryHit;
    await expect(submit).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "返回详情", exact: true }),
    ).toBeEnabled();
    releaseRead();
    await expect(dialog).toContainText("原申请当前状态：已取消");
    await expect(dialog.getByLabel("新开始日期", { exact: true })).toHaveValue(
      next,
    );
    await expect(
      dialog.getByLabel("搭建方联系人", { exact: true }),
    ).toHaveValue("改期草稿搭建人");
    await expect(submit).toBeDisabled();
    await submit.evaluate((button) => button.click());
    expect(writes).toBe(1);
    expect(reads).toBe(2);
    await dialog
      .getByRole("button", { name: "返回最新详情", exact: true })
      .click();
    await expect(dialog).toContainText("已取消");
    await expect(
      dialog.getByRole("button", { name: "申请改期", exact: true }),
    ).toHaveCount(0);
    const saved = (await (await page.request.get(`/api/bookings/${id}`)).json())
      .booking;
    const rows = (
      await (
        await page.request.get(
          `/api/bookings?q=${encodeURIComponent(saved.company)}`,
        )
      ).json()
    ).items;
    expect(rows.filter((row) => row.reschedule_of === id)).toHaveLength(0);
    expect(saved).toMatchObject({ status: "已取消", version: 3 });
  } finally {
    releaseRead();
    await context.close();
  }
});

test("409后的纯读核对仍可关闭详情，迟到响应不重开弹窗或触发保存回调", async ({
  page,
  browser,
  extraHTTPHeaders,
}) => {
  const id = await createBooking(page);
  const context = await browser.newContext({ extraHTTPHeaders });
  let releaseRead, received;
  const held = new Promise((resolve) => {
    releaseRead = resolve;
  });
  const hit = new Promise((resolve) => {
    received = resolve;
  });
  try {
    const manager = await context.newPage();
    const dialog = await managerDetail(manager, id);
    expect(
      (
        await page.request.post(`/api/bookings/${id}/withdraw`, {
          headers: await headers(page, 1),
        })
      ).status(),
    ).toBe(200);
    await manager.route(`**/api/bookings/${id}`, async (route) => {
      const response = await route.fetch();
      received();
      await held;
      await route.fulfill({ response });
    });
    await dialog.getByRole("button", { name: "审核通过", exact: true }).click();
    await hit;
    await expect(dialog).toContainText("正在重新读取申请状态");
    const response = manager.waitForResponse(
      (item) => new URL(item.url()).pathname === `/api/bookings/${id}`,
    );
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    releaseRead();
    await (await response).finished();
    await manager.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await expect(manager.getByRole("dialog")).toHaveCount(0);
    await expect(
      manager.locator(".toast").filter({ hasText: "申请已通过" }),
    ).toHaveCount(0);
    expect(
      (await (await page.request.get(`/api/bookings/${id}`)).json()).booking
        .status,
    ).toBe("已撤回");
  } finally {
    releaseRead();
    await context.close();
  }
});
