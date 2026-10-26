import { test, expect } from "./browser-fixtures.js";

async function login(page, admin = false) {
  await page.getByRole("button", { name: "登录 / 注册", exact: true }).click();
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

test("登录状态读取失败独立于服务健康，纯读重试恢复真实已有会话和申报", async ({
  page,
}) => {
  await page.goto("/");
  await login(page);
  let unavailable = true,
    reads = 0,
    authWrites = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/api\/auth\/(login|register)$/.test(request.url())
    )
      authWrites++;
  });
  await page.route("**/api/auth/session", (route) => {
    reads++;
    return unavailable
      ? route.fulfill({ status: 503, json: { error: "会话读取暂时不可用" } })
      : route.continue();
  });
  await page.reload();
  const warning = page.getByRole("alert").filter({ hasText: "登录状态待确认" });
  await expect(warning).toContainText("会话读取暂时不可用");
  await expect(
    page.getByRole("button", { name: "发起布展申请", exact: true }),
  ).toBeDisabled();
  // A successful public health read during navigation must not erase the error.
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "摆放区域示意", exact: true })
    .click();
  await expect(warning).toBeVisible();
  await expect(
    page.getByRole("button", { name: "发起布展申请", exact: true }),
  ).toBeDisabled();
  expect(
    (await (await page.request.get("/api/auth/session")).json()).user.email,
  ).toBe("completion@test.local");
  unavailable = false;
  await warning
    .getByRole("button", { name: "重新读取登录状态", exact: true })
    .click();
  await expect(page.locator(".account-link")).toBeVisible();
  await expect(warning).toHaveCount(0);
  await page.getByRole("button", { name: "发起布展申请", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("提交布展申请");
  expect(reads).toBe(2);
  expect(authWrites).toBe(0);
});

test("身份读取失败后仍可显式重新登录，成功清除读取错误并显示新身份", async ({
  page,
}) => {
  await page.route(
    "**/api/auth/session",
    (route) =>
      route.fulfill({ status: 503, json: { error: "初次身份读取失败" } }),
    { times: 1 },
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("初次身份读取失败");
  await login(page, true);
  await expect(
    page.getByRole("alert").filter({ hasText: "登录状态待确认" }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "企业申报审核", exact: true }),
  ).toBeVisible();
});
