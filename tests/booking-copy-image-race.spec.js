import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { test, expect } from "./browser-fixtures.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function trackCsp(page) {
  const errors = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /Content Security Policy|Refused to connect/i.test(message.text())
    )
      errors.push(message.text());
  });
  return errors;
}

test("连续退回复制关联当前修改的第二版申请，而不跳回第一版", async ({
  page,
  browser,
  extraHTTPHeaders,
}) => {
  const cspErrors = trackCsp(page);
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  const captcha = await (await page.request.get("/api/auth/captcha")).json();
  const registered = await page.request.post("/api/auth/register", {
    headers: { Origin: origin },
    data: {
      email: `copy-chain-${randomUUID()}@test.local`,
      password: "CopyChainPassword123!",
      company: "连续修改企业",
      contact: "联系人",
      phone: "13800138000",
      captchaId: captcha.id,
      captcha: "246789",
    },
  });
  expect(registered.status()).toBe(201);
  const { csrf } = await registered.json();
  const image = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#0000ff" },
  })
    .png()
    .toBuffer();
  const date = new Date(Date.now() + 205 * 86400000).toISOString().slice(0, 10);
  const payload = {
    company: "连续修改企业",
    contact: "联系人",
    phone: "13800138000",
    builder_contact: "搭建方",
    builder_phone: "13900139000",
    start: date,
    end: date,
    image: `data:image/png;base64,${image.toString("base64")}`,
  };
  const headers = { Origin: origin, "X-CSRF-Token": csrf };
  const admin = await browser.newContext({ extraHTTPHeaders });
  let firstId, secondId;
  try {
    const challenge = await (
      await admin.request.get(`${origin}/api/auth/captcha`)
    ).json();
    const logged = await admin.request.post(`${origin}/api/auth/login`, {
      headers: { Origin: origin },
      data: {
        email: "admin@test.local",
        password: "BrowserAdmin123!",
        captchaId: challenge.id,
        captcha: "246789",
      },
    });
    expect(logged.status()).toBe(200);
    const session = await logged.json();
    const reject = async (id) => {
      const r = await admin.request.post(
        `${origin}/api/bookings/${id}/review`,
        {
          headers: {
            Origin: origin,
            "X-CSRF-Token": session.csrf,
            "If-Match": '"1"',
          },
          data: { status: "未通过", reason: "请继续修正当前版本" },
        },
      );
      expect(r.status()).toBe(200);
    };
    const first = await page.request.post("/api/bookings", {
      headers,
      data: payload,
    });
    expect(first.status()).toBe(201);
    firstId = (await first.json()).id;
    await reject(firstId);
    const second = await page.request.post("/api/bookings", {
      headers,
      data: { ...payload, source_booking_id: firstId },
    });
    expect(second.status()).toBe(201);
    secondId = (await second.json()).id;
    await reject(secondId);
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
    .filter({ hasText: secondId })
    .getByRole("button", { name: "查看详情", exact: true })
    .click();
  await page.getByRole("button", { name: "复制并修改", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`复制自原申请 ${secondId}`);
  await expect(dialog.getByAltText("待提交桁架设计图")).toBeVisible();
  await dialog.getByRole("checkbox").check();
  const submitted = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/bookings" &&
      r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "提交申请", exact: true }).click();
  const result = await submitted;
  expect(result.status()).toBe(201);
  const { id } = await result.json();
  const latest = await (await page.request.get(`/api/bookings/${id}`)).json();
  expect(latest.booking.source_booking_id).toBe(secondId);
  const second = await (
    await page.request.get(`/api/bookings/${secondId}`)
  ).json();
  expect(second.booking.source_booking_id).toBe(firstId);
  expect(second.booking.status).toBe("未通过");
  expect(cspErrors).toEqual([]);
});

for (const holdNew of [false, true])
  test(`复制退回申请：迟到原图不${holdNew ? "结束新图加载" : "覆盖已选择新图"}，最终提交新像素`, async ({
    page,
    browser,
    extraHTTPHeaders,
  }) => {
    const cspErrors = trackCsp(page);
    const oldImage = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#ff0000" },
    })
      .png()
      .toBuffer();
    const newImage = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#0000ff" },
    })
      .png()
      .toBuffer();
    await page.addInitScript(() => {
      const NativeReader = window.FileReader;
      window.FileReader = class extends NativeReader {
        readAsDataURL(blob) {
          const onload = this.onload;
          this.onload = (event) => {
            if (blob.name === "updated.png" && window.__holdNewImage) {
              window.__newImageReadReady = true;
              window.__releaseNewImage = () => onload?.call(this, event);
            } else {
              onload?.call(this, event);
              if (!blob.name) window.__sourceReadFinished = true;
            }
          };
          super.readAsDataURL(blob);
        }
      };
    });
    await page.goto("/");
    const origin = new URL(page.url()).origin;
    const captcha = await (await page.request.get("/api/auth/captcha")).json();
    const registered = await page.request.post("/api/auth/register", {
      headers: { Origin: origin },
      data: {
        email: `copy-image-${randomUUID()}@test.local`,
        password: "CopyImagePassword123!",
        company: "设计图竞态企业",
        contact: "联系人",
        phone: "13800138000",
        captchaId: captcha.id,
        captcha: "246789",
      },
    });
    expect(registered.status()).toBe(201);
    const { csrf } = await registered.json();
    const date = new Date(Date.now() + 200 * 86400000)
      .toISOString()
      .slice(0, 10);
    const made = await page.request.post("/api/bookings", {
      headers: { Origin: origin, "X-CSRF-Token": csrf },
      data: {
        company: "设计图竞态企业",
        contact: "联系人",
        phone: "13800138000",
        builder_contact: "搭建方",
        builder_phone: "13900139000",
        start: date,
        end: date,
        image: `data:image/png;base64,${oldImage.toString("base64")}`,
      },
    });
    expect(made.status()).toBe(201);
    const { id } = await made.json();
    const admin = await browser.newContext({ extraHTTPHeaders });
    try {
      const challenge = await (
        await admin.request.get(`${origin}/api/auth/captcha`)
      ).json();
      const logged = await admin.request.post(`${origin}/api/auth/login`, {
        headers: { Origin: origin },
        data: {
          email: "admin@test.local",
          password: "BrowserAdmin123!",
          captchaId: challenge.id,
          captcha: "246789",
        },
      });
      expect(logged.status()).toBe(200);
      const session = await logged.json();
      const reviewed = await admin.request.post(
        `${origin}/api/bookings/${id}/review`,
        {
          headers: {
            Origin: origin,
            "X-CSRF-Token": session.csrf,
            "If-Match": '"1"',
          },
          data: { status: "未通过", reason: "请修改设计图" },
        },
      );
      expect(reviewed.status()).toBe(200);
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
    await expect(
      page.getByRole("dialog").getByAltText("企业提交的桁架设计图"),
    ).toBeVisible();
    const oldHit = deferred(),
      releaseOld = deferred();
    await page.route(`**/api/bookings/${id}/image`, async (route) => {
      const response = await route.fetch();
      oldHit.resolve();
      await releaseOld.promise;
      await route.fulfill({ response });
    });
    try {
      await page
        .getByRole("button", { name: "复制并修改", exact: true })
        .click();
      await oldHit.promise;
      await page.evaluate((hold) => {
        window.__holdNewImage = hold;
      }, holdNew);
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("上传桁架设计图").setInputFiles({
        name: "updated.png",
        mimeType: "image/png",
        buffer: newImage,
      });
      if (holdNew)
        await expect
          .poll(() => page.evaluate(() => window.__newImageReadReady))
          .toBe(true);
      else
        await expect(
          dialog.getByText("updated.png", { exact: true }),
        ).toBeVisible();
      releaseOld.resolve();
      await expect
        .poll(() => page.evaluate(() => window.__sourceReadFinished))
        .toBe(true);
      if (holdNew) {
        await expect(
          dialog.getByRole("button", { name: "保存草稿", exact: true }),
        ).toBeDisabled();
        await expect(
          dialog.getByRole("button", { name: "提交申请", exact: true }),
        ).toBeDisabled();
        await expect(
          dialog.getByText("正在读取设计图…", { exact: true }),
        ).toBeVisible();
        await page.evaluate(() => window.__releaseNewImage());
      }
      await expect(
        dialog.getByText("updated.png", { exact: true }),
      ).toBeVisible();
      await dialog.getByRole("checkbox").check();
      const submitted = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/bookings" &&
          response.request().method() === "POST",
      );
      await dialog
        .getByRole("button", { name: "提交申请", exact: true })
        .click();
      const response = await submitted;
      expect(response.status()).toBe(201);
      const copied = await response.json();
      const stored = await page.request.get(`/api/bookings/${copied.id}/image`);
      expect(stored.status()).toBe(200);
      const pixels = await sharp(await stored.body())
        .removeAlpha()
        .raw()
        .toBuffer();
      expect([...pixels]).toEqual([0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255]);
      const original = await (
        await page.request.get(`/api/bookings/${id}`)
      ).json();
      expect(original.booking.status).toBe("未通过");
      expect(cspErrors).toEqual([]);
    } finally {
      releaseOld.resolve();
    }
  });
