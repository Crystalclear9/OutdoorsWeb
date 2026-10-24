import { readFile } from "node:fs/promises";
import { test, expect } from "./browser-fixtures.js";

async function setup(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.locator("[name=email]").fill("admin@test.local");
  await page.locator("[name=password]").fill("BrowserAdmin123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.locator(".account-link")).toBeVisible();
  const { csrf } = await (await page.request.get("/api/auth/session")).json();
  const response = await page.request.post("/api/notices", {
    headers: { Origin: "http://127.0.0.1:3101", "X-CSRF-Token": csrf },
    data: { title: "日志导出一致性", content: "独立测试公告" },
  });
  expect(response.status()).toBe(200);
  const { id } = await response.json();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "操作日志", exact: true })
    .click();
  const card = page.locator(".card").filter({
    has: page.getByRole("heading", { name: "操作日志", exact: true }),
  });
  await expect(card.locator("tbody")).toContainText(id);
  return {
    card,
    id,
    query: page.getByLabel("搜索操作日志"),
    exportButton: page.getByRole("button", { name: "导出本页", exact: true }),
  };
}

function gate() {
  let release, received;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const hit = new Promise((resolve) => {
    received = resolve;
  });
  return { release, received, held, hit };
}

test("日志筛选读取中和失败后不能导出旧记录，重试后CSV匹配当前筛选", async ({
  page,
}) => {
  const { card, id, query, exportButton } = await setup(page);
  const delayed = gate();
  try {
    await page.route("**/api/audit?**", async (route) => {
      if (new URL(route.request().url()).searchParams.get("q") !== id)
        return route.continue();
      delayed.received();
      await delayed.held;
      await route.fulfill({ status: 503, json: { error: "日志读取暂时失败" } });
    });
    await query.fill(id);
    await delayed.hit;
    await expect(exportButton).toBeDisabled();
    await expect(card.locator("tbody tr")).toHaveCount(0);
    delayed.release();
    await expect(card.getByRole("alert")).toContainText("日志读取暂时失败");
    await expect(exportButton).toBeDisabled();
    await expect(card.locator("tbody tr")).toHaveCount(0);
    await page.unroute("**/api/audit?**");
    await card.getByRole("button", { name: "刷新日志", exact: true }).click();
    await expect(card.locator("tbody tr")).toHaveCount(1);
    await expect(card.locator("tbody")).toContainText(id);
    await expect(exportButton).toBeEnabled();
    const download = page.waitForEvent("download");
    await exportButton.click();
    const csv = await readFile(await (await download).path(), "utf8");
    expect(csv).toContain(id);
    expect(csv).toContain("保存公告");
    expect(csv).not.toContain("账号登录");
    expect(csv.trim().split("\r\n")).toHaveLength(2);
  } finally {
    delayed.release();
  }
});

test("旧日志查询的迟到失败不覆盖新查询，日期倒置时不展示或导出旧结果", async ({
  page,
}) => {
  const { card, id, query, exportButton } = await setup(page);
  const delayed = gate();
  try {
    await page.route("**/api/audit?**", async (route) => {
      if (
        new URL(route.request().url()).searchParams.get("q") !== "account.login"
      )
        return route.continue();
      delayed.received();
      await delayed.held;
      await route.fulfill({
        status: 503,
        json: { error: "不应覆盖新查询的旧错误" },
      });
    });
    await query.fill("account.login");
    await delayed.hit;
    await query.fill(id);
    await expect(card.locator("tbody tr")).toHaveCount(1);
    await expect(card.locator("tbody")).toContainText(id);
    const lateResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/audit" &&
        new URL(response.url()).searchParams.get("q") === "account.login",
    );
    delayed.release();
    await (await lateResponse).finished();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await expect(card.getByRole("alert")).toHaveCount(0);
    await expect(exportButton).toBeEnabled();
    await page.getByLabel("日志起始日期").fill("2030-05-02");
    await page.getByLabel("日志结束日期").fill("2030-05-01");
    await expect(card.getByRole("alert")).toContainText("日志日期范围无效");
    await expect(exportButton).toBeDisabled();
    await expect(card.locator("tbody tr")).toHaveCount(0);
  } finally {
    delayed.release();
  }
});
