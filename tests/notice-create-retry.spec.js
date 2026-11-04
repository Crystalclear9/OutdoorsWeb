import { randomUUID } from "node:crypto";
import { test, expect } from "./browser-fixtures.js";

async function composer(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册", exact: true }).click();
  await page.locator("[name=email]").fill("admin@test.local");
  await page.locator("[name=password]").fill("BrowserAdmin123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "通知公告", exact: true })
    .click();
  return page.getByRole("form", { name: "快捷公告投递" });
}
async function rows(page, title) {
  return (await (await page.request.get("/api/notices")).json()).items.filter(
    (r) => r.title === title,
  );
}

test("公告后端已发布但响应丢失，普通重试只有一条；确认成功后再次主动发布允许相同内容", async ({
  page,
}) => {
  const form = await composer(page),
    title = `公告响应丢失-${randomUUID()}`;
  await form.getByLabel("公告标题").fill(title);
  await form.getByLabel("公告正文").fill("普通公告发布重试正文");
  const keys = [];
  let lose = true;
  await page.route("**/api/notices", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]);
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (lose) {
      lose = false;
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  await form.getByRole("button", { name: "发布公告", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("无法连接");
  expect(await rows(page, title)).toHaveLength(1);
  await expect(form.getByLabel("公告标题")).toHaveValue(title);
  await form.getByRole("button", { name: "发布公告", exact: true }).click();
  await expect(form.getByLabel("公告标题")).toHaveValue("");
  expect(await rows(page, title)).toHaveLength(1);
  expect(keys[0]).toMatch(/^[\w-]{16,128}$/);
  expect(keys[1]).toBe(keys[0]);
  await form.getByLabel("公告标题").fill(title);
  await form.getByLabel("公告正文").fill("普通公告发布重试正文");
  await form.getByRole("button", { name: "发布公告", exact: true }).click();
  await expect(form.getByLabel("公告标题")).toHaveValue("");
  expect(await rows(page, title)).toHaveLength(2);
  expect(keys[2]).not.toBe(keys[0]);
});

test("公告未知结果后改变正文属于新创建意图，不复用旧键或覆盖已发布公告", async ({
  page,
}) => {
  const form = await composer(page),
    title = `公告改变输入-${randomUUID()}`;
  await form.getByLabel("公告标题").fill(title);
  await form.getByLabel("公告正文").fill("初始正文");
  const keys = [];
  let lose = true;
  await page.route("**/api/notices", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]);
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (lose) {
      lose = false;
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  await form.getByRole("button", { name: "发布公告", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("无法连接");
  await form.getByLabel("公告正文").fill("主动改变后的新正文");
  await form.getByRole("button", { name: "发布公告", exact: true }).click();
  await expect(form.getByLabel("公告标题")).toHaveValue("");
  const notices = await rows(page, title);
  expect(notices).toHaveLength(2);
  expect(notices.map((r) => r.content).sort()).toEqual(
    ["主动改变后的新正文", "初始正文"].sort(),
  );
  expect(keys[0]).toMatch(/^[\w-]{16,128}$/);
  expect(keys[1]).not.toBe(keys[0]);
});
