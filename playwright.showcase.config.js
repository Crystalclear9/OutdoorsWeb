import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/showcase",
  testMatch: "**/*.showcase.js",
  workers: 1,
  outputDir: "tmp/showcase-results",
  use: {
    baseURL: "http://127.0.0.1:3113/OutdoorsWeb/",
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node tests/start-showcase.mjs",
    url: "http://127.0.0.1:3113/OutdoorsWeb/",
    reuseExistingServer: false,
  },
});
