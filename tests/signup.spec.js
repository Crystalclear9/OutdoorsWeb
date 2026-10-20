import { test, expect } from "@playwright/test";
for (const mobile of [false, true])
  test(`首次快捷登录补齐企业资料并保持登录${mobile ? "（手机）" : "（桌面）"}`, async ({
    page,
    context,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await context.addCookies([
      {
        name: "hust_external",
        value: "signup-browser-binding",
        domain: "127.0.0.1",
        path: "/api/auth",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const proof = (mobile ? "d" : "c").repeat(64);
    await page.goto(`/#signup=${proof}`);
    await expect(
      page.getByRole("heading", { name: "完成企业账号" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.locator(".external-signup-form [name=email]"),
    ).toBeVisible();
    const form = page.locator(".external-signup-form");
    await form.locator("[name=email]").fill(`signup-${mobile}@test.local`);
    await form.locator("[name=company]").fill("快捷登录界面测试企业");
    await form.locator("[name=contact]").fill("王老师");
    if (mobile) {
      await expect(form.locator("[name=phone]")).toHaveValue("13600136000");
      await expect(form.locator("[name=phone]")).toHaveAttribute(
        "readonly",
        "",
      );
    } else await form.locator("[name=phone]").fill("13500135000");
    await form.locator("[name=password]").fill("NewSignupAccount123!");
    await form.locator("[name=confirm]").fill("NewSignupAccount123!");
    await form.getByRole("checkbox").check();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await form.getByRole("button", { name: "完成资料并进入工作台" }).click();
    await expect(page.locator(".workspace-welcome")).toContainText("王老师");
    expect(new URL(page.url()).hash).toBe("");
    await page.reload();
    await expect(page.locator(".workspace-welcome")).toContainText("王老师");
    const session = await (await page.request.get("/api/auth/session")).json();
    expect(session.user.role).toBe("enterprise");
    expect(session.user.isSuperAdmin).toBe(false);
  });
