import { test, expect } from "./browser-fixtures.js";

const IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=";
async function login(page, admin = false) {
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page
    .locator("[name=email]")
    .fill(admin ? "admin@test.local" : "completion@test.local");
  await page
    .locator("[name=password]")
    .fill(admin ? "BrowserAdmin123!" : "CompletionAccount123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.locator(".account-link")).toBeVisible();
}
async function submit(owner, company, slot) {
  const { csrf } = await (await owner.request.get("/api/auth/session")).json();
  const date = new Date(Date.now() + 331 * 86400000).toISOString().slice(0, 10);
  const response = await owner.request.post("/api/bookings", {
    headers: { Origin: "http://127.0.0.1:3101", "X-CSRF-Token": csrf },
    data: {
      company,
      contact: "张老师",
      phone: "13800138000",
      builder_contact: "搭建负责人",
      builder_phone: "13900139000",
      start: date,
      end: date,
      image: IMAGE,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id;
}

test("审批队列查询失败不能继续审批旧条件的申请，重读成功后只操作当前企业", async ({
  page,
  browser,
  extraHTTPHeaders,
}) => {
  const ownerContext = await browser.newContext({ extraHTTPHeaders });
  try {
    const owner = await ownerContext.newPage();
    await login(owner);
    const oldCompany = "审批查询一致性-旧企业",
      newCompany = "审批查询一致性-目标企业",
      oldId = await submit(owner, oldCompany, 25),
      newId = await submit(owner, newCompany, 26);
    await login(page, true);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "企业申报审核", exact: true })
      .click();
    await page.getByLabel("搜索待办申请").fill(oldCompany);
    const detail = page.getByRole("region", { name: "申请审阅区" });
    await expect(
      detail.getByRole("heading", { name: oldCompany, exact: true }),
    ).toBeVisible();
    await expect(detail.locator("img")).toBeVisible();
    await page
      .getByRole("checkbox", { name: "选择本页全部申请", exact: true })
      .check();
    await expect(
      page.getByRole("button", { name: "批量通过", exact: true }),
    ).toBeEnabled();
    const failed = async (route) =>
      route.fulfill({ status: 503, json: { error: "模拟审批查询失败" } });
    await page.route("**/api/bookings?**", failed);
    await page.getByLabel("搜索待办申请").fill(newCompany);
    await expect(page.getByRole("alert")).toContainText("模拟审批查询失败");
    // Approval must never operate on the previous successful search snapshot.
    await expect(detail).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "批量通过", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("checkbox", { name: "选择本页全部申请", exact: true }),
    ).toBeDisabled();
    await page.unroute("**/api/bookings?**", failed);
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(
      detail.getByRole("heading", { name: newCompany, exact: true }),
    ).toBeVisible();
    await expect(detail.locator("img")).toBeVisible();
    await detail
      .getByRole("button", { name: "通过并审阅下一条", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "暂无待办申请", exact: true }),
    ).toBeVisible();
    expect(
      (await (await owner.request.get(`/api/bookings/${oldId}`)).json()).booking
        .status,
    ).toBe("待审核");
    expect(
      (await (await owner.request.get(`/api/bookings/${newId}`)).json()).booking
        .status,
    ).toBe("已通过");
  } finally {
    await ownerContext.close();
  }
});

test("审批队列同条件刷新失败也暂停已选批量操作直到重新读取成功", async ({
  page,
  browser,
  extraHTTPHeaders,
}) => {
  const ownerContext = await browser.newContext({ extraHTTPHeaders });
  try {
    const owner = await ownerContext.newPage();
    await login(owner);
    const company = "审批刷新失败保护企业";
    await submit(owner, company, 27);
    await login(page, true);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "企业申报审核", exact: true })
      .click();
    await page.getByLabel("搜索待办申请").fill(company);
    const detail = page.getByRole("region", { name: "申请审阅区" });
    await expect(
      detail.getByRole("heading", { name: company, exact: true }),
    ).toBeVisible();
    await detail.getByLabel("审批意见").fill("刷新失败后仍需保留的审核意见");
    await page
      .getByRole("checkbox", { name: "选择本页全部申请", exact: true })
      .check();
    const failed = async (route) =>
      route.fulfill({ status: 503, json: { error: "模拟审批刷新失败" } });
    await page.route("**/api/bookings?**", failed);
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("模拟审批刷新失败");
    await expect(detail).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "批量通过", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "批量退回", exact: true }),
    ).toBeDisabled();
    await page.unroute("**/api/bookings?**", failed);
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(
      detail.getByRole("heading", { name: company, exact: true }),
    ).toBeVisible();
    await expect(detail.getByLabel("审批意见")).toHaveValue(
      "刷新失败后仍需保留的审核意见",
    );
    await expect(
      page.getByRole("button", { name: "批量通过", exact: true }),
    ).toBeEnabled();
  } finally {
    await ownerContext.close();
  }
});
