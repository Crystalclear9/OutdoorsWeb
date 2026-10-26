import { createApp } from "../server/app.mjs";
import { listenHttp } from "../server/tests/http-listen.mjs";
import { test, expect } from "./browser-fixtures.js";

test.use({ timezoneId: "America/Los_Angeles" });

test("公告列表及阅读详情在北京时间午夜前后保持相同日期，不受浏览器时区影响", async ({
  page,
}) => {
  const app = await createApp({
    dbPath: ":memory:",
    admin: { email: "notice-date@test.local", password: "NoticeDateCheck123!" },
    maintenance: { scheduled: false },
  });
  try {
    const author = app.db
      .prepare("SELECT id FROM users WHERE is_super=1")
      .get().id;
    const notices = [
      [
        "notice-before-midnight",
        "午夜前公告",
        "2035-03-10T15:59:00.000Z",
        "2035-03-10",
        "2035/03/10",
      ],
      [
        "notice-after-midnight",
        "午夜后公告",
        "2035-03-10T16:01:00.000Z",
        "2035-03-11",
        "2035/03/11",
      ],
    ];
    for (const [id, title, created] of notices)
      app.db
        .prepare(
          "INSERT INTO notices(id,title,content,created,updated,author) VALUES(?,?,?,?,?,?)",
        )
        .run(id, title, "北京时间发布说明", created, created, author);
    await listenHttp(app.server);
    await page.goto(`http://127.0.0.1:${app.server.address().port}`);
    for (const [, title, , date] of notices)
      await expect(
        page
          .locator(".dashboard-notices button")
          .filter({ hasText: title })
          .locator("small"),
      ).toHaveText(date);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "通知公告", exact: true })
      .click();
    for (const [, title, created, date, formatted] of notices) {
      const article = page.locator("article").filter({ hasText: title });
      await expect(article.locator("time")).toHaveText(date);
      await expect(article.locator("time")).toHaveAttribute(
        "datetime",
        created,
      );
      await expect(article.locator("small")).toContainText(formatted);
      await article.getByRole("button", { name: title, exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText(formatted);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "关闭", exact: true })
        .click();
    }
  } finally {
    await app.close();
  }
});
