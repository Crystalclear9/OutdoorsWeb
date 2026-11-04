import { test, expect } from "./browser-fixtures.js";

async function login(page, admin = false) {
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await page
    .locator("[name=email]")
    .fill(admin ? "admin@test.local" : "completion@test.local");
  await page
    .locator("[name=password]")
    .fill(admin ? "BrowserAdmin123!" : "CompletionAccount123!");
  await page.getByLabel("图片验证码", { exact: true }).fill("246789");
  await page.getByRole("button", { name: "登录账号", exact: true }).click();
  await expect(page.locator(".account-link")).toBeVisible();
}

async function hold(page, pattern, response) {
  let release, received;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const hit = new Promise((resolve) => {
    received = resolve;
  });
  await page.route(pattern, async (route) => {
    const result = response || { response: await route.fetch() };
    received();
    await held;
    await route.fulfill(result);
  });
  return { release, hit };
}

test("详情撤回等待中不能关闭或丢失目标，真实完成后更新对应申请", async ({
  page,
}) => {
  await login(page);
  const session = await (await page.request.get("/api/auth/session")).json();
  const day = new Date(Date.now() + 319 * 86400000).toISOString().slice(0, 10);
  const made = await page.request.post("/api/bookings", {
    headers: { Origin: "http://127.0.0.1:3101", "X-CSRF-Token": session.csrf },
    data: {
      company: "详情互斥检查企业",
      contact: "李老师",
      phone: "13800138000",
      builder_contact: "搭建李师傅",
      builder_phone: "13900139000",
      start: day,
      end: day,
      image:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=",
    },
  });
  expect(made.status()).toBe(201);
  const { id } = await made.json();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的申请", exact: true })
    .click();
  const row = page.getByRole("row").filter({ hasText: id });
  await row.getByRole("button", { name: "查看详情" }).click();
  const pending = await hold(page, `**/api/bookings/${id}/withdraw`);
  const dialog = page.getByRole("dialog");
  try {
    await dialog.getByRole("button", { name: "撤回申请", exact: true }).click();
    await pending.hit;
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("关闭", { exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "关闭", exact: true }).last(),
    ).toBeDisabled();
  } finally {
    pending.release();
  }
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText("已撤回");
});

test("改期等待期间不能返回或关闭，失败后保留输入并解锁", async ({
  page,
  browser,
  extraHTTPHeaders,
}) => {
  await login(page);
  const session = await (await page.request.get("/api/auth/session")).json();
  const day = new Date(Date.now() + 317 * 86400000).toISOString().slice(0, 10);
  const next = new Date(Date.now() + 318 * 86400000).toISOString().slice(0, 10);
  const made = await page.request.post("/api/bookings", {
    headers: { Origin: "http://127.0.0.1:3101", "X-CSRF-Token": session.csrf },
    data: {
      company: "改期等待复核企业",
      contact: "李老师",
      phone: "13800138000",
      builder_contact: "搭建李师傅",
      builder_phone: "13900139000",
      start: day,
      end: day,
      image:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=",
    },
  });
  expect(made.status()).toBe(201);
  const { id } = await made.json();
  const managerContext = await browser.newContext({ extraHTTPHeaders });
  try {
    const manager = await managerContext.newPage();
    await login(manager, true);
    const managerSession = await (
      await manager.request.get("/api/auth/session")
    ).json();
    const approval = await manager.request.post(`/api/bookings/${id}/review`, {
      headers: {
        Origin: "http://127.0.0.1:3101",
        "X-CSRF-Token": managerSession.csrf,
        "If-Match": '"1"',
      },
      data: { status: "已通过" },
    });
    expect(approval.status()).toBe(200);
  } finally {
    await managerContext.close();
  }
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的申请", exact: true })
    .click();
  await page
    .getByRole("row")
    .filter({ hasText: id })
    .getByRole("button", { name: "查看详情" })
    .click();
  await page.getByRole("button", { name: "申请改期", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("[name=start]").fill(next);
  await dialog.locator("[name=end]").fill(next);
  const pending = await hold(page, `**/api/bookings/${id}/reschedule`, {
    status: 503,
    json: { error: "改期服务暂时不可用" },
  });
  try {
    await dialog.getByRole("button", { name: "提交改期申请" }).click();
    await pending.hit;
    await expect(
      dialog.getByRole("button", { name: "返回详情", exact: true }),
    ).toBeDisabled();
    await expect(dialog.locator("[name=start]")).toBeDisabled();
    await expect(dialog.locator("[name=builder_contact]")).toBeDisabled();
    await expect(dialog.locator("[name=builder_phone]")).toBeDisabled();
    await expect(dialog.locator("[name=slot]")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await dialog.getByLabel("关闭", { exact: true }).click();
    await expect(
      dialog.getByRole("heading", { name: "申请改期", exact: true }),
    ).toBeVisible();
  } finally {
    pending.release();
  }
  await expect(dialog.getByRole("alert")).toContainText("改期服务暂时不可用");
  await expect(dialog.locator("[name=start]")).toHaveValue(next);
  await expect(
    dialog.getByRole("button", { name: "返回详情", exact: true }),
  ).toBeEnabled();
});

test("公告发布中锁定草稿，失败后保留标题正文并可继续编辑", async ({ page }) => {
  await login(page, true);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "通知公告", exact: true })
    .click();
  const form = page.getByRole("form", { name: "快捷公告投递" });
  const existingTitle = `公告导航种子-${Date.now()}`;
  await form.locator("[name=title]").fill(existingTitle);
  await form.locator("[name=content]").fill("用于核对保存期间的公告管理门禁。");
  await form.getByRole("button", { name: "发布公告", exact: true }).click();
  await expect(
    page.locator("article").filter({ hasText: existingTitle }),
  ).toBeVisible();
  await form.locator("[name=title]").fill("待保留的公告标题");
  await form.locator("[name=content]").fill("网络等待期间不得丢失这份草稿。");
  const pending = await hold(page, "**/api/notices", {
    status: 503,
    json: { error: "发布服务暂时不可用" },
  });
  try {
    await form.getByRole("button", { name: "发布公告", exact: true }).click();
    await pending.hit;
    await expect(form.locator("[name=title]")).toBeDisabled();
    await expect(form.locator("[name=content]")).toBeDisabled();
    await expect(form.locator("[name=pinned]")).toBeDisabled();
    const navigation = page.getByRole("navigation").getByRole("button", {
      name: "服务工作台",
      exact: true,
    });
    await expect(navigation).toBeDisabled();
    await expect(page.locator(".account-link")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "退出登录", exact: true }),
    ).toBeDisabled();
    // aria-disabled anchors still need a synchronous navigation guard.
    await page.locator(".brand-link").click({ force: true });
    await expect(form).toBeVisible();
    await expect(page.locator(".toast")).toContainText("公告正在保存");
    await expect(
      page.getByRole("button", { name: "编辑", exact: true }).first(),
    ).toBeDisabled();
  } finally {
    pending.release();
  }
  await expect(form.getByRole("alert")).toContainText("发布服务暂时不可用");
  await expect(form.locator("[name=title]")).toHaveValue("待保留的公告标题");
  await expect(form.locator("[name=content]")).toHaveValue(
    "网络等待期间不得丢失这份草稿。",
  );
  await expect(form.locator("[name=content]")).toBeEnabled();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "服务工作台", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".account-link")).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "退出登录", exact: true }),
  ).toBeEnabled();
});

test("公告保存遇到真实会话撤销时解除导航门禁，重新登录后不保留旧保存状态", async ({
  page,
  browser,
  extraHTTPHeaders,
}) => {
  await login(page, true);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "通知公告", exact: true })
    .click();
  const form = page.getByRole("form", { name: "快捷公告投递", exact: true });
  await form.locator("[name=title]").fill("失效会话不应发布");
  await form.locator("[name=content]").fill("请在重新登录后核对并发布。");
  const originalSessions = await (
    await page.request.get("/api/auth/sessions")
  ).json();
  const originalSessionId = originalSessions.items.find(
    (item) => item.current,
  ).id;
  let entered, release;
  const hit = new Promise((resolve) => (entered = resolve)),
    held = new Promise((resolve) => (release = resolve));
  await page.route("**/api/notices", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    entered();
    await held;
    await route.continue();
  });
  const device = await browser.newContext({ extraHTTPHeaders });
  try {
    await form.getByRole("button", { name: "发布公告", exact: true }).click();
    await hit;
    await expect(page.locator(".account-link")).toBeDisabled();
    const peer = await device.newPage();
    await login(peer, true);
    const session = await (await peer.request.get("/api/auth/session")).json();
    const sessions = await (
      await peer.request.get("/api/auth/sessions")
    ).json();
    const other = sessions.items.find((s) => s.id === originalSessionId);
    expect(other).toBeTruthy();
    const revoked = await peer.request.delete(
      `/api/auth/sessions/${other.id}`,
      {
        headers: {
          Origin: "http://127.0.0.1:3101",
          "X-CSRF-Token": session.csrf,
        },
      },
    );
    expect(revoked.status()).toBe(200);
    release();
    await expect(
      page.getByRole("button", { name: "登录 / 注册", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation")
        .getByRole("button", { name: "服务工作台", exact: true }),
    ).toBeEnabled();
    await page.unrouteAll({ behavior: "wait" });
    await login(page, true);
    await expect(page.locator(".account-link")).toBeEnabled();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "通知公告", exact: true })
      .click();
    await expect(
      page.getByRole("form", { name: "快捷公告投递" }).locator("[name=title]"),
    ).toHaveValue("");
    expect((await page.request.get("/api/notices")).ok()).toBeTruthy();
    await expect(
      page.locator("article").filter({ hasText: "失效会话不应发布" }),
    ).toHaveCount(0);
  } finally {
    release?.();
    await page.unrouteAll({ behavior: "wait" });
    await device.close();
  }
});
