import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { test, expect } from "./browser-fixtures.js";

async function rejectedSource(page, browser, extraHTTPHeaders, image, type) {
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  const challenge = await (await page.request.get("/api/auth/captcha")).json();
  const registered = await page.request.post("/api/auth/register", {
    headers: { Origin: origin },
    data: {
      email: `trusted-image-${randomUUID()}@test.local`,
      password: "TrustedImage123!",
      company: "原图复用企业",
      contact: "原联系人",
      phone: "13800138000",
      captchaId: challenge.id,
      captcha: "246789",
    },
  });
  expect(registered.status()).toBe(201);
  const { csrf } = await registered.json();
  const date = new Date(Date.now() + 141 * 86400000).toISOString().slice(0, 10);
  const made = await page.request.post("/api/bookings", {
    headers: { Origin: origin, "X-CSRF-Token": csrf },
    data: {
      company: "原图复用企业",
      contact: "原联系人",
      phone: "13800138000",
      builder_contact: "搭建联系人",
      builder_phone: "13900139000",
      start: date,
      end: date,
      image: `data:${type};base64,${image.toString("base64")}`,
    },
  });
  expect(made.status()).toBe(201);
  const { id } = await made.json();
  const admin = await browser.newContext({ extraHTTPHeaders });
  try {
    const captcha = await (
      await admin.request.get(origin + "/api/auth/captcha")
    ).json();
    const login = await admin.request.post(origin + "/api/auth/login", {
      headers: { Origin: origin },
      data: {
        email: "admin@test.local",
        password: "BrowserAdmin123!",
        captchaId: captcha.id,
        captcha: "246789",
      },
    });
    expect(login.status()).toBe(200);
    const session = await login.json();
    expect(
      (
        await admin.request.post(origin + `/api/bookings/${id}/review`, {
          headers: {
            Origin: origin,
            "X-CSRF-Token": session.csrf,
            "If-Match": '"1"',
          },
          data: { status: "未通过", reason: "请调整联系资料后重新申报" },
        })
      ).status(),
    ).toBe(200);
  } finally {
    await admin.close();
  }
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的申请", exact: true })
    .click();
  await page
    .getByRole("row")
    .filter({ hasText: id })
    .getByRole("button", { name: "查看详情", exact: true })
    .click();
  await page.getByRole("button", { name: "复制并修改", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByAltText("待提交桁架设计图"),
  ).toBeVisible();
  return id;
}
async function save(page, method) {
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.startsWith("/api/drafts") &&
      r.request().method() === method,
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存草稿", exact: true })
    .click();
  const saved = await response;
  return {
    response: saved,
    input: saved.request().postDataJSON(),
    data: await saved.json(),
  };
}

test("合法JPEG归一化超过3MB后，退回复制、连续保存及重开草稿提交复用同一可信原图", async ({
  page,
  browser,
  extraHTTPHeaders,
}) => {
  test.setTimeout(90000);
  const jpeg = await sharp(randomBytes(1400 * 1400 * 3), {
    raw: { width: 1400, height: 1400, channels: 3 },
  })
    .jpeg({ quality: 82 })
    .toBuffer();
  expect(jpeg.length).toBeLessThan(3 * 1024 * 1024);
  const id = await rejectedSource(
    page,
    browser,
    extraHTTPHeaders,
    jpeg,
    "image/jpeg",
  );
  const stored = await (
    await page.request.get(`/api/bookings/${id}/image`)
  ).body();
  expect(stored.length).toBeGreaterThan(3 * 1024 * 1024);
  expect(stored.length).toBeLessThanOrEqual(6 * 1024 * 1024);
  const first = await save(page, "POST");
  expect(first.response.status()).toBe(201);
  expect(first.input.reuseImage).toBe("source");
  expect(first.input).not.toHaveProperty("image");
  expect(Buffer.from(first.data.draft.image.split(",")[1], "base64")).toEqual(
    stored,
  );
  const draftId = first.data.draft.id;
  await page
    .getByRole("dialog")
    .getByLabel("联系人", { exact: true })
    .fill("补正后的联系人");
  const second = await save(page, "PATCH");
  expect(second.response.status()).toBe(200);
  expect(second.input.reuseImage).toBe("draft");
  expect(second.input).not.toHaveProperty("image");
  expect(second.response.request().headers()["if-match"]).toBe('"1"');
  expect(second.data.draft.image).toBe(first.data.draft.image);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await page.getByRole("dialog").getByLabel("关闭", { exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "申请草稿", exact: true })
    .click();
  await page.getByRole("button", { name: "继续填写", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("联系人", { exact: true })).toHaveValue(
    "补正后的联系人",
  );
  await expect(dialog.getByAltText("待提交桁架设计图")).toBeVisible();
  await dialog.getByRole("checkbox").check();
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/bookings" &&
      r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "提交申请", exact: true }).click();
  const submitted = await response,
    body = submitted.request().postDataJSON();
  expect(submitted.status()).toBe(201);
  expect(body).toMatchObject({
    reuseImage: "draft",
    draftId,
    draftVersion: 2,
    source_booking_id: id,
  });
  expect(body).not.toHaveProperty("image");
  const result = await submitted.json();
  expect(
    await (await page.request.get(`/api/bookings/${result.id}/image`)).body(),
  ).toEqual(stored);
  expect((await page.request.get(`/api/drafts/${draftId}`)).status()).toBe(404);
  expect(
    (await (await page.request.get(`/api/bookings/${id}`)).json()).booking
      .status,
  ).toBe("未通过");
});

test("更换或拒绝新文件清除原图引用，保存失败不偷换图片或草稿版本，重试最终提交新像素", async ({
  page,
  browser,
  extraHTTPHeaders,
}) => {
  const image = async (color) =>
    sharp({ create: { width: 2, height: 2, channels: 3, background: color } })
      .png()
      .toBuffer();
  await rejectedSource(
    page,
    browser,
    extraHTTPHeaders,
    await image("#ff0000"),
    "image/png",
  );
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("上传桁架设计图").setInputFiles({
    name: "invalid.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("invalid design"),
  });
  await expect(dialog).toContainText("请选择 3 MB 以内");
  await expect(dialog.getByAltText("待提交桁架设计图")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "提交申请", exact: true }),
  ).toBeDisabled();
  const empty = await save(page, "POST");
  expect(empty.response.status()).toBe(201);
  expect(empty.input.image).toBeNull();
  expect(empty.input).not.toHaveProperty("reuseImage");
  await dialog.getByLabel("上传桁架设计图").setInputFiles({
    name: "updated.png",
    mimeType: "image/png",
    buffer: await image("#0000ff"),
  });
  await expect(dialog.getByText("updated.png", { exact: true })).toBeVisible();
  const failure = (route) =>
    route.fulfill({ status: 503, json: { error: "模拟新图保存失败" } });
  await page.route(`**/api/drafts/${empty.data.draft.id}`, failure);
  const failed = await save(page, "PATCH");
  expect(failed.response.status()).toBe(503);
  expect(failed.input.image).toMatch(/^data:image\/png;base64,/);
  expect(failed.input).not.toHaveProperty("reuseImage");
  await expect(dialog).toContainText("模拟新图保存失败");
  await page.unroute(`**/api/drafts/${empty.data.draft.id}`, failure);
  await dialog
    .getByRole("button", { name: "重新读取草稿状态", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "保留当前文字和新上传设计图", exact: true })
    .click();
  const retry = await save(page, "PATCH");
  expect(retry.response.status()).toBe(200);
  expect(retry.input).toEqual(failed.input);
  expect(retry.response.request().headers()["if-match"]).toBe('"1"');
  await dialog.getByRole("checkbox").check();
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/bookings" &&
      r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "提交申请", exact: true }).click();
  const submitted = await response;
  expect(submitted.status()).toBe(201);
  expect(submitted.request().postDataJSON().reuseImage).toBe("draft");
  const { id } = await submitted.json();
  const pixels = await sharp(
    await (await page.request.get(`/api/bookings/${id}/image`)).body(),
  )
    .removeAlpha()
    .raw()
    .toBuffer();
  expect([...pixels]).toEqual([0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255]);
});
