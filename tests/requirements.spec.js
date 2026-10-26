import { test, expect } from "./browser-fixtures.js";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";

test("使用指南提供可下载的入口二维码，过滤查询和片段，窄屏可读并提示本机地址", async ({
  page,
}, info) => {
  await page.goto("/?preview=admin&token=private-example#private-fragment");
  await page
    .getByRole("button", { name: "打开使用指南", exact: true })
    .filter({ visible: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("公开入口地址")).toHaveValue(
    "http://127.0.0.1:3101/",
  );
  const image = dialog.getByRole("img", { name: "网站公开入口二维码" });
  await expect(image).toBeVisible();
  const data = await image.getAttribute("src");
  expect(data).toMatch(/^data:image\/png;base64,/);
  await writeFile(
    info.outputPath("public-entry-qr.png"),
    Buffer.from(data.split(",")[1], "base64"),
  );
  await expect(dialog.getByText(/当前是本机地址/)).toBeVisible();
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  const download = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "下载访问二维码" }).click();
  expect((await download).suggestedFilename()).toBe("场地访问二维码.png");
});

test("换图忽略迟到读取结果，非法文件清除旧图，实际提交使用最后选择的图片", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.FileReader;
    window.FileReader = class extends Native {
      readAsDataURL(file) {
        if (file.name === "old.png")
          this.addEventListener("loadend", () => {
            window.oldReadDone = true;
          });
        setTimeout(
          () => super.readAsDataURL(file),
          file.name === "old.png" ? 300 : 10,
        );
      }
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page.locator("[name=email]").fill("completion@test.local");
  await page.locator("[name=password]").fill("CompletionAccount123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.locator(".account-link")).toBeVisible();
  await page.getByRole("button", { name: "发起布展申请", exact: true }).click();
  const dialog = page.getByRole("dialog"),
    input = dialog.getByLabel("上传桁架设计图");
  const old = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  const latest = await sharp({
    create: { width: 3, height: 2, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  await input.setInputFiles({
    name: "old.png",
    mimeType: "image/png",
    buffer: old,
  });
  await expect(
    dialog.getByRole("button", { name: "提交申请", exact: true }),
  ).toBeDisabled();
  await input.setInputFiles({
    name: "new.png",
    mimeType: "image/png",
    buffer: latest,
  });
  await expect.poll(() => page.evaluate(() => window.oldReadDone)).toBe(true);
  await expect(dialog.getByText("new.png", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("img", { name: "待提交桁架设计图" }),
  ).toHaveAttribute(
    "src",
    `data:image/png;base64,${latest.toString("base64")}`,
  );
  await input.setInputFiles({
    name: "invalid.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("invalid"),
  });
  await expect(
    dialog.getByRole("img", { name: "待提交桁架设计图" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "提交申请", exact: true }),
  ).toBeDisabled();
  await input.setInputFiles({
    name: "new.png",
    mimeType: "image/png",
    buffer: latest,
  });
  await expect(dialog.getByText("new.png", { exact: true })).toBeVisible();
  await dialog.getByLabel("搭建方联系人", { exact: true }).fill("搭建刘师傅");
  await dialog
    .getByLabel("搭建方联系电话", { exact: true })
    .fill("13900139000");
  await dialog.getByRole("checkbox").check();
  const request = page.waitForRequest(
    (r) => r.url().endsWith("/api/bookings") && r.method() === "POST",
  );
  await dialog.getByRole("button", { name: "提交申请", exact: true }).click();
  expect((await request).postDataJSON().image).toBe(
    `data:image/png;base64,${latest.toString("base64")}`,
  );
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("row").filter({ hasText: "待审核" }).first(),
  ).toBeVisible();
});
