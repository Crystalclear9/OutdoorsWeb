import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createApp } from "../server/app.mjs";
import { listenHttp } from "../server/tests/http-listen.mjs";
import { test, expect } from "./browser-fixtures.js";

test("审计归档初次及翻页读取失败可原位恢复，不保留旧下载，恢复后下载真实归档", async ({
  page,
}) => {
  const app = await createApp({
    dbPath: ":memory:",
    admin: { email: "archive-root@test.local", password: "ArchiveRoot123!" },
    captchaTestAnswer: "246789",
    maintenance: { scheduled: false },
  });
  try {
    for (let i = 1; i <= 21; i++) {
      const content = Buffer.from(
        JSON.stringify({ action: "archive-fixture", index: i }) + "\n",
      );
      app.db
        .prepare("INSERT INTO archives VALUES(?,?,?,?,?,?,?,?)")
        .run(
          `fixture-${i}`,
          "audit",
          `2025-01-${String(i).padStart(2, "0")}T00:00:00.000Z`,
          "2024-12-01T00:00:00.000Z",
          1,
          content.length,
          createHash("sha256").update(content).digest("hex"),
          gzipSync(content),
        );
    }
    await listenHttp(app.server);
    await page.goto(`http://127.0.0.1:${app.server.address().port}`);
    await page
      .getByRole("button", { name: "登录 / 注册", exact: true })
      .click();
    await page.locator("[name=email]").fill("archive-root@test.local");
    await page.locator("[name=password]").fill("ArchiveRoot123!");
    await page.getByLabel("图片验证码", { exact: true }).fill("246789");
    await page.getByRole("button", { name: "登录账号", exact: true }).click();
    await expect(page.locator(".account-link")).toBeVisible();
    let unavailable = true;
    await page.route("**/api/archives?*", (route) =>
      unavailable
        ? route.fulfill({ status: 503, json: { error: "归档暂时无法读取" } })
        : route.continue(),
    );
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "操作日志", exact: true })
      .click();
    const card = page.locator(".archives-card");
    await expect(card.getByRole("alert")).toContainText("归档暂时无法读取");
    await expect(card.getByRole("link", { name: /下载 JSONL/ })).toHaveCount(0);
    unavailable = false;
    await card.getByRole("button", { name: "刷新归档", exact: true }).click();
    await expect(card.getByRole("link", { name: /下载 JSONL/ })).toHaveCount(
      20,
    );
    unavailable = true;
    await card.getByRole("button", { name: "下一页", exact: true }).click();
    await expect(card.getByRole("alert")).toContainText("归档暂时无法读取");
    await expect(card.getByRole("link", { name: /下载 JSONL/ })).toHaveCount(0);
    unavailable = false;
    await card.getByRole("button", { name: "刷新归档", exact: true }).click();
    const link = card.getByRole("link", { name: /下载 JSONL/ });
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", "/api/archives/fixture-1");
    await expect(card.locator(".pagination")).toContainText("第 2 / 2 页");
    const downloading = page.waitForEvent("download");
    await link.click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("audit-fixture-1.jsonl");
    const chunks = [];
    for await (const chunk of await download.createReadStream())
      chunks.push(chunk);
    expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toEqual({
      action: "archive-fixture",
      index: 1,
    });
  } finally {
    await app.close();
  }
});
