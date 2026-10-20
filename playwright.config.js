import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.js",
  use: {
    baseURL: "http://127.0.0.1:3101",
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    headless: true,
  },
  webServer: {
    command: "node tests/start-server.mjs",
    url: "http://127.0.0.1:3101/api/health",
    reuseExistingServer: false,
  },
});
