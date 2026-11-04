import { test, expect } from "@playwright/test";
const storageKey = "outdoors-temporary-showcase-v1";
async function call(page, body, key) {
  return page.evaluate(
    async ({ body, key }) => {
      const resource = performance
        .getEntriesByType("resource")
        .find((r) =>
          /\/assets\/runtime-[^/]+\.js/.test(new URL(r.name).pathname),
        );
      if (!resource) throw new Error("Showcase runtime resource missing");
      const runtime = await import(resource.name);
      try {
        return {
          ok: true,
          data: await runtime.request("/notices", {
            method: "POST",
            headers: key ? { "Idempotency-Key": key } : {},
            body,
          }),
        };
      } catch (error) {
        return { ok: false, status: error.status, message: error.message };
      }
    },
    { body, key },
  );
}
test("演示公告创建同操作重试跨刷新仅一条一审计，旧样本兼容，主动新发布允许且不请求真实API", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.includes("/api/")) requests.push(r.url());
  });
  await page.goto("?showcase=1");
  await page
    .getByRole("group", { name: "切换演示身份" })
    .getByRole("button", { name: "管理员", exact: true })
    .click();
  await expect(page.locator(".account-link")).toContainText("系统管理员");
  await page.evaluate((key) => {
    const state = JSON.parse(sessionStorage.getItem(key));
    delete state.idempotency;
    sessionStorage.setItem(key, JSON.stringify(state));
  }, storageKey);
  await page.reload();
  await expect(page.locator(".account-link")).toContainText("系统管理员");
  const body = { title: "演示同意图重试", content: "正文", pinned: true },
    key = "showcase-notice-retry-1234";
  const first = await call(page, body, key);
  expect(first.ok).toBe(true);
  await page.reload();
  await expect(page.locator(".account-link")).toContainText("系统管理员");
  const replay = await call(page, body, key);
  expect(replay.data.id).toBe(first.data.id);
  const conflict = await call(page, { ...body, content: "变更" }, key);
  expect(conflict.status).toBe(409);
  const stored = () =>
    page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), storageKey);
  let state = await stored();
  expect(state.notices.filter((r) => r.title === body.title)).toHaveLength(1);
  expect(
    state.audit.filter(
      (r) => r.action === "notice.saved" && r.target === first.data.id,
    ),
  ).toHaveLength(1);
  const fresh = await call(page, body, "showcase-new-intent-12345");
  expect(fresh.data.id).not.toBe(first.data.id);
  await call(page, body);
  await call(page, body);
  state = await stored();
  expect(state.notices.filter((r) => r.title === body.title)).toHaveLength(4);
  expect(requests).toEqual([]);
});
