import { test, expect } from "./browser-fixtures.js";

test("不完整申请显式保存草稿，刷新恢复设计图，提交失败保留内容，成功后删除草稿", async ({
  page,
}) => {
  const company = `持久草稿-${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.getByRole("button", { name: "企业注册", exact: true }).click();
  await page.locator("[name=email]").fill(`draft-${Date.now()}@company.local`);
  await page.locator("[name=company]").fill(company);
  await page.locator("[name=contact]").fill("草稿联系人");
  await page.locator("[name=phone]").fill("13800138000");
  await page.locator("[name=password]").fill("DraftPassword123!");
  await page.locator("[name=confirm]").fill("DraftPassword123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "创建账号" }).click();
  await page.getByRole("button", { name: "发起布展申请", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.locator("[name=contact]").fill("保存后的联系人");
  await dialog.getByLabel("上传桁架设计图").setInputFiles({
    name: "draft.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await dialog.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText(
    "草稿已保存到您的账号",
  );
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "申请草稿", exact: true })
    .click();
  await expect(
    page.locator("article").filter({ hasText: company }),
  ).toBeVisible();
  await page.getByRole("button", { name: "继续填写", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.locator("[name=contact]")).toHaveValue("保存后的联系人");
  await expect(dialog.getByAltText("待提交桁架设计图")).toBeVisible();
  await dialog.locator("[name=builder_contact]").fill("搭建方联系人");
  await dialog.locator("[name=builder_phone]").fill("13900139000");
  await dialog.getByRole("checkbox").check();
  await page.route("**/api/bookings", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 503, json: { error: "测试提交失败" } })
      : route.continue(),
  );
  await dialog.getByRole("button", { name: "提交申请", exact: true }).click();
  await expect(dialog).toContainText("测试提交失败");
  await expect(dialog.locator("[name=builder_contact]")).toHaveValue(
    "搭建方联系人",
  );
  await page.unroute("**/api/bookings");
  await dialog.getByRole("button", { name: "提交申请", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "申请草稿", exact: true })
    .click();
  await expect(
    page.getByText("暂无保存的草稿。填写申请时可点击“保存草稿”。"),
  ).toBeVisible();
});
