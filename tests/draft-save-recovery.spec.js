import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { test, expect } from "./browser-fixtures.js";

const image = async (color = "#ff0000") => ({
  name: color === "#ff0000" ? "red.png" : "blue.png",
  mimeType: "image/png",
  buffer: await sharp({
    create: { width: 2, height: 2, channels: 3, background: color },
  })
    .png()
    .toBuffer(),
});
async function form(page) {
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  const challenge = await (await page.request.get("/api/auth/captcha")).json();
  const r = await page.request.post("/api/auth/register", {
    headers: { Origin: origin },
    data: {
      email: `draft-recovery-${randomUUID()}@test.local`,
      password: "DraftRecovery123!",
      company: "草稿恢复企业",
      contact: "原联系人",
      phone: "13800138000",
      captchaId: challenge.id,
      captcha: "246789",
    },
  });
  expect(r.status()).toBe(201);
  await page.reload();
  await page.getByRole("button", { name: "发起布展申请", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("搭建方联系人", { exact: true }).fill("搭建联系人");
  await dialog
    .getByLabel("搭建方联系电话", { exact: true })
    .fill("13900139000");
  await dialog.getByLabel("上传桁架设计图").setInputFiles(await image());
  await expect(dialog.getByText("red.png", { exact: true })).toBeVisible();
  return dialog;
}
async function save(page) {
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.startsWith("/api/drafts") &&
      ["POST", "PATCH"].includes(r.request().method()),
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存草稿", exact: true })
    .click();
  const r = await response;
  expect(r.ok()).toBe(true);
  return (await r.json()).draft;
}
async function loseSave(page, method) {
  let resolve;
  const committed = new Promise((done) => {
    resolve = done;
  });
  const route = async (route) => {
    if (route.request().method() !== method) return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const result = await response.json();
    resolve(result.draft);
    await route.abort("failed");
  };
  await page.route("**/api/drafts**", route);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存草稿", exact: true })
    .click();
  const draft = await committed;
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "无法连接",
  );
  await page.unroute("**/api/drafts**", route);
  return draft;
}
const check = (page) =>
  page.getByRole("region", { name: "草稿保存结果核对", exact: true });
async function inspect(page) {
  await check(page)
    .getByRole("button", { name: "重新读取草稿状态", exact: true })
    .click();
}
async function headers(page) {
  const { csrf } = await (await page.request.get("/api/auth/session")).json();
  return { Origin: new URL(page.url()).origin, "X-CSRF-Token": csrf };
}
async function pixels(data) {
  return [
    ...(await sharp(Buffer.from(data.split(",")[1], "base64"))
      .removeAlpha()
      .raw()
      .toBuffer()),
  ];
}

test("首次保存已落库但响应丢失，纯读核对后保留继续修改并更新同一草稿", async ({
  page,
}) => {
  const dialog = await form(page);
  const draft = await loseSave(page, "POST");
  await expect(check(page)).toBeVisible();
  await dialog.getByLabel("联系人", { exact: true }).fill("响应未知后继续修改");
  await expect(
    dialog.getByRole("button", { name: "保存草稿", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "提交申请", exact: true }),
  ).toBeDisabled();
  await inspect(page);
  await expect(check(page)).toContainText("服务器版本：1");
  await expect(dialog.getByLabel("联系人", { exact: true })).toHaveValue(
    "响应未知后继续修改",
  );
  await check(page)
    .getByRole("button", {
      name: "保留当前文字，采用已保存设计图",
      exact: true,
    })
    .click();
  const saved = await save(page);
  expect(saved.id).toBe(draft.id);
  expect(saved.version).toBe(2);
  expect(saved.payload.contact).toBe("响应未知后继续修改");
  expect(
    (await (await page.request.get("/api/drafts")).json()).items,
  ).toHaveLength(1);
});

test("PATCH已落库但响应丢失，核对失败持续暂停写入，恢复后保留文字日期和新上传图", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await form(page);
  await dialog
    .getByLabel("企业名称", { exact: true })
    .fill("RECOVERY-ENTERPRISE-" + "X".repeat(55));
  await save(page);
  await dialog.getByLabel("联系人", { exact: true }).fill("第一次修改");
  const committed = await loseSave(page, "PATCH");
  await expect(check(page)).toBeVisible();
  await dialog.getByLabel("联系人", { exact: true }).fill("丢响应后继续补充");
  const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  await dialog.getByLabel("开始日期", { exact: true }).fill(date);
  await dialog.getByLabel("结束日期", { exact: true }).fill(date);
  await dialog
    .getByLabel("上传桁架设计图")
    .setInputFiles(await image("#0000ff"));
  const fail = (route) =>
    route.fulfill({ status: 503, json: { error: "模拟草稿核对暂不可用" } });
  await page.route(`**/api/drafts/${committed.id}`, fail);
  await inspect(page);
  await expect(dialog).toContainText("模拟草稿核对暂不可用");
  await expect(
    dialog.getByRole("button", { name: "保存草稿", exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByText("blue.png", { exact: true })).toBeVisible();
  await page.unroute(`**/api/drafts/${committed.id}`, fail);
  await inspect(page);
  await expect(check(page)).toContainText("服务器版本：2");
  await expect(check(page).getByAltText("服务器已保存的设计图")).toBeVisible();
  await expect(
    check(page).getByRole("button", {
      name: "保留当前文字，采用已保存设计图",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    check(page).getByRole("button", {
      name: "保留当前文字和新上传设计图",
      exact: true,
    }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await check(page)
    .getByRole("button", { name: "保留当前文字和新上传设计图", exact: true })
    .click();
  const latest = await save(page);
  expect(latest.id).toBe(committed.id);
  expect(latest.version).toBe(3);
  expect(latest.payload).toMatchObject({
    contact: "丢响应后继续补充",
    start: date,
    end: date,
  });
  const pixels = await sharp(Buffer.from(latest.image.split(",")[1], "base64"))
    .removeAlpha()
    .raw()
    .toBuffer();
  expect([...pixels]).toEqual([0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255]);
});

test("真实并发版本冲突必须展示服务端不同图片，显式采用后才绑定新版并保留当前文字", async ({
  page,
}) => {
  const dialog = await form(page),
    original = await save(page);
  await dialog.getByLabel("联系人", { exact: true }).fill("当前表单待保留文字");
  const another = await page.request.patch(`/api/drafts/${original.id}`, {
    headers: { ...(await headers(page)), "If-Match": '"1"' },
    data: {
      payload: { ...original.payload, contact: "另一页面已保存文字" },
      image: `data:image/png;base64,${(await image("#0000ff")).buffer.toString("base64")}`,
    },
  });
  expect(another.status()).toBe(200);
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === `/api/drafts/${original.id}` &&
      r.request().method() === "PATCH",
  );
  await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  expect((await response).status()).toBe(409);
  await expect(check(page)).toBeVisible();
  expect(
    await pixels(
      await dialog.getByAltText("待提交桁架设计图").getAttribute("src"),
    ),
  ).toEqual([255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0]);
  await inspect(page);
  await expect(check(page)).toContainText("服务器版本：2");
  await expect(check(page)).toContainText("另一页面已保存文字");
  expect(
    await pixels(
      await check(page)
        .getByAltText("服务器已保存的设计图")
        .getAttribute("src"),
    ),
  ).toEqual([0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255]);
  // Reading a newer version must not silently pair its image with the old preview.
  expect(
    await pixels(
      await dialog.getByAltText("待提交桁架设计图").getAttribute("src"),
    ),
  ).toEqual([255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0]);
  await expect(
    dialog.getByRole("button", { name: "提交申请", exact: true }),
  ).toBeDisabled();
  await check(page)
    .getByRole("button", {
      name: "保留当前文字，采用已保存设计图",
      exact: true,
    })
    .click();
  const result = await save(page);
  expect(result.version).toBe(3);
  expect(result.payload.contact).toBe("当前表单待保留文字");
  expect(await pixels(result.image)).toEqual([
    0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255,
  ]);
});

test("首次创建未落库的404明确保留输入并另存新身份，不重复使用未知旧ID", async ({
  page,
}) => {
  const dialog = await form(page);
  let attemptedId;
  const fail = (route) => {
    attemptedId = route.request().postDataJSON().id;
    return route.fulfill({ status: 503, json: { error: "模拟创建前失败" } });
  };
  await page.route("**/api/drafts", fail);
  await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(dialog).toContainText("模拟创建前失败");
  await page.unroute("**/api/drafts", fail);
  await inspect(page);
  await expect(check(page)).toContainText("服务器尚未找到首次创建的草稿");
  await dialog
    .getByLabel("联系人", { exact: true })
    .fill("首次失败仍保留的修改");
  await check(page)
    .getByRole("button", { name: "保留当前内容，另存新草稿", exact: true })
    .click();
  const saved = await save(page);
  expect(saved.id).not.toBe(attemptedId);
  expect(saved.payload.contact).toBe("首次失败仍保留的修改");
  expect((await page.request.get(`/api/drafts/${attemptedId}`)).status()).toBe(
    404,
  );
});

test("旧大图草稿已删除时不复活旧身份、不丢预览，显式重选原上传图后另存", async ({
  page,
}) => {
  test.setTimeout(90000);
  const dialog = await form(page);
  const jpeg = await sharp(randomBytes(1400 * 1400 * 3), {
    raw: { width: 1400, height: 1400, channels: 3 },
  })
    .jpeg({ quality: 82 })
    .toBuffer();
  await dialog
    .getByLabel("上传桁架设计图")
    .setInputFiles({ name: "large.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await expect(dialog.getByText("large.jpg", { exact: true })).toBeVisible();
  const old = await save(page);
  expect(Buffer.from(old.image.split(",")[1], "base64").length).toBeGreaterThan(
    3 * 1024 * 1024,
  );
  expect(
    (
      await page.request.delete(`/api/drafts/${old.id}`, {
        headers: { ...(await headers(page)), "If-Match": '"1"' },
      })
    ).status(),
  ).toBe(200);
  await dialog
    .getByLabel("联系人", { exact: true })
    .fill("删除后仍保留的本地文字");
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === `/api/drafts/${old.id}` &&
      r.request().method() === "PATCH",
  );
  await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  expect((await response).status()).toBe(404);
  await inspect(page);
  await expect(check(page)).toContainText("原来保存的草稿已删除或已提交");
  await expect(
    check(page).getByRole("button", {
      name: "保留当前内容，另存新草稿",
      exact: true,
    }),
  ).toBeDisabled();
  expect(
    (await dialog.getByAltText("待提交桁架设计图").getAttribute("src")) ===
      old.image,
  ).toBe(true);
  await dialog
    .getByLabel("上传桁架设计图")
    .setInputFiles(await image("#0000ff"));
  await expect(dialog.getByText("blue.png", { exact: true })).toBeVisible();
  await check(page)
    .getByRole("button", { name: "保留当前内容，另存新草稿", exact: true })
    .click();
  const saved = await save(page);
  expect(saved.id).not.toBe(old.id);
  expect(saved.payload.contact).toBe("删除后仍保留的本地文字");
  expect(await pixels(saved.image)).toEqual([
    0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255,
  ]);
  expect((await page.request.get(`/api/drafts/${old.id}`)).status()).toBe(404);
});

test("核对读取迟到时仍可关闭，旧响应不能回填新打开的申请表单", async ({
  page,
}) => {
  const dialog = await form(page),
    saved = await loseSave(page, "POST");
  let release, hit;
  const held = new Promise((resolve) => {
      release = resolve;
    }),
    received = new Promise((resolve) => {
      hit = resolve;
    });
  await page.route(`**/api/drafts/${saved.id}`, async (route) => {
    const response = await route.fetch();
    hit();
    await held;
    await route.fulfill({ response });
  });
  try {
    await inspect(page);
    await received;
    page.once("dialog", (dialog) => dialog.accept());
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page
      .getByRole("button", { name: "发起布展申请", exact: true })
      .click();
    release();
    await page.unrouteAll({ behavior: "wait" });
    const current = page.getByRole("dialog");
    await expect(current.getByLabel("联系人", { exact: true })).toHaveValue(
      "原联系人",
    );
    await expect(current.getByAltText("待提交桁架设计图")).toHaveCount(0);
    await expect(check(page)).toHaveCount(0);
  } finally {
    release();
  }
});

test("明确413草稿数量拒绝可直接修正重试，不强制进入结果核对", async ({
  page,
}) => {
  const dialog = await form(page),
    authHeaders = await headers(page);
  let first;
  for (let n = 0; n < 20; n++) {
    const r = await page.request.post("/api/drafts", {
      headers: authHeaders,
      data: { payload: { company: `已有草稿-${n}` } },
    });
    expect(r.status()).toBe(201);
    if (!n) first = (await r.json()).draft;
  }
  const rejected = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/drafts" &&
      r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  expect((await rejected).status()).toBe(413);
  await expect(dialog).toContainText("最多保存20份草稿");
  await expect(check(page)).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "保存草稿", exact: true }),
  ).toBeEnabled();
  expect(
    (
      await page.request.delete(`/api/drafts/${first.id}`, {
        headers: { ...authHeaders, "If-Match": '"1"' },
      })
    ).status(),
  ).toBe(200);
  await dialog.getByLabel("联系人", { exact: true }).fill("明确拒绝后直接修正");
  const saved = await save(page);
  expect(saved.payload.contact).toBe("明确拒绝后直接修正");
});
