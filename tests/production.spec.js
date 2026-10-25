import { test, expect } from "./browser-fixtures.js";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Serve the tracked files as GitHub Pages does, under the repository prefix.
let server;
let origin;
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (!pathname.startsWith("/OutdoorsWeb/")) {
      res.writeHead(404).end();
      return;
    }
    const relative =
      decodeURIComponent(pathname.slice("/OutdoorsWeb/".length)) ||
      "index.html";
    if (relative !== "index.html" && !/^assets\/[\w.-]+$/.test(relative)) {
      res.writeHead(404).end();
      return;
    }
    try {
      const content = await readFile(path.resolve(relative));
      res.setHeader(
        "Content-Type",
        relative.endsWith(".js")
          ? "text/javascript"
          : relative.endsWith(".css")
            ? "text/css"
            : relative.endsWith(".png")
              ? "image/png"
              : "text/html; charset=utf-8",
      );
      res.end(content);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("正常完整服务不接受演示参数或浏览器身份数据，仍须真实登录", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "outdoors-temporary-showcase-v1",
      JSON.stringify({ schema: 1, role: "super", users: [], bookings: [] }),
    ),
  );
  await page.goto("http://127.0.0.1:3101/?showcase=1&role=super");
  await expect(page.getByLabel("切换演示身份", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "登录 / 注册", exact: true }),
  ).toBeEnabled();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "授权管理", exact: true }),
  ).toHaveCount(0);
  expect(
    (await page.request.get("http://127.0.0.1:3101/api/users")).status(),
  ).toBe(401);
});

test("GitHub Pages 静态入口显示真实后端未连接状态，仍可打开登录页", async ({
  page,
}) => {
  await page.goto(`${origin}/OutdoorsWeb/`);
  await expect(page.getByRole("heading", { name: "服务工作台" })).toBeVisible();
  await expect(
    page.getByText("后端服务尚未连接", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "发起布展申请" }),
  ).toBeDisabled();
  const imageResponse = page.waitForResponse((r) =>
    r.url().includes("/assets/venue-plan-"),
  );
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "场地查询", exact: true })
    .click();
  expect((await imageResponse).status()).toBe(200);
  await expect(page.locator(".venue-svg image")).toBeVisible();
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await expect(
    page.getByRole("heading", { name: "登录您的账号" }),
  ).toBeVisible();
  await page.locator("[name=email]").fill("nobody@company.local");
  await page.locator("[name=password]").fill("NotConnected123");
  await expect(
    page.getByRole("button", { name: "登录账号", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("status")).toContainText(
    "验证码加载失败，请重试",
  );
});
