import { test, expect } from "./browser-fixtures.js";

test("真实服务安全策略允许页面字体完整加载，不产生内联字体拦截", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.fontPolicyViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      if (e.effectiveDirective === "font-src")
        window.fontPolicyViolations.push({
          uri: e.blockedURI,
          directive: e.effectiveDirective,
        });
    });
  });
  const failed = [];
  page.on("requestfailed", (request) => {
    if (/\.(woff2?|ttf|otf)(?:\?|$)/i.test(request.url()))
      failed.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册", exact: true }).click();
  await page
    .locator("[name=email]")
    .fill("font-contract-0123456789@company.local");
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => window.fontPolicyViolations)).toEqual([]);
  expect(failed).toEqual([]);
  expect(
    await page.evaluate(
      () => [...document.fonts].filter((f) => f.status === "loaded").length,
    ),
  ).toBeGreaterThan(0);
});
