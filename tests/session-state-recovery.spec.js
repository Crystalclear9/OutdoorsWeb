import { randomUUID } from "node:crypto";
import { test, expect } from "./browser-fixtures.js";

const origin = "http://127.0.0.1:3101";
test("设备撤销已生效但回读失败时暂停旧列表，重试只读取且恢复真实会话", async ({
  page,
  browser,
  extraHTTPHeaders,
}) => {
  const email = `session-recovery-${randomUUID()}@company.local`,
    password = "SessionRecovery123!",
    other = await browser.newContext({ extraHTTPHeaders });
  try {
    const captcha = await (await page.request.get("/api/auth/captcha")).json();
    const registered = await page.request.post("/api/auth/register", {
      headers: { Origin: origin },
      data: {
        email,
        password,
        company: "设备状态恢复企业",
        contact: "李老师",
        phone: "13800138000",
        captchaId: captcha.id,
        captcha: "246789",
      },
    });
    expect(registered.status()).toBe(201);
    const challenge = await (
      await other.request.get(`${origin}/api/auth/captcha`)
    ).json();
    const login = await other.request.post(`${origin}/api/auth/login`, {
      headers: { Origin: origin },
      data: { email, password, captchaId: challenge.id, captcha: "246789" },
    });
    expect(login.status()).toBe(200);
    await page.goto("/");
    await page.locator(".account-link").click();
    const panel = page.locator(".card").filter({
      has: page.getByRole("heading", {
        name: "登录设备与授权会话",
        exact: true,
      }),
    });
    await expect(
      panel.getByRole("button", { name: "退出", exact: true }),
    ).toHaveCount(1);
    let unavailable = true,
      writes = 0;
    await page.route("**/api/auth/sessions", (route) =>
      unavailable
        ? route.fulfill({
            status: 503,
            json: { error: "设备列表暂时无法读取" },
          })
        : route.continue(),
    );
    await page.route("**/api/auth/sessions/*", (route) => {
      if (route.request().method() === "DELETE") writes++;
      return route.continue();
    });
    await panel.getByRole("button", { name: "退出", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText(
      "设备列表暂时无法读取",
    );
    // Verify the write actually succeeded before checking the failed read UI.
    const actual = await (await page.request.get("/api/auth/sessions")).json();
    expect(actual.items).toHaveLength(1);
    expect(actual.items[0].current).toBe(true);
    const revoked = await (
      await other.request.get(`${origin}/api/auth/session`)
    ).json();
    expect(revoked.user).toBeNull();
    await expect(
      panel.getByRole("button", { name: "退出", exact: true }),
    ).toHaveCount(0);
    await expect(panel.getByRole("alert")).toContainText("已撤销");
    await expect(
      panel.getByRole("button", { name: "退出其他设备", exact: true }),
    ).toBeDisabled();
    unavailable = false;
    await panel
      .getByRole("button", { name: "重新读取登录设备", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toHaveCount(0);
    await expect(panel.locator(".session-list > div")).toHaveCount(1);
    expect(writes).toBe(1);
  } finally {
    await other.close();
  }
});
