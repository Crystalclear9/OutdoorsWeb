import { test as base, expect } from "@playwright/test";
import { createHash } from "node:crypto";

// The isolated test server alone trusts its loopback proxy. Give each browser
// test its own client address so the growing suite does not exhaust a shared
// visitor's production rate limit; production limits remain unchanged.
export const test = base.extend({
  extraHTTPHeaders: async ({}, use, info) => {
    const bytes = createHash("sha256").update(info.testId).digest();
    await use({ "X-Forwarded-For": `10.${bytes[0]}.${bytes[1]}.${bytes[2]}` });
  },
});
export { expect };
