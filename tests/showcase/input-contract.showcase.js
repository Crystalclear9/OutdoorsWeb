import { test, expect } from "@playwright/test";

const key = "outdoors-temporary-showcase-v1";
const design = {
  name: "input-contract.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=",
    "base64",
  ),
};

async function notices(page) {
  await page.goto("?showcase=1");
  await page
    .getByRole("group", { name: "切换演示身份", exact: true })
    .getByRole("button", { name: "管理员", exact: true })
    .click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "通知公告", exact: true })
    .click();
}
async function stored(page, collection) {
  return page.evaluate(
    ({ key, collection }) =>
      JSON.parse(sessionStorage.getItem(key))[collection],
    { key, collection },
  );
}

test("演示企业申报拒绝仅空格企业及联系人，修正后保存去除首尾空格的信息", async ({
  page,
}) => {
  await page.goto("?showcase=1");
  await page.getByRole("button", { name: "发起布展申请", exact: true }).click();
  const dialog = page.getByRole("dialog"),
    company = dialog.getByLabel("企业名称", { exact: true }),
    contact = dialog.getByLabel("联系人", { exact: true });
  await company.fill("   ");
  await contact.fill("有效联系人");
  await dialog.getByLabel("搭建方联系人", { exact: true }).fill("搭建负责人");
  await dialog
    .getByLabel("搭建方联系电话", { exact: true })
    .fill("027-87540000");
  await dialog.getByLabel("上传桁架设计图").setInputFiles(design);
  await dialog.getByRole("checkbox").check();
  const submit = dialog.getByRole("button", { name: "提交申请", exact: true }),
    before = (await stored(page, "bookings")).length;
  await submit.click();
  await expect(dialog.getByRole("alert")).toContainText(
    "请填写企业名称、联系人",
  );
  expect((await stored(page, "bookings")).length).toBe(before);
  await expect(company).toHaveValue("   ");
  await company.fill("  演示输入校验企业  ");
  await contact.fill("   ");
  await submit.click();
  await expect(dialog.getByRole("alert")).toContainText(
    "请填写企业名称、联系人",
  );
  expect((await stored(page, "bookings")).length).toBe(before);
  await contact.fill("  修正联系人  ");
  await submit.click();
  await expect(dialog).toHaveCount(0);
  expect(
    (await stored(page, "bookings")).find((row) =>
      row.company.includes("演示输入校验企业"),
    ),
  ).toMatchObject({ company: "演示输入校验企业", contact: "修正联系人" });
});

test("演示快捷公告拒绝仅空格标题或正文，修正后发布规范化内容", async ({
  page,
}) => {
  await notices(page);
  const form = page.getByRole("form", { name: "快捷公告投递", exact: true }),
    title = form.getByLabel("公告标题", { exact: true }),
    content = form.getByLabel("公告正文", { exact: true }),
    publish = form.getByRole("button", { name: "发布公告", exact: true }),
    before = (await stored(page, "notices")).length;
  await title.fill("   ");
  await content.fill("有效正文");
  await publish.click();
  await expect(form.getByRole("alert")).toContainText("请填写公告标题和正文");
  expect((await stored(page, "notices")).length).toBe(before);
  await title.fill("  演示输入校验公告  ");
  await content.fill("   ");
  await publish.click();
  await expect(form.getByRole("alert")).toContainText("请填写公告标题和正文");
  expect((await stored(page, "notices")).length).toBe(before);
  await content.fill("  发布后保留的正文  ");
  await publish.click();
  await expect(
    page.locator(".notice-article").filter({ hasText: "演示输入校验公告" }),
  ).toBeVisible();
  expect(
    (await stored(page, "notices")).find(
      (row) => row.title === "演示输入校验公告",
    ),
  ).toMatchObject({ title: "演示输入校验公告", content: "发布后保留的正文" });
});

test("演示公告编辑拒绝空白修改并保留旧公告，修正后才增加版本", async ({
  page,
}) => {
  await notices(page);
  const original = (await stored(page, "notices")).find(
    (row) => row.id === "notice-1",
  );
  await page
    .locator(".notice-article")
    .filter({ hasText: original.title })
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  const dialog = page.getByRole("dialog"),
    title = dialog.getByLabel("公告标题", { exact: true }),
    content = dialog.getByRole("textbox", { name: "正文内容", exact: true }),
    save = dialog.getByRole("button", { name: "保存公告", exact: true });
  await title.fill("   ");
  await content.fill("新的正文");
  await save.click();
  await expect(dialog.getByRole("alert")).toContainText("请填写公告标题和正文");
  expect(
    (await stored(page, "notices")).find((row) => row.id === original.id),
  ).toEqual(original);
  await title.fill("  编辑后公告标题  ");
  await content.fill("   ");
  await save.click();
  await expect(dialog.getByRole("alert")).toContainText("请填写公告标题和正文");
  expect(
    (await stored(page, "notices")).find((row) => row.id === original.id),
  ).toEqual(original);
  await content.fill("  编辑后公告正文  ");
  await save.click();
  await expect(dialog).toHaveCount(0);
  expect(
    (await stored(page, "notices")).find((row) => row.id === original.id),
  ).toMatchObject({
    title: "编辑后公告标题",
    content: "编辑后公告正文",
    version: original.version + 1,
  });
});
