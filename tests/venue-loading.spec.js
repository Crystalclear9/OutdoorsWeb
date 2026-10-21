import { test, expect } from "./browser-fixtures.js";

test("切换场地日期时隐藏旧占用，慢网和失败期间禁止申请，迟到响应不覆盖当前日", async ({
  page,
}) => {
  let releaseOld;
  const held = new Promise((resolve) => {
    releaseOld = resolve;
  });
  const result = (date, slot) => ({
    date,
    total: 29,
    actualPlaced: 1,
    onsite: [{ slot, present: true, updated: "2030-05-01T00:00:00Z" }],
    occupied: [],
    closed: [{ slot, reason: `暂停安排-${date}` }],
  });
  await page.route("**/api/venue?**", async (route) => {
    const date = new URL(route.request().url()).searchParams.get("date");
    if (date === "2030-05-10") await held;
    if (date === "2030-05-12") return route.abort("failed");
    await route.fulfill({ json: result(date, date === "2030-05-11" ? 2 : 1) });
  });
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "场地查询", exact: true })
    .click();
  const summary = page.locator(".venue-onsite-summary"),
    position = page.locator(".position-card");
  await expect(summary).toContainText("已摆放 1 / 29");
  await expect(position).toContainText("暂停安排-");
  await page.getByLabel("查询日期").fill("2030-05-10");
  await expect(summary).toContainText("2030-05-10 现场登记数据正在同步");
  await expect(position).not.toContainText("暂停安排-");
  await expect(position).toContainText("状态待同步");
  await expect(
    page.getByRole("button", { name: "发起布展申请", exact: true }),
  ).toBeDisabled();
  await expect(
    position.getByRole("button", { name: "登录后预约" }),
  ).toBeDisabled();
  await page.getByLabel("查询日期").fill("2030-05-11");
  await expect(summary).toContainText("2030-05-11 现场登记：已摆放 1 / 29");
  await expect(
    position.getByRole("button", { name: "登录后预约" }),
  ).toBeEnabled();
  const lateResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/venue" &&
      url.searchParams.get("date") === "2030-05-10"
    );
  });
  releaseOld();
  await (await lateResponse).finished();
  await expect(summary).toContainText("2030-05-11 现场登记：");
  await expect(position).not.toContainText("暂停安排-2030-05-10");
  await page.getByLabel("查询日期").fill("2030-05-12");
  await expect(summary).toHaveText("现场登记数据待同步。");
  await expect(
    position.getByRole("button", { name: "登录后预约" }),
  ).toBeDisabled();
  await expect(position).toContainText("状态待同步");
  await page.getByLabel("查询日期").fill("2030-05-13");
  await expect(summary).toContainText("2030-05-13 现场登记：");
  await expect(position).toContainText("暂停安排-2030-05-13");
});
