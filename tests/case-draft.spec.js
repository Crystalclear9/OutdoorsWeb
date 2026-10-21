import { test, expect } from "./browser-fixtures.js";

test("办理记录刷新失败保留付款输入，重新核对成功前禁止提交", async ({
  page,
}) => {
  let failNext = false,
    submitted = false;
  const record = () => ({
    id: "CASE-DRAFT",
    company: "草稿保护企业",
    slot: 1,
    status: "已通过",
    cancelled: 0,
    due: "2030-01-01T02:00:00Z",
    contactResult: { state: "pending" },
    fee: {
      state: submitted ? "submitted" : "due",
      amount_fen: 1200,
      version: submitted ? 2 : 1,
      note: "测试单位收费",
      instructions: "学校财务窗口",
    },
  });
  await page.route("**/api/casework?**", (r) =>
    r.fulfill({ json: { items: [record()], page: 1, pages: 1, total: 1 } }),
  );
  await page.route("**/api/casework/CASE-DRAFT**", (r) => {
    if (r.request().method() === "POST") {
      expect(r.request().postDataJSON()).toEqual({
        action: "submit",
        reference: "BANK-DRAFT-001",
      });
      expect(r.request().headers()["if-match"]).toBe('"1"');
      submitted = true;
      return r.fulfill({ json: { ok: true } });
    }
    if (failNext) {
      failNext = false;
      return r.abort("failed");
    }
    return r.fulfill({ json: { item: record() } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.locator("[name=email]").fill("completion@test.local");
  await page.locator("[name=password]").fill("CompletionAccount123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await page
    .getByRole("button", { name: "通知与缴费办理", exact: true })
    .click();
  await page.locator(".case-row").click();
  const panel = page.getByRole("region", { name: "办理与缴费记录" });
  await panel.getByLabel("线下付款时间及流水号").fill("BANK-DRAFT-001");
  failNext = true;
  await panel.getByRole("button", { name: "刷新办理记录" }).click();
  await expect(panel.getByRole("alert")).toContainText("无法读取最新办理记录");
  await expect(panel.getByLabel("线下付款时间及流水号")).toHaveValue(
    "BANK-DRAFT-001",
  );
  await expect(
    panel.getByRole("button", { name: "提交付款流水" }),
  ).toBeDisabled();
  await panel.getByRole("button", { name: "刷新办理记录" }).click();
  await expect(
    panel.getByRole("button", { name: "提交付款流水" }),
  ).toBeEnabled();
  await expect(panel.getByLabel("线下付款时间及流水号")).toHaveValue(
    "BANK-DRAFT-001",
  );
  await panel.getByRole("button", { name: "提交付款流水" }).click();
  await expect(panel).toContainText("流水待核对");
});
