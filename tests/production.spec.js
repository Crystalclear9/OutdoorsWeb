import { test, expect } from "@playwright/test";
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

test("GitHub Pages 子目录中的编译产物可加载、切换身份与打开申报", async ({
  page,
}) => {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("requestfailed", (request) => failures.push(request.url()));
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(response.url());
  });
  await page.goto(`${origin}/OutdoorsWeb/`);
  await expect(
    page.getByRole("heading", { name: "让每一次校园相遇，有序发生" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "发起布展申报" }).click();
  await expect(
    page.getByRole("dialog", { name: "企业布展申报" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "切换演示身份" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /管理员/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "预约管理工作台" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "预约管理工作台" }),
  ).toBeVisible();
  expect(failures).toEqual([]);
});
