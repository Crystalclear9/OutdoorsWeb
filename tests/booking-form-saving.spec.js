import { randomUUID } from "node:crypto";
import { test, expect } from "./browser-fixtures.js";

test("初次申请保存期间锁定提交字段，失败保留输入且重试实际保存同一份信息", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.locator("[name=email]").fill("completion@test.local");
  await page.locator("[name=password]").fill("CompletionAccount123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.locator(".account-link")).toBeVisible();
  await page.getByRole("button", { name: "发起布展申请", exact: true }).click();
  const dialog = page.getByRole("dialog"),
    company = `申请字段保存互斥-${randomUUID()}`,
    date = new Date(Date.now() + 431 * 86400000).toISOString().slice(0, 10),
    fields = ["企业名称", "联系人", "联系电话", "开始日期", "结束日期"].map(
      (label) => dialog.getByLabel(label, { exact: true }),
    );
  fields.push(dialog.locator('[name="slot"]'));
  await fields[0].fill(company);
  await fields[1].fill("张老师");
  await fields[2].fill("13800138000");
  await fields[3].fill(date);
  await fields[4].fill(date);
  await fields[5].selectOption("29");
  await dialog.getByLabel("上传桁架设计图").setInputFiles({
    name: "booking-saving.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  const confirmation = dialog.getByRole("checkbox");
  await confirmation.check();
  let release, received;
  const held = new Promise((resolve) => {
      release = resolve;
    }),
    hit = new Promise((resolve) => {
      received = resolve;
    });
  await page.route("**/api/bookings", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    received();
    await held;
    await route.fulfill({
      status: 503,
      json: { error: "模拟申请提交失败，输入应保留" },
    });
  });
  try {
    await dialog.getByRole("button", { name: "提交申请", exact: true }).click();
    await hit;
    for (const field of fields) await expect(field).toBeDisabled();
    await expect(confirmation).toBeDisabled();
    await expect(dialog.getByLabel("上传桁架设计图")).toBeDisabled();
    release();
    await expect(dialog.getByRole("alert")).toContainText("模拟申请提交失败");
    for (const field of fields) await expect(field).toBeEnabled();
    await expect(confirmation).toBeEnabled();
    await expect(fields[0]).toHaveValue(company);
    await expect(fields[3]).toHaveValue(date);
    await expect(fields[5]).toHaveValue("29");
    await expect(confirmation).toBeChecked();
    await page.unroute("**/api/bookings");
    const saved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/bookings" &&
        response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "提交申请", exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    const { id } = await response.json();
    await expect(dialog).toHaveCount(0);
    const { booking } = await (
      await page.request.get(`/api/bookings/${id}`)
    ).json();
    expect(booking).toMatchObject({
      company,
      contact: "张老师",
      phone: "13800138000",
      start: date,
      end: date,
      slot: 29,
      status: "待审核",
    });
  } finally {
    release();
  }
});
