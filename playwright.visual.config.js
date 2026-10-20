import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/visual",
  testMatch: "**/*.visual.js",
  workers: 1,
  outputDir: `tmp/visual-results-${process.platform}`,
  snapshotPathTemplate:
    "{testDir}/snapshots/{platform}/{projectName}/{arg}{ext}",
  use: {
    baseURL: "http://127.0.0.1:3102",
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    headless: true,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    colorScheme: "light",
    trace: "retain-on-failure",
  },
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.005,
    },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: { viewport: { width: 390, height: 844 }, isMobile: true },
    },
  ],
  webServer: {
    command: "node tests/start-visual.mjs",
    url: "http://127.0.0.1:3102/api/health",
    reuseExistingServer: false,
  },
});
