import { test, expect } from "@playwright/test";

const key = "outdoors-temporary-showcase-v1";
const stored = (page) =>
  page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), key);

test("Pages原图引用可连续保存、刷新续办并提交，保持原图和补正关联且不调用真实API", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.includes("/api/"))
      requests.push(request.url());
  });
  await page.goto("?showcase=1");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的申请", exact: true })
    .click();
  await page
    .getByRole("row")
    .filter({ hasText: "SHOWCASE-05" })
    .getByRole("button", { name: "查看详情", exact: true })
    .click();
  await page.getByRole("button", { name: "复制并修改", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByAltText("待提交桁架设计图")).toBeVisible();
  await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("草稿已保存");
  const first = (await stored(page)).drafts[0];
  expect(first.image).toMatch(/^data:image\/png;base64,/);
  await dialog.getByLabel("联系人", { exact: true }).fill("再次补正的联系人");
  await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("草稿已保存");
  const second = (await stored(page)).drafts[0];
  expect(second.version).toBe(2);
  expect(second.image).toBe(first.image);
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "申请草稿", exact: true })
    .click();
  await page.getByRole("button", { name: "继续填写", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("联系人", { exact: true })).toHaveValue(
    "再次补正的联系人",
  );
  await expect(dialog.getByAltText("待提交桁架设计图")).toBeVisible();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "提交申请", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await stored(page),
    copy = saved.bookings.find((r) => r.source_booking_id === "SHOWCASE-05");
  expect(saved.drafts).toEqual([]);
  expect(copy.designImage).toBe(first.image);
  expect(copy.contact).toBe("再次补正的联系人");
  expect(copy.status).toBe("待审核");
  expect(saved.bookings.find((r) => r.id === "SHOWCASE-05").status).toBe(
    "未通过",
  );
  expect(requests).toEqual([]);
});
