import { test, expect } from "./browser-fixtures.js";
import { totp } from "../server/mfa.mjs";
const origin = "http://127.0.0.1:3101";
async function login(page, email, password) {
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.locator("[name=email]").fill(email);
  await page.locator("[name=password]").fill(password);
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.locator(".account-link")).toBeVisible();
}
async function headers(page) {
  const session = await (await page.request.get("/api/auth/session")).json();
  return { Origin: origin, "X-CSRF-Token": session.csrf };
}

test("改期界面保留原预约并由审批台原子替换；现场登记单独保存", async ({
  page,
  browser,
}) => {
  await login(page, "completion@test.local", "CompletionAccount123!");
  const image =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=";
  const start = new Date(Date.now() + 100 * 86400000)
      .toISOString()
      .slice(0, 10),
    end = new Date(Date.now() + 101 * 86400000).toISOString().slice(0, 10);
  const made = await page.request.post("/api/bookings", {
    headers: await headers(page),
    data: {
      company: "改期界面测试企业",
      contact: "李老师",
      phone: "13900139000",
      slot: 25,
      start,
      end: start,
      image,
    },
  });
  expect(made.status()).toBe(201);
  const id = (await made.json()).id;
  const context = await browser.newContext(),
    admin = await context.newPage();
  await login(admin, "admin@test.local", "BrowserAdmin123!");
  await expect(
    admin.getByRole("button", { name: "账号管理", exact: true }),
  ).toBeVisible();
  expect(
    (
      await admin.request.post(`/api/bookings/${id}/review`, {
        headers: await headers(admin),
        data: { status: "已通过" },
      })
    ).ok(),
  ).toBe(true);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的申请", exact: true })
    .click();
  await page
    .getByRole("row")
    .filter({ hasText: id })
    .getByRole("button", { name: "查看详情" })
    .click();
  await page.getByRole("button", { name: "申请改期 / 换位" }).click();
  await page.getByRole("dialog").locator("[name=start]").fill(end);
  await page.getByRole("dialog").locator("[name=end]").fill(end);
  await page.getByRole("dialog").locator("[name=slot]").selectOption("26");
  await page.getByRole("button", { name: "提交改期申请" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: id })).toContainText(
    "已通过",
  );
  await admin
    .getByRole("navigation")
    .getByRole("button", { name: "企业申报审核", exact: true })
    .click();
  await admin.getByLabel("搜索待办申请").fill("改期界面测试企业");
  await expect(admin.getByRole("region", { name: "申请审阅区" })).toContainText(
    "改期申请",
  );
  await admin.getByRole("button", { name: "通过并审阅下一条" }).click();
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的申请", exact: true })
    .click();
  await expect(page.getByRole("row").filter({ hasText: id })).toContainText(
    "已取消",
  );
  await admin
    .getByRole("navigation")
    .getByRole("button", { name: "场地开放安排", exact: true })
    .click();
  const position = admin
    .locator(".onsite-position")
    .filter({ hasText: "28号" });
  await position.getByRole("checkbox").check();
  await position.getByRole("textbox").fill("现场核对已摆放");
  await admin.getByRole("button", { name: "保存现场登记" }).click();
  await expect(admin.locator(".onsite-summary")).toContainText(
    "实际已摆放 1 / 29",
  );
  await admin.reload();
  await admin
    .getByRole("navigation")
    .getByRole("button", { name: "场地开放安排", exact: true })
    .click();
  await expect(admin.getByLabel("28号现场备注")).toHaveValue("现场核对已摆放");
  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    await guest.goto("/");
    await guest
      .getByRole("navigation")
      .getByRole("button", { name: "场地查询", exact: true })
      .click();
    await expect(guest.locator(".venue-onsite-summary")).toContainText(
      "已摆放 1 / 29",
    );
    await guest
      .getByRole("button", { name: "28号 可预约", exact: true })
      .click();
    await expect(
      guest.locator(".position-details > div").filter({ hasText: "现场登记" }),
    ).toContainText("已摆放");
    const publicData = await (await guest.request.get("/api/venue")).json();
    expect(JSON.stringify(publicData)).not.toContain("现场核对已摆放");
    expect(publicData.onsite.find((row) => row.slot === 28).present).toBe(true);
    await guest.getByLabel("查询日期").fill(start);
    await expect(guest.locator(".venue-onsite-summary")).toContainText(
      "尚无现场登记",
    );
  } finally {
    await guestContext.close();
  }
  await admin.setViewportSize({ width: 390, height: 844 });
  expect(
    await admin.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await context.close();
});

test("工作人员可扫码开启两步验证，退出后使用恢复码完成登录并关闭", async ({
  page,
}) => {
  await login(page, "admin@test.local", "BrowserAdmin123!");
  await expect(
    page.getByRole("button", { name: "账号管理", exact: true }),
  ).toBeVisible();
  const email = "mfa-ui@test.local",
    password = "MfaBrowserAccount123!";
  const made = await page.request.post("/api/access/staff", {
    headers: await headers(page),
    data: {
      email,
      contact: "安全测试",
      permissions: ["notices.manage"],
      currentPassword: "BrowserAdmin123!",
    },
  });
  expect(made.status()).toBe(201);
  const temporary = (await made.json()).temporaryPassword;
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.locator("[name=email]").fill(email);
  await page.locator("[name=password]").fill(temporary);
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.locator(".account-link")).toBeVisible();
  expect(
    (
      await page.request.post("/api/auth/password", {
        headers: await headers(page),
        data: { currentPassword: temporary, newPassword: password },
      })
    ).ok(),
  ).toBe(true);
  await login(page, email, password);
  await page.locator(".account-link").click();
  await page.locator(".mfa-form [name=currentPassword]").fill(password);
  await page.getByRole("button", { name: "设置两步验证" }).click();
  await expect(
    page.getByRole("img", { name: "两步验证设置二维码" }),
  ).toBeVisible();
  const secret = await page.locator(".mfa-setup code").textContent();
  await page.locator(".mfa-form [name=code]").fill(totp(secret));
  await page.getByRole("button", { name: "验证并开启" }).click();
  await expect(page.locator(".recovery-codes")).toBeVisible();
  const codes = (await page.locator(".recovery-codes pre").textContent()).split(
    "\n",
  );
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.locator("[name=email]").fill(email);
  await page.locator("[name=password]").fill(password);
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "验证您的身份" }),
  ).toBeVisible();
  await page.getByLabel("动态验证码或恢复码", { exact: true }).fill(codes[0]);
  await page.getByRole("button", { name: "完成两步验证" }).click();
  await page.locator(".account-link").click();
  await expect(page.locator(".mfa-form")).toContainText("剩余恢复码 9 个");
  await page.locator(".mfa-form [name=currentPassword]").fill(password);
  await page.locator(".mfa-form [name=code]").fill(codes[1]);
  await page.getByRole("button", { name: "关闭两步验证" }).click();
  await expect(
    page.getByRole("button", { name: "设置两步验证" }),
  ).toBeVisible();
});
