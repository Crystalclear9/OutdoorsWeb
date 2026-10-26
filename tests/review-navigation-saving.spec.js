import { randomUUID } from "node:crypto";
import { test, expect } from "./browser-fixtures.js";

const origin = "http://127.0.0.1:3101";
const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=";

async function applications(browser, extraHTTPHeaders, count) {
  const context = await browser.newContext({
    baseURL: origin,
    extraHTTPHeaders,
  });
  try {
    const challenge = await (
      await context.request.get("/api/auth/captcha")
    ).json();
    const signup = await context.request.post("/api/auth/register", {
      headers: { Origin: origin },
      data: {
        email: `review-navigation-${randomUUID()}@test.local`,
        password: "ReviewNavigation123!",
        company: "审批导航验证企业",
        contact: "企业联系人",
        phone: "13800138000",
        captchaId: challenge.id,
        captcha: "246789",
      },
    });
    expect(signup.status()).toBe(201);
    const { csrf } = await signup.json();
    const prefix = `审批导航-${randomUUID()}`,
      date = new Date(Date.now() + 11 * 86400000).toISOString().slice(0, 10),
      rows = [];
    for (let index = 0; index < count; index++) {
      const company = `${prefix}-${index + 1}`;
      const response = await context.request.post("/api/bookings", {
        headers: { Origin: origin, "X-CSRF-Token": csrf },
        data: {
          company,
          contact: "企业联系人",
          phone: "13800138000",
          builder_contact: "搭建负责人",
          builder_phone: "027-87540000",
          start: date,
          end: date,
          image,
        },
      });
      expect(response.status()).toBe(201);
      rows.push({ company, id: (await response.json()).id });
    }
    return { context, prefix, rows };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function openReview(page, prefix) {
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册", exact: true }).click();
  await page.locator("[name=email]").fill("admin@test.local");
  await page.locator("[name=password]").fill("BrowserAdmin123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.locator(".account-link")).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "企业申报审核", exact: true })
    .click();
  await page.getByLabel("搜索待办申请").fill(prefix);
  await expect(page.locator(".review-queue-item").first()).toContainText(
    prefix,
  );
}

async function failHeld(page, url) {
  let release,
    received,
    writes = 0;
  const held = new Promise((resolve) => {
      release = resolve;
    }),
    hit = new Promise((resolve) => {
      received = resolve;
    });
  await page.route(url, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    received();
    await held;
    await route.fulfill({
      status: 503,
      json: { error: "模拟审批保存失败，请保留审核意见" },
    });
  });
  return { hit, release, writes: () => writes };
}

async function shellCannotLeave(page) {
  // Programmatic activation also reaches handlers beneath a batch dialog and
  // checks the shell's synchronous guard, independently of its overlay.
  for (const target of [
    page
      .getByRole("navigation", { includeHidden: true })
      .getByRole("button", {
        name: "通知公告",
        exact: true,
        includeHidden: true,
      }),
    page.locator(".brand-link"),
    page.locator(".account-link"),
    page.getByRole("button", {
      name: "退出登录",
      exact: true,
      includeHidden: true,
    }),
  ]) {
    await target.evaluate((node) => node.click());
    await expect(
      page.getByRole("heading", {
        name: "企业申报审核",
        exact: true,
        includeHidden: true,
      }),
    ).toBeVisible();
  }
}

async function unchanged(application) {
  for (const { id } of application.rows) {
    const response = await application.context.request.get(
      `/api/bookings/${id}`,
    );
    expect(response.status()).toBe(200);
    expect((await response.json()).booking).toMatchObject({
      status: "待审核",
      version: 1,
      reviewed: null,
    });
  }
}

test("单条审批保存中禁止离开或重复写，失败保留意见且解除导航锁", async ({
  page,
  browser,
  extraHTTPHeaders,
}) => {
  const application = await applications(browser, extraHTTPHeaders, 1);
  let held,
    logouts = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/auth/logout" &&
      request.method() === "POST"
    )
      logouts++;
  });
  try {
    await openReview(page, application.prefix);
    const detail = page.getByRole("region", { name: "申请审阅区" }),
      reason = "保存失败后仍然保留的单条审核意见";
    await detail.getByLabel("审批意见").fill(reason);
    held = await failHeld(
      page,
      `**/api/bookings/${application.rows[0].id}/review`,
    );
    const submit = detail.getByRole("button", {
      name: "退回并审阅下一条",
      exact: true,
    });
    await submit.click();
    await held.hit;
    await expect(detail.getByLabel("审批意见")).toBeDisabled();
    await expect(submit).toBeDisabled();
    await shellCannotLeave(page);
    await submit.evaluate((node) => node.click());
    expect(held.writes()).toBe(1);
    expect(logouts).toBe(0);
    held.release();
    await expect(detail.getByRole("alert")).toContainText("模拟审批保存失败");
    await expect(detail.getByLabel("审批意见")).toHaveValue(reason);
    await expect(submit).toBeEnabled();
    await unchanged(application);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "通知公告", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "通知公告", exact: true }),
    ).toBeVisible();
    expect(held.writes()).toBe(1);
  } finally {
    held?.release();
    await application.context.close();
  }
});

test("批量审批保存中禁止离开及重复提交，失败保留批量意见与确认", async ({
  page,
  browser,
  extraHTTPHeaders,
}) => {
  const application = await applications(browser, extraHTTPHeaders, 2);
  let held,
    logouts = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/auth/logout" &&
      request.method() === "POST"
    )
      logouts++;
  });
  try {
    await openReview(page, application.prefix);
    await expect(page.locator(".review-queue-item")).toHaveCount(2);
    await page
      .getByRole("checkbox", { name: "选择本页全部申请", exact: true })
      .check();
    await page.getByRole("button", { name: "批量退回", exact: true }).click();
    const dialog = page.getByRole("dialog"),
      reason = "保存失败后保留批量审批意见";
    await dialog.getByLabel("批量审核意见").fill(reason);
    await dialog.getByRole("checkbox").check();
    held = await failHeld(page, "**/api/bookings/review-batch");
    await dialog
      .getByRole("button", { name: "确认退回 2 条", exact: true })
      .click();
    await held.hit;
    await expect(dialog.getByLabel("批量审核意见")).toBeDisabled();
    await shellCannotLeave(page);
    await dialog.locator("form").evaluate((form) => form.requestSubmit());
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    expect(held.writes()).toBe(1);
    expect(logouts).toBe(0);
    held.release();
    await expect(dialog.getByRole("alert")).toContainText("模拟审批保存失败");
    await expect(dialog.getByLabel("批量审核意见")).toHaveValue(reason);
    await expect(dialog.getByRole("checkbox")).toBeChecked();
    await expect(
      dialog.getByRole("button", { name: "确认退回 2 条", exact: true }),
    ).toBeEnabled();
    await unchanged(application);
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "通知公告", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "通知公告", exact: true }),
    ).toBeVisible();
    expect(held.writes()).toBe(1);
  } finally {
    held?.release();
    await application.context.close();
  }
});
