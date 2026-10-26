import { randomUUID } from "node:crypto";
import { test, expect } from "./browser-fixtures.js";

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

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("详情审批须成功显示设计图，读取失败可原位重试，加载和审批等待期间不能重复通过", async ({
  page,
  browser,
  extraHTTPHeaders,
}) => {
  await login(page);
  const session = await (await page.request.get("/api/auth/session")).json();
  const date = new Date(Date.now() + 125 * 86400000).toISOString().slice(0, 10);
  const company = `设计图恢复-${randomUUID()}`;
  const made = await page.request.post("/api/bookings", {
    headers: { Origin: "http://127.0.0.1:3101", "X-CSRF-Token": session.csrf },
    data: {
      company,
      contact: "李老师",
      phone: "13800138000",
      builder_contact: "搭建陈师傅",
      builder_phone: "027-87540000-1234",
      start: date,
      end: date,
      image:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=",
    },
  });
  expect(made.status()).toBe(201);
  const { id } = await made.json();
  const context = await browser.newContext({ extraHTTPHeaders });
  const firstRead = deferred(),
    firstHit = deferred(),
    retryRead = deferred(),
    retryHit = deferred(),
    reviewResponse = deferred(),
    reviewHit = deferred();
  let reads = 0,
    writes = 0;
  try {
    const manager = await context.newPage();
    await login(manager, true);
    await manager
      .getByRole("navigation")
      .getByRole("button", { name: "企业申报审核", exact: true })
      .click();
    await manager
      .getByRole("button", { name: "全部申请与历史", exact: true })
      .click();
    await manager.getByLabel("搜索申请", { exact: true }).fill(id);
    const row = manager.getByRole("row").filter({ hasText: id });
    await expect(row).toBeVisible();
    await manager.route(`**/api/bookings/${id}/image`, async (route) => {
      reads++;
      if (reads === 1) {
        firstHit.resolve();
        await firstRead.promise;
        await route.fulfill({
          status: 503,
          json: { error: "图片读取暂时失败" },
        });
      } else {
        const response = await route.fetch();
        retryHit.resolve();
        await retryRead.promise;
        await route.fulfill({ response });
      }
    });
    await manager.route(`**/api/bookings/${id}/review`, async (route) => {
      writes++;
      const response = await route.fetch();
      reviewHit.resolve();
      await reviewResponse.promise;
      await route.fulfill({ response });
    });
    await row.getByRole("button", { name: "审核申请", exact: true }).click();
    const dialog = manager.getByRole("dialog");
    const approve = dialog.getByRole("button", {
      name: "审核通过",
      exact: true,
    });
    await firstHit.promise;
    await expect(approve).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "未通过", exact: true }),
    ).toBeEnabled();
    expect(writes).toBe(0);
    firstRead.resolve();
    await expect(
      dialog.getByText("无法加载设计图", { exact: true }),
    ).toBeVisible();
    await expect(approve).toBeDisabled();
    await approve.evaluate((button) => button.click());
    expect(writes).toBe(0);
    const unchanged = (
      await (await page.request.get(`/api/bookings/${id}`)).json()
    ).booking;
    expect(unchanged).toMatchObject({ status: "待审核", version: 1 });
    await dialog
      .getByRole("button", { name: "重新加载设计图", exact: true })
      .click();
    await retryHit.promise;
    await expect(approve).toBeDisabled();
    retryRead.resolve();
    const image = dialog.getByRole("img", {
      name: "企业提交的桁架设计图",
      exact: true,
    });
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate(
          (element) => element.complete && element.naturalWidth > 0,
        ),
      )
      .toBe(true);
    await expect(approve).toBeEnabled();
    await approve.click();
    await reviewHit.promise;
    await expect(approve).toBeDisabled();
    await approve.evaluate((button) => button.click());
    await manager.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    expect(writes).toBe(1);
    reviewResponse.resolve();
    await expect(dialog).toHaveCount(0);
    const saved = (await (await page.request.get(`/api/bookings/${id}`)).json())
      .booking;
    expect(saved).toMatchObject({ status: "已通过", version: 2 });
    expect(reads).toBe(2);
    expect(writes).toBe(1);
  } finally {
    firstRead.resolve();
    retryRead.resolve();
    reviewResponse.resolve();
    await context.close();
  }
});

test("审批队列将200损坏图片视为未读材料，保留意见并在重试显示成功后才可通过", async ({
  page,
  browser,
  extraHTTPHeaders,
}) => {
  await login(page);
  const session = await (await page.request.get("/api/auth/session")).json();
  const date = new Date(Date.now() + 126 * 86400000).toISOString().slice(0, 10);
  const company = `图片解码恢复-${randomUUID()}`;
  const made = await page.request.post("/api/bookings", {
    headers: { Origin: "http://127.0.0.1:3101", "X-CSRF-Token": session.csrf },
    data: {
      company,
      contact: "李老师",
      phone: "13800138000",
      builder_contact: "搭建陈师傅",
      builder_phone: "027-87540000-1234",
      start: date,
      end: date,
      image:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=",
    },
  });
  expect(made.status()).toBe(201);
  const { id } = await made.json();
  const context = await browser.newContext({ extraHTTPHeaders });
  const retryRead = deferred(),
    retryHit = deferred(),
    reviewResponse = deferred(),
    reviewHit = deferred();
  let reads = 0,
    writes = 0;
  try {
    const manager = await context.newPage();
    await login(manager, true);
    await manager.route(`**/api/bookings/${id}/image`, async (route) => {
      reads++;
      if (reads === 1) {
        await route.fulfill({
          status: 200,
          contentType: "image/png",
          body: Buffer.from("invalid PNG payload"),
        });
      } else {
        const response = await route.fetch();
        retryHit.resolve();
        await retryRead.promise;
        await route.fulfill({ response });
      }
    });
    await manager.route(`**/api/bookings/${id}/review`, async (route) => {
      writes++;
      const response = await route.fetch();
      reviewHit.resolve();
      await reviewResponse.promise;
      await route.fulfill({ response });
    });
    await manager
      .getByRole("navigation")
      .getByRole("button", { name: "企业申报审核", exact: true })
      .click();
    await manager.getByLabel("搜索待办申请", { exact: true }).fill(company);
    const detail = manager.getByRole("region", { name: "申请审阅区" });
    await expect(
      detail.getByRole("heading", { name: company, exact: true }),
    ).toBeVisible();
    await expect(
      detail.getByText("设计图无法显示，请重新加载后再核对内容", {
        exact: true,
      }),
    ).toBeVisible();
    const approve = detail.getByRole("button", {
      name: "通过并审阅下一条",
      exact: true,
    });
    await expect(approve).toBeDisabled();
    await expect(
      detail.getByRole("button", { name: "退回并审阅下一条", exact: true }),
    ).toBeEnabled();
    await approve.evaluate((button) => button.click());
    expect(writes).toBe(0);
    await detail
      .getByLabel("审批意见", { exact: true })
      .fill("已核对宣传内容与搭建方资料");
    await detail
      .getByRole("button", { name: "重新加载设计图", exact: true })
      .click();
    await retryHit.promise;
    await expect(approve).toBeDisabled();
    await expect(detail.getByLabel("审批意见", { exact: true })).toHaveValue(
      "已核对宣传内容与搭建方资料",
    );
    retryRead.resolve();
    const image = detail.getByRole("img", {
      name: `${company}的桁架设计图`,
      exact: true,
    });
    await expect
      .poll(() =>
        image.evaluate(
          (element) => element.complete && element.naturalWidth > 0,
        ),
      )
      .toBe(true);
    await expect(approve).toBeEnabled();
    await approve.click();
    await reviewHit.promise;
    await expect(approve).toBeDisabled();
    await approve.evaluate((button) => button.click());
    expect(writes).toBe(1);
    reviewResponse.resolve();
    await expect(
      manager.getByRole("heading", { name: "暂无待办申请", exact: true }),
    ).toBeVisible();
    const saved = (await (await page.request.get(`/api/bookings/${id}`)).json())
      .booking;
    expect(saved).toMatchObject({
      status: "已通过",
      version: 2,
      reason: "已核对宣传内容与搭建方资料",
    });
    expect(reads).toBe(2);
    expect(writes).toBe(1);
  } finally {
    retryRead.resolve();
    reviewResponse.resolve();
    await context.close();
  }
});
