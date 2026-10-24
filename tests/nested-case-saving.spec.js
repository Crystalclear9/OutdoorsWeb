import { test, expect } from "./browser-fixtures.js";

const IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=";
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
async function headers(page) {
  const { csrf } = await (await page.request.get("/api/auth/session")).json();
  return { Origin: "http://127.0.0.1:3101", "X-CSRF-Token": csrf };
}
async function makeApproved(owner, manager, offset) {
  const day = new Date(Date.now() + offset * 86400000)
    .toISOString()
    .slice(0, 10);
  const made = await owner.request.post("/api/bookings", {
    headers: await headers(owner),
    data: {
      company: "内嵌办理保存互斥企业",
      contact: "李老师",
      phone: "13800138000",
      slot: 25,
      start: day,
      end: day,
      image: IMAGE,
    },
  });
  expect(made.status()).toBe(201);
  const { id } = await made.json();
  expect(
    (
      await manager.request.post(`/api/bookings/${id}/review`, {
        headers: { ...(await headers(manager)), "If-Match": '"1"' },
        data: { status: "已通过" },
      })
    ).status(),
  ).toBe(200);
  return id;
}
async function openDetail(page, id, admin = false) {
  await page
    .getByRole("navigation")
    .getByRole("button", {
      name: admin ? "企业申报审核" : "我的申请",
      exact: true,
    })
    .click();
  if (admin)
    await page
      .getByRole("button", { name: "全部申请与历史", exact: true })
      .click();
  await page.getByLabel("搜索申请", { exact: true }).fill(id);
  await page
    .getByRole("row")
    .filter({ hasText: id })
    .getByRole("button", { name: "查看详情" })
    .click();
  return page.getByRole("dialog");
}
async function hold(page, pattern, failed = false) {
  let release, received;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const hit = new Promise((resolve) => {
    received = resolve;
  });
  await page.route(pattern, async (route) => {
    const response = failed
      ? { status: 503, json: { error: "模拟付款流水保存失败" } }
      : { response: await route.fetch() };
    received();
    await gate;
    await route.fulfill(response);
  });
  return { release, hit };
}

test("详情付款流水保存中禁止关闭和改期，失败后保留草稿并可重试", async ({
  page,
  browser,
  extraHTTPHeaders,
}) => {
  const managerContext = await browser.newContext({ extraHTTPHeaders });
  let deferred;
  try {
    const manager = await managerContext.newPage();
    await login(page);
    await login(manager, true);
    const id = await makeApproved(page, manager, 289);
    expect(
      (
        await manager.request.post(`/api/casework/${id}/fee`, {
          headers: await headers(manager),
          data: {
            action: "issue",
            amountFen: 1234,
            instructions: "单位收款窗口",
            note: "已批准收费依据",
          },
        })
      ).status(),
    ).toBe(200);
    const dialog = await openDetail(page, id);
    const input = dialog.getByLabel("线下付款时间及流水号");
    await input.fill("2026-10-24 BANK-NESTED-1234");
    deferred = await hold(page, `**/api/casework/${id}/fee`, true);
    await dialog
      .getByRole("button", { name: "提交付款流水", exact: true })
      .click();
    await deferred.hit;
    await expect(
      dialog.getByRole("button", { name: "申请改期 / 换位", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "取消已通过预约", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "关闭", exact: true }).last(),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("关闭", { exact: true }).click();
    await expect(dialog).toBeVisible();
    deferred.release();
    await expect(dialog.getByRole("alert")).toContainText(
      "模拟付款流水保存失败",
    );
    await expect(input).toHaveValue("2026-10-24 BANK-NESTED-1234");
    await expect(
      dialog.getByRole("button", { name: "关闭", exact: true }).last(),
    ).toBeEnabled();
    await page.unroute(`**/api/casework/${id}/fee`);
    await dialog
      .getByRole("button", { name: "提交付款流水", exact: true })
      .click();
    await expect(
      dialog.getByRole("region", { name: "当前办理与下一步" }),
    ).toContainText("等待财务核实到账");
    expect(
      (await (await page.request.get(`/api/casework/${id}`)).json()).item.fee
        .state,
    ).toBe("submitted");
  } finally {
    deferred?.release();
    await managerContext.close();
  }
});

test("详情电话登记保存中禁止收起和关闭，真实完成后恢复操作", async ({
  page,
  browser,
  extraHTTPHeaders,
}) => {
  const ownerContext = await browser.newContext({ extraHTTPHeaders });
  let deferred;
  try {
    const owner = await ownerContext.newPage();
    await login(owner);
    await login(page, true);
    const id = await makeApproved(owner, page, 290);
    const dialog = await openDetail(page, id, true);
    const summary = dialog.getByText("查看办理时限、电话跟进与费用记录", {
      exact: true,
    });
    await summary.click();
    const panel = dialog.getByRole("region", { name: "办理与缴费记录" });
    await panel.getByLabel("结果电话状态").selectOption("reached");
    await panel.getByLabel("联系核对说明").fill("真实电话已接通并告知结果");
    deferred = await hold(page, `**/api/casework/${id}/contact`);
    await panel
      .getByRole("button", { name: "保存电话跟进", exact: true })
      .click();
    await deferred.hit;
    await expect(
      dialog.getByRole("button", { name: "取消已通过预约", exact: true }),
    ).toBeDisabled();
    await summary.click();
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await dialog.getByLabel("关闭", { exact: true }).click();
    await expect(dialog).toBeVisible();
    deferred.release();
    await expect(panel).toContainText("已登记电话告知");
    await expect(
      dialog.getByRole("button", { name: "关闭", exact: true }).last(),
    ).toBeEnabled();
    await summary.click();
    await expect(panel).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "关闭", exact: true })
      .last()
      .click();
    await expect(dialog).toHaveCount(0);
    expect(
      (await (await page.request.get(`/api/casework/${id}`)).json()).item
        .contactResult.state,
    ).toBe("reached");
  } finally {
    deferred?.release();
    await ownerContext.close();
  }
});
