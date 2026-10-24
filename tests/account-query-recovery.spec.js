import { randomUUID } from "node:crypto";
import { test, expect } from "./browser-fixtures.js";

test("账号查询失败时不能管理旧企业，重新读取后仅停用当前目标账号", async ({
  page,
  browser,
  extraHTTPHeaders,
}) => {
  const owner = await browser.newContext({ extraHTTPHeaders });
  try {
    const users = [];
    for (const label of ["旧企业", "目标企业"]) {
      const captcha = await (
        await owner.request.get("http://127.0.0.1:3101/api/auth/captcha")
      ).json();
      const { csrf } = await (
        await owner.request.get("http://127.0.0.1:3101/api/auth/session")
      ).json();
      const response = await owner.request.post(
        "http://127.0.0.1:3101/api/auth/register",
        {
          headers: {
            Origin: "http://127.0.0.1:3101",
            ...(csrf ? { "X-CSRF-Token": csrf } : {}),
          },
          data: {
            email: `account-query-${randomUUID()}@company.local`,
            password: "AccountQuery123!",
            company: `账号查询恢复-${label}`,
            contact: "李老师",
            phone: "13800138000",
            captchaId: captcha.id,
            captcha: "246789",
          },
        },
      );
      expect(response.status()).toBe(201);
      users.push((await response.json()).user);
    }
    await page.goto("/");
    await page.getByRole("button", { name: "登录 / 注册" }).click();
    await page.locator("[name=email]").fill("admin@test.local");
    await page.locator("[name=password]").fill("BrowserAdmin123!");
    await page.getByLabel("图片验证码", { exact: true }).fill("246789");
    await page.getByRole("button", { name: "登录账号", exact: true }).click();
    await expect(page.locator(".account-link")).toBeVisible();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "账号管理", exact: true })
      .click();
    const card = page
      .locator(".card")
      .filter({ has: page.getByRole("heading", { name: "账号管理" }) });
    const search = page.getByLabel("搜索账号");
    await search.fill(users[0].email);
    await expect(
      card.getByRole("row").filter({ hasText: users[0].email }),
    ).toBeVisible();
    const fail = (route) =>
      route.fulfill({ status: 503, json: { error: "模拟账号查询失败" } });
    await page.route("**/api/users?**", fail);
    await search.fill(users[1].email);
    await expect(card.getByRole("alert")).toContainText("模拟账号查询失败");
    await expect(card.locator("tbody tr")).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "停用", exact: true }),
    ).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "重置密码", exact: true }),
    ).toHaveCount(0);
    await page.unroute("**/api/users?**", fail);
    await card.getByRole("button", { name: "刷新账号", exact: true }).click();
    const target = card.getByRole("row").filter({ hasText: users[1].email });
    await expect(target).toBeVisible();
    await target.getByRole("button", { name: "停用", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认操作", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(target).toContainText("已停用");
    for (let i = 0; i < users.length; i++) {
      const latest = (
        await (
          await page.request.get(
            `/api/users?q=${encodeURIComponent(users[i].email)}`,
          )
        ).json()
      ).items.find((user) => user.id === users[i].id);
      expect(latest.disabled).toBe(i === 1);
    }
  } finally {
    await owner.close();
  }
});
