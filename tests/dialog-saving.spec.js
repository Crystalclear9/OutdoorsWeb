import { test, expect } from "./browser-fixtures.js";

async function login(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.locator("[name=email]").fill("admin@test.local");
  await page.locator("[name=password]").fill("BrowserAdmin123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.locator(".account-link")).toBeVisible();
}
async function navigate(page, name) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
}
async function defer(page, pattern, failure = null) {
  let release, received;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const hit = new Promise((resolve) => {
    received = resolve;
  });
  await page.route(pattern, async (route) => {
    const response = failure
      ? { status: 409, json: { error: failure } }
      : { response: await route.fetch() };
    received();
    await held;
    await route.fulfill(response);
  });
  return { release, hit };
}
async function cannotDismiss(page, { cancel = true } = {}) {
  const dialog = page.getByRole("dialog");
  if (cancel)
    await expect(
      dialog.getByRole("button", { name: "取消", exact: true }),
    ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).toBeVisible();
  return dialog;
}

test("账号重置失败的迟到响应保留原确认框，处理中禁止关闭，失败后可取消", async ({
  page,
}) => {
  await login(page);
  await navigate(page, "账号管理");
  await page.getByLabel("搜索账号").fill("completion@test.local");
  const row = page
    .getByRole("row")
    .filter({ hasText: "completion@test.local" });
  await row.getByRole("button", { name: "重置密码" }).click();
  const deferred = await defer(
    page,
    "**/api/users/*/reset-password",
    "模拟重置失败，请重新核验",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认操作" })
    .click();
  await deferred.hit;
  const dialog = await cannotDismiss(page);
  await expect(dialog).toContainText("改期界面测试企业");
  deferred.release();
  await expect(dialog.getByRole("alert")).toContainText("模拟重置失败");
  await expect(
    dialog.getByRole("button", { name: "取消", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("管理员创建失败的迟到响应保留原表单，处理中禁止退出", async ({ page }) => {
  await login(page);
  await navigate(page, "授权管理");
  await page.getByRole("button", { name: "新增管理员" }).click();
  const dialog = page.getByRole("dialog");
  const email = `dialog-staff-${Date.now()}@test.local`;
  await dialog.getByLabel("管理员姓名").fill("模态保存测试");
  await dialog.getByLabel("登录邮箱").fill(email);
  await dialog
    .getByLabel("输入您当前的密码以确认授权")
    .fill("BrowserAdmin123!");
  const deferred = await defer(
    page,
    "**/api/access/staff",
    "模拟创建失败，原表单仍可修改",
  );
  await dialog.getByRole("button", { name: "创建并授权", exact: true }).click();
  await deferred.hit;
  await cannotDismiss(page);
  deferred.release();
  await expect(dialog.getByRole("alert")).toContainText("模拟创建失败");
  await expect(dialog.getByLabel("登录邮箱")).toHaveValue(email);
  await expect(
    dialog.getByRole("button", { name: "取消", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("公告真实保存与删除失败的迟到响应均锁定当前弹窗", async ({ page }) => {
  await login(page);
  const session = await (await page.request.get("/api/auth/session")).json();
  const title = `保存期间互斥公告-${Date.now()}`;
  const created = await page.request.post("/api/notices", {
    headers: { Origin: "http://127.0.0.1:3101", "X-CSRF-Token": session.csrf },
    data: { title, content: "原公告内容" },
  });
  expect(created.ok()).toBe(true);
  const { id } = await created.json();
  await navigate(page, "通知公告");
  const article = page.locator("article").filter({ hasText: title });
  await article.getByRole("button", { name: "编辑", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("正文内容").fill("已保存的公告内容");
  const saved = await defer(page, `**/api/notices/${id}`);
  await dialog.getByRole("button", { name: "保存公告" }).click();
  await saved.hit;
  await cannotDismiss(page);
  await expect(dialog.getByLabel("公告标题")).toBeDisabled();
  await expect(dialog.getByLabel("正文内容")).toBeDisabled();
  await expect(dialog.getByLabel("置顶显示此公告")).toBeDisabled();
  saved.release();
  await expect(dialog).toHaveCount(0);
  await expect(article).toContainText("已保存的公告内容");
  await page.unroute(`**/api/notices/${id}`);
  const deleted = await defer(
    page,
    `**/api/notices/${id}`,
    "公告删除失败，记录仍保留",
  );
  await article.getByRole("button", { name: "删除", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "删除公告", exact: true }).click();
  await deleted.hit;
  await cannotDismiss(page);
  deleted.release();
  await expect(dialog.getByRole("alert")).toContainText("公告删除失败");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(article).toBeVisible();
});

test("场地暂停的真实保存和恢复开放期间禁止关闭弹窗", async ({ page }) => {
  await login(page);
  await navigate(page, "场地开放安排");
  await page.getByRole("button", { name: "新增暂停安排" }).click();
  let dialog = page.getByRole("dialog");
  const reason = `保存互斥测试-${Date.now()}`;
  const date = new Date(Date.now() + 333 * 86400000).toISOString().slice(0, 10);
  await dialog.locator("[name=slot]").selectOption("26");
  await dialog.locator("[name=start]").fill(date);
  await dialog.locator("[name=end]").fill(date);
  await dialog.getByLabel("暂停原因").fill(reason);
  const saved = await defer(page, "**/api/closures");
  await dialog.getByRole("button", { name: "保存安排" }).click();
  await saved.hit;
  await cannotDismiss(page, { cancel: false });
  for (const name of ["slot", "start", "end", "reason"])
    await expect(dialog.locator(`[name=${name}]`)).toBeDisabled();
  saved.release();
  await expect(dialog).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: reason });
  await expect(row).toBeVisible();
  const deleted = await defer(page, "**/api/closures/*");
  await row.getByRole("button", { name: "恢复开放" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "恢复开放" }).click();
  await deleted.hit;
  await cannotDismiss(page);
  deleted.release();
  await expect(dialog).toHaveCount(0);
  await expect(row).toHaveCount(0);
});
