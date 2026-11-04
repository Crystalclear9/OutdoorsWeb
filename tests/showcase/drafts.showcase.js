import { test, expect } from "@playwright/test";
const key = "outdoors-temporary-showcase-v1";
const image = {
  name: "draft.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=",
    "base64",
  ),
};
async function navigate(page, name) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
}
async function openForm(page) {
  await page.goto("?showcase=1");
  await page.getByRole("button", { name: "发起布展申请", exact: true }).click();
  return page.getByRole("dialog");
}
async function stored(page) {
  return page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), key);
}
async function blockStorage(page, block) {
  await page.evaluate((block) => {
    if (block) {
      window.__draftOriginalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === "outdoors-temporary-showcase-v1")
          throw new DOMException("quota", "QuotaExceededError");
        return window.__draftOriginalSetItem.call(this, name, value);
      };
    } else {
      Storage.prototype.setItem = window.__draftOriginalSetItem;
      delete window.__draftOriginalSetItem;
    }
  }, block);
}

test("演示上传图片与部分字段保存后刷新可继续，且不请求真实API", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.includes("/api/")) requests.push(r.url());
  });
  let dialog = await openForm(page);
  await dialog.getByLabel("企业名称", { exact: true }).fill("演示持久草稿");
  await dialog.getByLabel("上传桁架设计图").setInputFiles(image);
  await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("草稿已保存");
  await page.reload();
  await navigate(page, "申请草稿");
  await page.getByRole("button", { name: "继续填写", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("企业名称", { exact: true })).toHaveValue(
    "演示持久草稿",
  );
  await expect(dialog.getByAltText("待提交桁架设计图")).toBeVisible();
  expect((await stored(page)).drafts[0].image).toMatch(
    /^data:image\/png;base64,/,
  );
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "演示持久草稿",
  );
  expect(requests).toEqual([]);
});

test("演示退回复制保留原单与原图，并建立新审核关联", async ({ page }) => {
  await page.goto("?showcase=1");
  await expect(page.locator(".account-link")).toContainText("企业联系人");
  const original = (await stored(page)).bookings.find(
    (r) => r.id === "SHOWCASE-05",
  );
  await navigate(page, "我的申请");
  await page
    .getByRole("row")
    .filter({ hasText: "SHOWCASE-05" })
    .getByRole("button", { name: "查看详情", exact: true })
    .click();
  await page.getByRole("button", { name: "复制并修改", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("复制自原申请 SHOWCASE-05");
  await expect(dialog.getByAltText("待提交桁架设计图")).toBeVisible();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "提交申请", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const state = await stored(page),
    copy = state.bookings.find((r) => r.source_booking_id === "SHOWCASE-05");
  expect(copy.status).toBe("待审核");
  expect(copy.designImage).toMatch(/^data:image\/png;base64,/);
  expect(state.bookings.find((r) => r.id === "SHOWCASE-05")).toEqual(original);
});

test("演示存储配额失败时草稿保存、更新和提交均明确失败，不污染内存或已有存档", async ({
  page,
}) => {
  let dialog = await openForm(page);
  await dialog.getByLabel("企业名称", { exact: true }).fill("配额回滚草稿");
  await dialog.getByLabel("上传桁架设计图").setInputFiles(image);
  await blockStorage(page, true);
  await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(dialog).toContainText("草稿操作未保存");
  await expect(
    dialog.getByText("草稿已保存到您的账号", { exact: false }),
  ).toHaveCount(0);
  expect((await stored(page)).drafts).toHaveLength(0);
  await blockStorage(page, false);
  await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("草稿已保存");
  const saved = await stored(page);
  await dialog.getByLabel("联系人", { exact: true }).fill("不应持久化的修改");
  await blockStorage(page, true);
  await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(dialog).toContainText("草稿操作未保存");
  expect((await stored(page)).drafts).toEqual(saved.drafts);
  await dialog.getByLabel("搭建方联系人", { exact: true }).fill("搭建工人");
  await dialog
    .getByLabel("搭建方联系电话", { exact: true })
    .fill("13900139000");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "提交申请", exact: true }).click();
  await expect(dialog).toContainText("申请未提交，原草稿已保留");
  expect((await stored(page)).bookings).toEqual(saved.bookings);
  await blockStorage(page, false);
  page.once("dialog", (dialog) => dialog.accept());
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await navigate(page, "申请草稿");
  await page.getByRole("button", { name: "继续填写", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("联系人", { exact: true })).toHaveValue(
    saved.drafts[0].payload.contact,
  );
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await blockStorage(page, true);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除草稿", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("草稿操作未保存");
  await blockStorage(page, false);
  await page.getByRole("button", { name: "刷新草稿", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "继续填写", exact: true }),
  ).toBeVisible();
  expect((await stored(page)).drafts).toEqual(saved.drafts);
});
