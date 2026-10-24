import { randomUUID } from "node:crypto";
import { test, expect } from "./browser-fixtures.js";

const PASSWORD = "AccountBoundary123!";
async function register(page) {
  const email = `account-boundary-${randomUUID()}@company.local`;
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.getByRole("button", { name: "企业注册", exact: true }).click();
  await page.locator("[name=email]").fill(email);
  await page.locator("[name=company]").fill("账号会话边界测试企业");
  await page.locator("[name=contact]").fill("初始联系人");
  await page.locator("[name=phone]").fill("13800138000");
  await page.locator("[name=password]").fill(PASSWORD);
  await page.locator("[name=confirm]").fill(PASSWORD);
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.locator(".account-link")).toBeVisible();
  return email;
}
async function login(page, email, password) {
  await page.locator("[name=email]").fill(email);
  await page.locator("[name=password]").fill(password);
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.locator(".account-link")).toBeVisible();
}
async function hold(page, pattern) {
  let release, received;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const hit = new Promise((resolve) => {
    received = resolve;
  });
  let first = true;
  await page.route(pattern, async (route) => {
    if (!first) return route.continue();
    first = false;
    const response = await route.fetch();
    received();
    await gate;
    await route.fulfill({ response });
  });
  return { release, hit };
}

for (const mode of ["different-account", "same-account"]) {
  test(`退出重登录后旧资料响应不能覆盖当前会话（${mode}）`, async ({
    page,
  }) => {
    const email = await register(page);
    await page.locator(".account-link").click();
    const delayed = await hold(page, "**/api/profile");
    try {
      await page.locator(".card-form [name=contact]").fill("旧请求联系人");
      await page.getByRole("button", { name: "保存资料", exact: true }).click();
      await delayed.hit;
      await page.getByRole("button", { name: "退出登录", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "登录账号", exact: true }),
      ).toBeVisible();
      await login(
        page,
        mode === "same-account" ? email : "admin@test.local",
        mode === "same-account" ? PASSWORD : "BrowserAdmin123!",
      );
      const current = (
        await (await page.request.get("/api/auth/session")).json()
      ).user;
      await page.locator(".account-link").click();
      if (mode === "same-account") {
        await page
          .locator(".card-form [name=contact]")
          .fill("当前会话最新联系人");
        await page
          .getByRole("button", { name: "保存资料", exact: true })
          .click();
        await expect(page.locator(".account-link")).toContainText(
          "当前会话最新联系人",
        );
      }
      const oldResponse = page.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/profile",
      );
      delayed.release();
      await (await oldResponse).finished();
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await expect(page.locator(".account-link")).toContainText(
        mode === "same-account" ? "当前会话最新联系人" : current.contact,
      );
      await expect(page.locator(".account-profile")).toContainText(
        current.email,
      );
      if (mode === "different-account")
        await expect(
          page
            .getByRole("navigation")
            .getByRole("button", { name: "企业申报审核", exact: true }),
        ).toBeVisible();
      expect(
        (await (await page.request.get("/api/auth/session")).json()).user.email,
      ).toBe(current.email);
    } finally {
      delayed.release();
    }
  });
}

test("同一登录内离开账号页再保存资料，旧版本响应不能覆盖新资料", async ({
  page,
}) => {
  await register(page);
  await page.locator(".account-link").click();
  const delayed = await hold(page, "**/api/profile");
  try {
    await page.locator(".card-form [name=contact]").fill("同代旧联系人");
    await page.getByRole("button", { name: "保存资料", exact: true }).click();
    await delayed.hit;
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "服务工作台", exact: true })
      .click();
    await page.locator(".account-link").click();
    await page.locator(".card-form [name=contact]").fill("同代最新联系人");
    await page.getByRole("button", { name: "保存资料", exact: true }).click();
    await expect(page.locator(".account-link")).toContainText("同代最新联系人");
    const latest = (await (await page.request.get("/api/auth/session")).json())
      .user;
    const oldResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/profile",
    );
    delayed.release();
    await (await oldResponse).finished();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await expect(page.locator(".account-link")).toContainText("同代最新联系人");
    expect(
      (await (await page.request.get("/api/auth/session")).json()).user.version,
    ).toBe(latest.version);
  } finally {
    delayed.release();
  }
});

test("修改密码等待响应期间锁定退出，完成后仍可正常退出并登录其他账号", async ({
  page,
}) => {
  await register(page);
  await page.locator(".account-link").click();
  const delayed = await hold(page, "**/api/auth/password");
  try {
    const form = page.locator("form").filter({
      has: page.getByRole("button", { name: "更新密码", exact: true }),
    });
    await form.locator("[name=currentPassword]").fill(PASSWORD);
    await form.locator("[name=newPassword]").fill("UpdatedBoundary123!");
    await form.locator("[name=confirm]").fill("UpdatedBoundary123!");
    await form.getByRole("button", { name: "更新密码", exact: true }).click();
    await delayed.hit;
    await expect(
      page.getByRole("button", { name: "退出登录", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "安全退出登录", exact: true }),
    ).toBeDisabled();
    // A real protected read now sees the password change's revoked session.
    // It must not open authentication before the held cookie-clearing response.
    const revokedRead = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/bookings" &&
        response.status() === 401,
    );
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "我的申请", exact: true })
      .click();
    await revokedRead;
    await expect(page.locator(".account-link")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "退出登录", exact: true }),
    ).toBeDisabled();
    await page.locator(".account-link").click();
    await expect(
      page.getByRole("button", { name: "更新密码", exact: true }),
    ).toBeDisabled();
    delayed.release();
    await expect(
      page.getByRole("button", { name: "登录账号", exact: true }),
    ).toBeVisible();
    await login(page, "admin@test.local", "BrowserAdmin123!");
    expect(
      (await (await page.request.get("/api/auth/session")).json()).user.email,
    ).toBe("admin@test.local");
    await expect(
      page
        .getByRole("navigation")
        .getByRole("button", { name: "企业申报审核", exact: true }),
    ).toBeVisible();
  } finally {
    delayed.release();
  }
});

test("密码保存失败后释放退出与重试入口并保留输入", async ({ page }) => {
  await register(page);
  await page.locator(".account-link").click();
  await page.route("**/api/auth/password", (route) =>
    route.fulfill({ status: 503, json: { error: "模拟密码保存暂时失败" } }),
  );
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "更新密码", exact: true }),
  });
  await form.locator("[name=currentPassword]").fill(PASSWORD);
  await form.locator("[name=newPassword]").fill("UpdatedBoundary123!");
  await form.locator("[name=confirm]").fill("UpdatedBoundary123!");
  await form.getByRole("button", { name: "更新密码", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("模拟密码保存暂时失败");
  await expect(
    page.getByRole("button", { name: "退出登录", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "安全退出登录", exact: true }),
  ).toBeEnabled();
  await expect(
    form.getByRole("button", { name: "更新密码", exact: true }),
  ).toBeEnabled();
  await expect(form.locator("[name=newPassword]")).toHaveValue(
    "UpdatedBoundary123!",
  );
  await page.unroute("**/api/auth/password");
  await form.getByRole("button", { name: "更新密码", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登录账号", exact: true }),
  ).toBeVisible();
});
