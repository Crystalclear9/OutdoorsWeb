import { test, expect } from "./browser-fixtures.js";

test("首次验证码迟到响应不能破坏重新打开登录页后显示的验证码绑定", async ({
  page,
}) => {
  let release, firstReady, secondStarted;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const first = new Promise((resolve) => {
    firstReady = resolve;
  });
  const second = new Promise((resolve) => {
    secondStarted = resolve;
  });
  let requests = 0;
  await page.route("**/api/auth/captcha", async (route) => {
    const index = ++requests;
    if (index === 2) secondStarted();
    // A standalone Node fetch preserves the original request headers without
    // route.fetch's shared APIRequestContext applying Set-Cookie ahead of the
    // browser response. Only fulfillment below may install this response cookie.
    const response = await fetch(route.request().url(), {
      headers: route.request().headers(),
    });
    const body = Buffer.from(await response.arrayBuffer());
    const headers = Object.fromEntries(response.headers);
    if (index === 1) {
      firstReady();
      await held;
    }
    await route.fulfill({ status: response.status, headers, body });
  });
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: "登录 / 注册", exact: true })
      .click();
    await first;
    expect(
      (await page.context().cookies()).some(
        (cookie) => cookie.name === "hust_captcha",
      ),
    ).toBe(false);
    await page
      .getByRole("button", { name: "返回场地浏览", exact: true })
      .click();
    await page
      .getByRole("button", { name: "登录 / 注册", exact: true })
      .click();
    // Serial readers wait for the old response before starting the next read.
    // The old implementation starts the new read immediately. Let its cookie
    // and image reach the browser before delivering the superseded response.
    const overlapped = await Promise.race([
      second.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 1500)),
    ]);
    if (overlapped)
      await expect(
        page.getByLabel("图片验证码", { exact: true }),
      ).toBeEnabled();
    const oldResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/auth/captcha",
    );
    release();
    await (await oldResponse).finished();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await page.locator("[name=email]").fill("completion@test.local");
    await page.locator("[name=password]").fill("CompletionAccount123!");
    await page.getByLabel("图片验证码", { exact: true }).fill("246789");
    const login = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/auth/login",
    );
    await page.getByRole("button", { name: "登录账号", exact: true }).click();
    expect((await login).status()).toBe(200);
    await expect(page.locator(".account-link")).toBeVisible();
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});
