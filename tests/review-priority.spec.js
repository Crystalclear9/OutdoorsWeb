import { test, expect } from "./browser-fixtures.js";

const IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=";
async function login(page, admin = false) {
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册", exact: true }).click();
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
test("临近审批可按开始日期排序并调阈值，筛选失败暂停旧单审批，恢复只处理当前队列", async ({
  page,
  browser,
  extraHTTPHeaders,
}) => {
  const context = await browser.newContext({ extraHTTPHeaders });
  try {
    const owner = await context.newPage();
    await login(owner);
    const { csrf } = await (
      await owner.request.get("/api/auth/session")
    ).json();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const prefix = "审批临期队列企业-",
      ids = {};
    // Deliberately submit the most distant start first, so created order and
    // start order disagree. All records go through the real submission API.
    for (const offset of [5, 2, 0]) {
      const date = new Date(Date.parse(today) + offset * 86400000)
        .toISOString()
        .slice(0, 10);
      const made = await owner.request.post("/api/bookings", {
        headers: {
          Origin: owner.url().replace(/\/$/, ""),
          "X-CSRF-Token": csrf,
        },
        data: {
          company: prefix + offset,
          contact: "联系人",
          phone: "13800138000",
          builder_contact: "搭建方",
          builder_phone: "13900139000",
          start: date,
          end: date,
          image: IMAGE,
        },
      });
      expect(made.status()).toBe(201);
      ids[offset] = (await made.json()).id;
    }
    await login(page, true);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "企业申报审核", exact: true })
      .click();
    await page.getByLabel("搜索待办申请").fill(prefix);
    const queue = page.getByRole("region", { name: "待办队列" }),
      detail = page.getByRole("region", { name: "申请审阅区" });
    await expect(queue.locator(".review-queue-item strong")).toHaveText([
      prefix + 0,
      prefix + 2,
      prefix + 5,
    ]);
    await expect(page.getByLabel("待办排序")).toHaveValue("start");
    await expect(queue).toContainText("今日开始 · 优先处理");
    await page.getByLabel("审批提醒范围").selectOption("upcoming");
    await expect(queue.locator(".review-queue-item strong")).toHaveText([
      prefix + 0,
      prefix + 2,
    ]);
    await page.getByText(/调整提醒阈值/).click();
    await page.getByLabel("临近开始提前天数").selectOption("0");
    await expect(queue.locator(".review-queue-item strong")).toHaveText([
      prefix + 0,
    ]);
    await page
      .getByRole("checkbox", { name: "选择本页全部申请", exact: true })
      .check();
    const failure = async (route) =>
      route.fulfill({ status: 503, json: { error: "模拟临期筛选读取失败" } });
    await page.route("**/api/bookings?**", failure);
    await page.getByLabel("临近开始提前天数").selectOption("7");
    await expect(page.getByRole("alert")).toContainText("模拟临期筛选读取失败");
    await expect(detail).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "批量通过", exact: true }),
    ).toBeDisabled();
    await expect(queue.locator(".review-queue-item")).toHaveCount(0);
    await expect(page.getByLabel("审批队列提醒")).toContainText(
      "待队列同步后确认",
    );
    await page.unroute("**/api/bookings?**", failure);
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(queue.locator(".review-queue-item strong")).toHaveText([
      prefix + 0,
      prefix + 2,
      prefix + 5,
    ]);
    await expect(
      page.getByRole("button", { name: "批量通过", exact: true }),
    ).toBeDisabled();
    await page.getByLabel("审批提醒范围").selectOption("overdue");
    await expect(
      queue.getByRole("heading", { name: "暂无待办申请", exact: true }),
    ).toBeVisible();
    await page.getByLabel("审批提醒范围").selectOption("attention");
    await expect(queue.locator(".review-queue-item strong")).toHaveText([
      prefix + 0,
      prefix + 2,
      prefix + 5,
    ]);
    await expect(detail.locator("img")).toBeVisible();
    await detail
      .getByRole("button", { name: "通过并审阅下一条", exact: true })
      .click();
    await expect(queue.locator(".review-queue-item strong")).toHaveText([
      prefix + 2,
      prefix + 5,
    ]);
    expect(
      (await (await owner.request.get(`/api/bookings/${ids[0]}`)).json())
        .booking.status,
    ).toBe("已通过");
    expect(
      (await (await owner.request.get(`/api/bookings/${ids[2]}`)).json())
        .booking.status,
    ).toBe("待审核");
  } finally {
    await context.close();
  }
});
