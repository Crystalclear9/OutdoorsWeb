import { test, expect } from "@playwright/test";

const upload = {
  name: "design.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  ),
};
async function role(page, name) {
  await page.getByRole("button", { name: "切换演示身份" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: new RegExp(name) })
    .click();
}
async function fillBooking(page, name) {
  await page.getByRole("button", { name: "发起布展申报" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("[name=company]").fill(name);
  await dialog.locator("[name=contact]").fill("张先生");
  await dialog.locator("[name=phone]").fill("13800138000");
  await dialog.getByLabel("上传桁架设计图").setInputFiles(upload);
  await dialog.getByRole("checkbox").check();
  return dialog;
}

test("企业提交、管理员通过、场地更新与刷新后保留", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const dialog = await fillBooking(page, "流程测试企业");
  await dialog.getByRole("button", { name: "提交申请" }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "流程测试企业" }),
  ).toContainText("待审核");
  await role(page, "管理员");
  await page.getByRole("button", { name: "企业申报审核" }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "流程测试企业" })
    .getByRole("button")
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "审核通过" })
    .click();
  await expect(
    page.getByRole("row").filter({ hasText: "流程测试企业" }),
  ).toContainText("已通过");
  await page.getByRole("button", { name: "场地情况管理" }).click();
  await expect(
    page.getByRole("button", { name: "A-03 已占用", exact: true }),
  ).toBeVisible();
  await role(page, "企业用户");
  await page.getByRole("button", { name: "我的申报记录" }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "流程测试企业" }),
  ).toContainText("已通过");
  await page.reload();
  await page.getByRole("button", { name: "我的申报记录" }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "流程测试企业" }),
  ).toContainText("已通过");
  expect(errors).toEqual([]);
});

test("申报时长与已占用桁架冲突校验", async ({ page }) => {
  await page.goto("/");
  const dialog = await fillBooking(page, "校验测试企业");
  const start = await dialog.locator("[name=start]").inputValue();
  const date = new Date(`${start}T12:00:00`);
  date.setDate(date.getDate() + 3);
  const end = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  await dialog.locator("[name=end]").fill(end);
  await dialog.getByRole("button", { name: "提交申请" }).click();
  await expect(dialog.getByRole("alert")).toContainText("不可超过 3 天");
  await dialog.locator("[name=end]").fill(start);
  await dialog.locator("[name=slot]").selectOption("1");
  await dialog.getByRole("button", { name: "提交申请" }).click();
  await expect(dialog.getByRole("alert")).toContainText("已被占用");
});

test("审核退回必须说明原因并同步给企业", async ({ page }) => {
  await page.goto("/");
  await role(page, "管理员");
  await page.getByRole("button", { name: "企业申报审核" }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "武汉云启科技有限公司" })
    .getByRole("button")
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "未通过", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("请填写未通过原因");
  await dialog.getByRole("textbox").fill("请补充桁架设计图");
  await dialog.getByRole("button", { name: "未通过", exact: true }).click();
  await role(page, "企业用户");
  await page.getByRole("button", { name: "我的申报记录" }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "武汉云启科技有限公司" })
    .getByRole("button")
    .click();
  await expect(page.getByRole("dialog")).toContainText("请补充桁架设计图");
});

test("公告发布、修改、删除及删除全部后的须知入口", async ({ page }) => {
  await page.goto("/");
  await role(page, "管理员");
  await page.getByRole("button", { name: "通知公告管理" }).click();
  await page.getByRole("button", { name: "发布公告" }).click();
  await page.locator("[name=title]").fill("新增测试公告");
  await page.locator("[name=content]").fill("测试公告正文");
  await page.getByRole("button", { name: "保存公告" }).click();
  const article = page.locator("article").filter({ hasText: "新增测试公告" });
  await article.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator("[name=title]").fill("修改后的公告");
  await page.getByRole("button", { name: "保存公告" }).click();
  await expect(
    page.locator("article").filter({ hasText: "修改后的公告" }),
  ).toBeVisible();
  while (await page.locator("article").count()) {
    await page
      .locator("article")
      .first()
      .getByRole("button", { name: "删除", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "删除公告" })
      .click();
  }
  await page.getByRole("button", { name: "工作台概览" }).click();
  await page.getByRole("button", { name: "查看详情", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("不可超过 3 天");
});

test("手机页面布局与游客访问", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "tmp/mobile.png", fullPage: true });
  await page.getByRole("button", { name: "打开导航" }).click();
  await role(page, "游客");
  await expect(
    page.getByRole("button", { name: "以企业身份预约" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "以企业身份预约" }).click();
  await expect(
    page.getByRole("dialog", { name: "选择演示身份" }),
  ).toBeVisible();
});
