import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readdir,
  copyFile,
  writeFile,
  unlink,
} from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { openStore } from "../store.mjs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../app.mjs";
import { hashToken } from "../security.mjs";
import {
  client,
  fixture,
  manager,
  register,
  staff,
  booking,
  ADMIN,
  PASSWORD,
} from "./helpers.mjs";
import { clientAddress } from "../proxy.mjs";

test("验证码为 PNG、不返回明文答案、绑定浏览器、单次使用且检查过期", async (t) => {
  const { client: c, db } = await fixture(t),
    owner = c(),
    stranger = c();
  const challenge = (await owner.request("/auth/captcha")).data;
  assert.deepEqual(Object.keys(challenge).sort(), ["expires", "id", "image"]);
  const image = Buffer.from(challenge.image.split(",")[1], "base64");
  assert.equal(image.subarray(1, 4).toString(), "PNG");
  assert.notEqual(
    db.prepare("SELECT answer FROM captchas WHERE id=?").get(challenge.id)
      .answer,
    "246789",
  );
  const payload = { ...ADMIN, captchaId: challenge.id, captcha: "246789" };
  assert.equal(
    (await stranger.request("/auth/login", "POST", payload)).status,
    400,
  );
  assert.equal(
    (await owner.request("/auth/login", "POST", payload)).status,
    200,
  );
  assert.equal(
    (await owner.request("/auth/login", "POST", payload)).status,
    400,
  );
  const expired = (await owner.request("/auth/captcha")).data;
  db.prepare("UPDATE captchas SET expires=0 WHERE id=?").run(expired.id);
  assert.equal(
    (
      await owner.request("/auth/login", "POST", {
        ...ADMIN,
        captchaId: expired.id,
        captcha: "246789",
      })
    ).status,
    400,
  );
  const wrong = (await owner.request("/auth/captcha")).data;
  assert.equal(
    (
      await owner.request("/auth/login", "POST", {
        ...ADMIN,
        captchaId: wrong.id,
        captcha: "111111",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await owner.request("/auth/login", "POST", {
        ...ADMIN,
        captchaId: wrong.id,
        captcha: "246789",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await stranger.request("/auth/register", "POST", {
        email: "missing@test.local",
        password: PASSWORD,
        company: "验证码测试",
        contact: "张老师",
        phone: "13800138000",
        captchaId: null,
      })
    ).status,
    400,
  );
  assert.equal(
    db.prepare("SELECT id FROM users WHERE email=?").get("missing@test.local"),
    undefined,
  );
});

test("同一张验证码并发重放只有一个登录成功", async (t) => {
  const { client } = await fixture(t),
    c = client(),
    ch = (await c.request("/auth/captcha")).data;
  const payload = { ...ADMIN, captchaId: ch.id, captcha: "246789" };
  const results = await Promise.all([
    c.request("/auth/login", "POST", payload),
    c.request("/auth/login", "POST", payload),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
});

test("只信任配置中的代理，伪造转发头不能绕过来源识别", () => {
  const req = (peer, header) => ({
    socket: { remoteAddress: peer },
    headers: { "x-forwarded-for": header },
  });
  assert.equal(
    clientAddress(req("::ffff:127.0.0.1", "1.2.3.4"), []),
    "127.0.0.1",
  );
  assert.equal(
    clientAddress(req("127.0.0.1", "6.6.6.6, 203.0.113.8"), ["127.0.0.1"]),
    "203.0.113.8",
  );
  assert.equal(
    clientAddress(req("127.0.0.1", "6.6.6.6, 203.0.113.8"), [
      "127.0.0.1",
      "203.0.113.8",
    ]),
    "6.6.6.6",
  );
  assert.equal(
    clientAddress(req("127.0.0.1", "garbage"), ["127.0.0.1"]),
    "127.0.0.1",
  );
});

test("取消预约需要归属、权限和版本，释放位置并保留审计与私有通知", async (t) => {
  const { client, db } = await fixture(t),
    root = client(),
    c = client(),
    other = client(),
    limited = client();
  await manager(root);
  await register(c);
  assert.ok(
    (await root.request("/operations")).data.warnings.includes(
      "尚无自动备份成功记录",
    ),
  );
  await register(other, "other@test.local");
  await staff(root, limited, ["notices.manage"]);
  const id = (await c.request("/bookings", "POST", booking())).data.id;
  await root.request("/bookings/" + id + "/review", "POST", {
    status: "已通过",
  });
  const route = "/bookings/" + id + "/cancel",
    body = { reason: "活动取消" };
  assert.equal((await c.request(route, "POST", body)).status, 428);
  assert.equal(
    (await other.request(route, "POST", body, { "If-Match": '"2"' })).status,
    403,
  );
  assert.equal(
    (await limited.request(route, "POST", body, { "If-Match": '"2"' })).status,
    403,
  );
  assert.equal(
    (await c.request(route, "POST", body, { "If-Match": '"1"' })).status,
    409,
  );
  assert.equal(
    (await c.request(route, "POST", body, { "If-Match": '"2"' })).status,
    200,
  );
  assert.equal(
    (await c.request("/bookings/" + id)).data.booking.status,
    "已取消",
  );
  assert.equal((await c.request("/venue")).data.occupied.length, 0);
  assert.equal(
    (await c.request("/bookings?status=" + encodeURIComponent("已通过"))).data
      .total,
    0,
  );
  assert.equal(
    (await c.request("/bookings?status=" + encodeURIComponent("已取消"))).data
      .total,
    1,
  );
  assert.equal((await c.request("/summary")).data.counts["已取消"], 1);
  assert.throws(
    () => db.prepare("UPDATE bookings SET cancelled=0 WHERE id=?").run(id),
    /INVALID_BOOKING_STATE/,
  );
  const replacement = await other.request("/bookings", "POST", booking());
  assert.equal(replacement.status, 201);
  assert.equal(
    (
      await root.request(
        "/bookings/" + replacement.data.id + "/review",
        "POST",
        { status: "已通过" },
      )
    ).status,
    200,
  );
  const messages = (await c.request("/notifications")).data;
  assert.equal(messages.items.filter((n) => n.target === id).length, 2);
  assert.equal(
    (await other.request("/notifications")).data.items.some(
      (n) => n.target === id,
    ),
    false,
  );
  await other.request("/notifications/read", "POST", {
    id: messages.items[0].id,
  });
  assert.equal(
    (await c.request("/notifications")).data.unread,
    messages.unread,
  );
  await c.request("/notifications/read", "POST", {});
  assert.equal((await c.request("/notifications")).data.unread, 0);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit WHERE action='booking.cancelled'",
      )
      .get().n,
    1,
  );
});

test("后台备份可恢复账号与申请；清理临时数据不删除业务，失败可查", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "outdoor-maintenance-")),
    dbPath = path.join(dir, "app.sqlite");
  const app = await createApp({
    dbPath,
    admin: ADMIN,
    captchaTestAnswer: "246789",
    maintenance: { scheduled: false, keep: 2 },
  });
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${app.server.address().port}`,
    c = client(origin),
    root = client(origin);
  await manager(root);
  await register(c);
  const id = (await c.request("/bookings", "POST", booking())).data.id;
  app.db
    .prepare("INSERT INTO rate_limits(key,attempts,reset) VALUES('old',1,0)")
    .run();
  app.db
    .prepare(
      "INSERT INTO captchas(id,binding,answer,expires) VALUES('old','old','old',0)",
    )
    .run();
  app.db
    .prepare(
      "UPDATE bookings SET created='2020-01-01T00:00:00.000Z' WHERE id=?",
    )
    .run(id);
  const result = await app.maintenance.run(true);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.removed.rateLimits, 1);
  assert.ok(result.removed.captchas >= 1);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM bookings").get().n, 1);
  assert.equal(
    app.db
      .prepare(
        "SELECT COUNT(*) AS n FROM notifications WHERE title='超时待办提醒'",
      )
      .get().n,
    1,
  );
  assert.equal((await root.request("/operations")).data.pendingOver24, 1);
  assert.equal((await c.request("/operations")).status, 403);
  const backup = path.join(dir, "backups", result.backup.file),
    restore = path.join(dir, "restored.sqlite");
  await copyFile(backup, restore);
  assert.ok(path.resolve(backup).startsWith(path.resolve(dir) + path.sep));
  await unlink(backup);
  assert.ok(
    (await root.request("/operations")).data.warnings.some((w) =>
      w.includes("文件缺失"),
    ),
  );
  const repaired = await app.maintenance.run(false);
  assert.equal(repaired.ok, true);
  assert.notEqual(repaired.backup.file, result.backup.file);
  assert.equal(
    (await root.request("/operations")).data.warnings.some((w) =>
      w.includes("文件缺失"),
    ),
    false,
  );
  const restored = await createApp({
    dbPath: restore,
    admin: ADMIN,
    captchaTestAnswer: "246789",
    maintenance: { scheduled: false },
  });
  try {
    assert.equal(restored.db.prepare("SELECT id FROM bookings").get().id, id);
    assert.ok(
      restored.db.prepare("SELECT image FROM bookings").get().image.length,
    );
    assert.equal(
      restored.db.prepare("SELECT COUNT(*) AS n FROM users").get().n,
      2,
    );
  } finally {
    await restored.close();
  }
  await app.maintenance.run(true);
  await app.maintenance.run(true);
  assert.equal(
    (await readdir(path.join(dir, "backups"))).filter((n) =>
      n.endsWith(".sqlite"),
    ).length,
    2,
  );
  const blocker = path.join(dir, "blocked");
  await writeFile(blocker, "not a directory");
  const { createMaintenance } = await import("../maintenance.mjs");
  const failed = createMaintenance(app.db, dbPath, {
    scheduled: false,
    backupDir: blocker,
  });
  assert.equal((await failed.run(true)).ok, false);
  assert.ok(failed.status().warnings.some((s) => s.includes("失败")));
  assert.equal((await c.request("/health")).status, 200);
  app.db.exec("DROP TABLE health_probe");
  assert.equal((await c.request("/health")).status, 503);
});

test("高版本数据库拒绝启动前不修改结构或版本", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "outdoor-future-schema-")),
    file = path.join(dir, "future.sqlite");
  t.after(async () => {
    assert.ok(
      path
        .resolve(dir)
        .startsWith(
          path.resolve(os.tmpdir()) + path.sep + "outdoor-future-schema-",
        ),
    );
    await rm(dir, { recursive: true, force: true });
  });
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE future_data(id TEXT); PRAGMA user_version=99;");
  db.close();
  assert.throws(() => openStore(file), /数据库版本高于当前程序/);
  const check = new DatabaseSync(file);
  try {
    assert.equal(check.prepare("PRAGMA user_version").get().user_version, 99);
    assert.deepEqual(
      check
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => r.name),
      ["future_data"],
    );
  } finally {
    check.close();
  }
});

test("通知页码超大或非法不会导致数据库错误", async (t) => {
  const { client } = await fixture(t),
    c = client();
  await register(c);
  for (const value of ["9".repeat(400), "NaN", "-9999", "0"]) {
    const response = await c.request("/notifications?page=" + value);
    assert.equal(response.status, 200);
    assert.ok(response.data.page >= 1 && response.data.page <= 100000);
  }
});

test("历史日志可分页检索，普通账号不可读取，账号搜索由服务端执行", async (t) => {
  const { client, db } = await fixture(t),
    root = client(),
    c = client();
  await manager(root);
  await register(c, "history@test.local");
  const id = db
    .prepare("SELECT id FROM users WHERE email=?")
    .get(ADMIN.email).id;
  for (let i = 0; i < 115; i++)
    db.prepare(
      "INSERT INTO audit(actor,action,target,created) VALUES(?,?,?,?)",
    ).run(id, "test.history", "target-" + i, "2026-01-10T18:00:00.000Z");
  const r = await root.request(
    "/audit?q=test.history&page=3&from=2026-01-11&to=2026-01-11",
  );
  assert.equal(r.data.total, 115);
  assert.equal(r.data.items.length, 15);
  assert.equal(r.data.pages, 3);
  assert.equal((await root.request("/audit?from=bad")).status, 400);
  assert.equal((await c.request("/audit")).status, 403);
  assert.equal((await root.request("/users?q=history")).data.total, 1);
});
