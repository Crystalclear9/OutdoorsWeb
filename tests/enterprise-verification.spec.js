import { test, expect } from "./browser-fixtures.js";

test("真实企业核验保存、内部依据隐私及资料变更待复核", async ({
  page,
  browser,
}) => {
  const email = `verify-${Date.now()}@company.local`;
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册", exact: true }).click();
  await page.getByRole("button", { name: "企业注册", exact: true }).click();
  for (const [name, value] of Object.entries({
    email,
    company: "企业核验界面测试",
    contact: "核验联系人",
    phone: "13800138000",
    password: "VerifyBrowser123!",
    confirm: "VerifyBrowser123!",
  }))
    await page.locator(`[name=${name}]`).fill(value);
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await page.locator(".account-link").click();
  const box = page.locator("section.card").filter({
    has: page.getByRole("heading", { name: "企业资料核验", exact: true }),
  });
  await expect(box).toContainText("待核验");
  const context = await browser.newContext(),
    admin = await context.newPage();
  try {
    await admin.goto("/");
    await admin
      .getByRole("button", { name: "登录 / 注册", exact: true })
      .click();
    await admin.locator("[name=email]").fill("admin@test.local");
    await admin.locator("[name=password]").fill("BrowserAdmin123!");
    await admin.getByLabel("图片验证码", { exact: true }).fill("246789");
    await admin.getByRole("button", { name: "登录账号", exact: true }).click();
    await admin
      .getByRole("navigation")
      .getByRole("button", { name: "账号管理", exact: true })
      .click();
    await admin.getByLabel("搜索账号", { exact: true }).fill(email);
    await admin
      .getByRole("row")
      .filter({ hasText: email })
      .getByRole("button", { name: "企业核验", exact: true })
      .click();
    const dialog = admin.getByRole("dialog"),
      evidence = "内部核验记录只允许账号管理员查看001";
    await dialog
      .getByLabel("核验结论", { exact: true })
      .selectOption("verified");
    await dialog.getByLabel("内部核验依据", { exact: true }).fill(evidence);
    await dialog
      .getByLabel("企业可见说明", { exact: true })
      .fill("活动中心已核实授权联系人");
    await dialog
      .getByRole("button", { name: "保存核验记录", exact: true })
      .click();
    await expect(
      dialog.getByText("已核验", { exact: true }).first(),
    ).toBeVisible();
    await box
      .getByRole("button", { name: "重新读取核验记录", exact: true })
      .click();
    await expect(box).toContainText("已核验");
    await expect(box).not.toContainText(evidence);
    const session = await (await page.request.get("/api/auth/session")).json();
    const result = await page.request.patch("/api/profile", {
      headers: {
        Origin: "http://127.0.0.1:3101",
        "X-CSRF-Token": session.csrf,
      },
      data: {
        company: "资料变更后的核验企业",
        contact: "更新联系人",
        phone: "13900139000",
      },
    });
    expect(result.status()).toBe(200);
    await box
      .getByRole("button", { name: "重新读取核验记录", exact: true })
      .click();
    await expect(box).toContainText("资料变更待复核");
    await dialog
      .getByRole("button", { name: "重新读取核验记录", exact: true })
      .click();
    await expect(dialog).toContainText("资料变更待复核");
    await dialog.getByText(/历史核验记录/).click();
    await expect(dialog).toContainText(evidence);
  } finally {
    await context.close();
  }
});
