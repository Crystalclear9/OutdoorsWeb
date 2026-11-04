import { test, expect } from "@playwright/test";

async function role(page, label) {
  const button = page
    .getByRole("group", { name: "切换演示身份", exact: true })
    .getByRole("button", { name: label, exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

test("Pages核验保存及历史可见，企业仅查看公开结论，刷新后保留且不调用真实API", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.includes("/api/"))
      requests.push(request.url());
  });
  await page.goto("?showcase=1");
  await role(page, "管理员");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "账号管理", exact: true })
    .click();
  await page
    .getByLabel("搜索账号", { exact: true })
    .fill("enterprise@showcase.invalid");
  await page
    .getByRole("row")
    .filter({ hasText: "enterprise@showcase.invalid" })
    .getByRole("button", { name: "企业核验", exact: true })
    .click();
  const dialog = page.getByRole("dialog"),
    evidence = "PRIVATE-PAGES-VERIFICATION-20261104",
    note = "活动中心已核实示例企业授权联系人";
  await expect(dialog).toContainText("示例企业 · 青禾文化");
  await dialog.getByLabel("核验结论", { exact: true }).selectOption("verified");
  await dialog.getByLabel("内部核验依据", { exact: true }).fill(evidence);
  await dialog.getByLabel("企业可见说明", { exact: true }).fill(note);
  await dialog
    .getByRole("button", { name: "保存核验记录", exact: true })
    .click();
  await expect(
    dialog.getByText("已核验", { exact: true }).first(),
  ).toBeVisible();
  await dialog.getByText(/历史核验记录（第/).click();
  const history = dialog.locator("details[open]");
  await expect(history.getByText(evidence, { exact: true })).toBeVisible();
  await expect(history).toContainText("示例企业 · 青禾文化");
  await expect(history).toContainText(note);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();

  await role(page, "企业");
  await page.locator(".account-link").click();
  const box = page.locator("section.card").filter({
    has: page.getByRole("heading", { name: "企业资料核验", exact: true }),
  });
  await expect(box).toContainText("已核验");
  await expect(box).toContainText(note);
  await expect(page.getByText(evidence, { exact: true })).toHaveCount(0);
  await expect(box.getByLabel("内部核验依据", { exact: true })).toHaveCount(0);
  await expect(box.getByText(/历史核验记录/)).toHaveCount(0);
  await page.reload();
  await page.locator(".account-link").click();
  await expect(box).toContainText("已核验");
  await expect(box).toContainText(note);
  await expect(page.getByText(evidence, { exact: true })).toHaveCount(0);
  expect(requests).toEqual([]);
});
