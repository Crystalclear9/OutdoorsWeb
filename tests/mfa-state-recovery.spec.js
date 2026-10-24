import { randomUUID } from "node:crypto";
import { totp } from "../server/mfa.mjs";
import { test, expect } from "./browser-fixtures.js";

const PASSWORD = "MfaStateRecovery123!";
async function register(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.getByRole("button", { name: "企业注册", exact: true }).click();
  await page
    .locator("[name=email]")
    .fill(`mfa-state-${randomUUID()}@company.local`);
  await page.locator("[name=company]").fill("验证状态恢复测试企业");
  await page.locator("[name=contact]").fill("李老师");
  await page.locator("[name=phone]").fill("13800138000");
  await page.locator("[name=password]").fill(PASSWORD);
  await page.locator("[name=confirm]").fill(PASSWORD);
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.locator(".account-link")).toBeVisible();
}
async function headers(page) {
  const { csrf } = await (await page.request.get("/api/auth/session")).json();
  return { Origin: "http://127.0.0.1:3101", "X-CSRF-Token": csrf };
}
const card = (page) =>
  page.locator(".card").filter({
    has: page.getByRole("heading", { name: "两步验证", exact: true }),
  });

test("已启用MFA但初次读取失败时显示未知状态，重新读取后恢复真实启用状态", async ({
  page,
}) => {
  await register(page);
  const setup = await page.request.post("/api/auth/mfa/setup", {
    headers: await headers(page),
    data: { currentPassword: PASSWORD },
  });
  expect(setup.status()).toBe(200);
  const { secret } = await setup.json();
  const enabled = await page.request.post("/api/auth/mfa/enable", {
    headers: await headers(page),
    data: { code: totp(secret) },
  });
  expect(enabled.status()).toBe(200);
  let unavailable = true;
  await page.route("**/api/auth/mfa", (route) =>
    unavailable
      ? route.fulfill({ status: 503, json: { error: "验证状态暂时无法读取" } })
      : route.continue(),
  );
  await page.locator(".account-link").click();
  const panel = card(page);
  await expect(panel.getByRole("alert")).toContainText("验证状态暂时无法读取");
  await expect(panel.locator(".subtle-tag")).toHaveText("状态待确认");
  await expect(
    panel.getByRole("button", { name: "设置两步验证", exact: true }),
  ).toHaveCount(0);
  unavailable = false;
  await panel
    .getByRole("button", { name: "重新读取验证状态", exact: true })
    .click();
  await expect(panel.locator(".subtle-tag")).toHaveText("已开启");
  await expect(
    panel.getByRole("button", { name: "关闭两步验证", exact: true }),
  ).toBeEnabled();
  await expect(panel.getByRole("alert")).toHaveCount(0);
});

test("MFA真实启用后重读失败保留恢复码，确认保存后仍暂停旧状态操作直到读取成功", async ({
  page,
}) => {
  await register(page);
  await page.locator(".account-link").click();
  const panel = card(page);
  await panel.getByLabel("当前密码", { exact: true }).fill(PASSWORD);
  await panel
    .getByRole("button", { name: "设置两步验证", exact: true })
    .click();
  const secret = await panel.locator(".mfa-setup code").innerText();
  let unavailable = true;
  await page.route("**/api/auth/mfa", (route) =>
    unavailable
      ? route.fulfill({ status: 503, json: { error: "启用后的状态读取失败" } })
      : route.continue(),
  );
  await panel.getByLabel("动态验证码", { exact: true }).fill(totp(secret));
  await panel.getByRole("button", { name: "验证并开启", exact: true }).click();
  await expect(
    panel.getByText("请立即保存恢复码", { exact: true }),
  ).toBeVisible();
  const codes = await panel.locator(".recovery-codes pre").innerText();
  expect(codes.trim().split("\n")).toHaveLength(10);
  expect((await (await page.request.get("/api/auth/mfa")).json()).enabled).toBe(
    true,
  );
  await expect(panel.getByRole("alert")).toContainText("启用后的状态读取失败");
  await expect(panel.locator(".subtle-tag")).toHaveText("状态待确认");
  await expect(panel.locator(".recovery-codes pre")).toHaveText(codes);
  await panel
    .getByRole("button", { name: "我已妥善保存", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "设置两步验证", exact: true }),
  ).toHaveCount(0);
  unavailable = false;
  await panel
    .getByRole("button", { name: "重新读取验证状态", exact: true })
    .click();
  await expect(panel.locator(".subtle-tag")).toHaveText("已开启");
  await expect(
    panel.getByText("剩余恢复码 10 个。", { exact: false }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "关闭两步验证", exact: true }),
  ).toBeEnabled();
});

test("MFA已保存但账号同步失败有明确提示且可重试，不产生未处理异常或丢失恢复码", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await register(page);
  await page.locator(".account-link").click();
  const panel = card(page);
  await panel.getByLabel("当前密码", { exact: true }).fill(PASSWORD);
  await panel
    .getByRole("button", { name: "设置两步验证", exact: true })
    .click();
  const secret = await panel.locator(".mfa-setup code").innerText();
  let unavailable = true;
  await page.route("**/api/auth/session", (route) =>
    unavailable
      ? route.fulfill({ status: 503, json: { error: "账号同步暂时失败" } })
      : route.continue(),
  );
  await panel.getByLabel("动态验证码", { exact: true }).fill(totp(secret));
  await panel.getByRole("button", { name: "验证并开启", exact: true }).click();
  await expect(
    panel.getByText("请立即保存恢复码", { exact: true }),
  ).toBeVisible();
  await expect(panel.getByRole("alert")).toContainText(
    "设置已保存，但账号状态同步失败",
  );
  const codes = await panel.locator(".recovery-codes pre").innerText();
  expect(codes.trim().split("\n")).toHaveLength(10);
  expect(errors).toEqual([]);
  unavailable = false;
  await panel
    .getByRole("button", { name: "重新读取验证状态", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(panel.locator(".recovery-codes pre")).toHaveText(codes);
  await expect(panel.locator(".subtle-tag")).toHaveText("已开启");
  expect(errors).toEqual([]);
});
