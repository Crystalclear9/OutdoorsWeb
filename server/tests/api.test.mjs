import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../app.mjs";
import { listenHttp } from "./http-listen.mjs";

const PASSWORD = "SecureAccount123!";
const admin = { email: "admin@test.local", password: PASSWORD };
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=";
const enterprise = (email) => ({
  email,
  password: PASSWORD,
  company: "接口测试企业",
  contact: "测试联系人",
  phone: "13800138000",
});
async function fixture(t, dbPath = ":memory:") {
  const app = await createApp({
    dbPath,
    admin,
    captchaTestAnswer: "246789",
    maintenance: { scheduled: false },
  });
  await listenHttp(app.server);
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  t.after(() => app.close());
  function client() {
    const cookies = new Map();
    let csrf = "";
    return {
      async request(route, method = "GET", body, headers = {}) {
        if (["/auth/login", "/auth/register"].includes(route) && body) {
          const challenge = await this.request("/auth/captcha");
          body = { ...body, captchaId: challenge.data.id, captcha: "246789" };
        }
        const res = await fetch(origin + "/api" + route, {
          method,
          headers: {
            Origin: origin,
            Cookie: [...cookies].map(([k, v]) => k + "=" + v).join("; "),
            ...(csrf ? { "X-CSRF-Token": csrf } : {}),
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...headers,
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        for (const cookie of res.headers.getSetCookie()) {
          const part = cookie.split(";")[0],
            i = part.indexOf("=");
          cookies.set(part.slice(0, i), part.slice(i + 1));
        }
        const data = res.headers
          .get("content-type")
          ?.includes("application/json")
          ? await res.json()
          : await res.arrayBuffer();
        if (data.csrf) csrf = data.csrf;
        return { status: res.status, data, headers: res.headers };
      },
    };
  }
  return { app, client, origin };
}
async function register(c, email = "one@test.local") {
  const r = await c.request("/auth/register", "POST", enterprise(email));
  assert.equal(r.status, 201);
  return r.data.user;
}
const booking = (overrides = {}) => ({
  company: "接口测试企业",
  contact: "张老师",
  phone: "13800138000",
  start: today(),
  end: today(),
  slot: 1,
  image,
  ...overrides,
});

test("真实注册限制角色、密码散列与会话 cookie", async (t) => {
  const { app, client } = await fixture(t),
    c = client();
  const r = await c.request("/auth/register", "POST", {
    ...enterprise("ONE@test.local"),
    role: "admin",
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, "enterprise");
  assert.equal(r.data.user.email, "one@test.local");
  assert.ok(!("password_hash" in r.data.user));
  assert.match(r.headers.get("set-cookie"), /HttpOnly/);
  assert.match(r.headers.get("set-cookie"), /SameSite=Lax/);
  const row = app.db
    .prepare("SELECT * FROM users WHERE email=?")
    .get("one@test.local");
  assert.match(row.password_hash, /^scrypt:/);
  assert.notEqual(row.password_hash, PASSWORD);
  assert.equal((await c.request("/users")).status, 403);
  assert.equal(
    (
      await client().request(
        "/auth/register",
        "POST",
        enterprise("one@test.local"),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await client().request("/auth/register", "POST", {
        ...enterprise("weak@test.local"),
        password: "123",
      })
    ).status,
    400,
  );
});
test("登录、刷新会话、退出后失效以及错误密码", async (t) => {
  const { client } = await fixture(t),
    c = client();
  await register(c);
  assert.equal(
    (await c.request("/auth/session")).data.user.email,
    "one@test.local",
  );
  await c.request("/auth/logout", "POST");
  assert.equal((await c.request("/bookings")).status, 401);
  assert.equal(
    (
      await c.request("/auth/login", "POST", {
        email: "one@test.local",
        password: "wrong",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await c.request("/auth/login", "POST", {
        email: "one@test.local",
        password: PASSWORD,
      })
    ).status,
    200,
  );
});
test("拒绝跨来源请求以及缺少 CSRF 的认证写入", async (t) => {
  const { client } = await fixture(t),
    c = client();
  await register(c);
  assert.equal(
    (
      await c.request("/profile", "PATCH", enterprise("x@test.local"), {
        Origin: "https://attacker.invalid",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await c.request("/profile", "PATCH", enterprise("x@test.local"), {
        "X-CSRF-Token": "",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await c.request("/profile", "PATCH", {
        company: "新公司",
        contact: "新联系人",
        phone: "13900139000",
      })
    ).data.user.company,
    "新公司",
  );
});
test("修改密码撤销全部设备会话且旧密码不可再用", async (t) => {
  const { client } = await fixture(t),
    a = client(),
    b = client();
  await register(a);
  await b.request("/auth/login", "POST", {
    email: "one@test.local",
    password: PASSWORD,
  });
  assert.equal(
    (
      await a.request("/auth/password", "POST", {
        currentPassword: PASSWORD,
        newPassword: "AnotherSafePassword456",
      })
    ).status,
    200,
  );
  assert.equal((await b.request("/bookings")).status, 401);
  assert.equal(
    (
      await a.request("/auth/login", "POST", {
        email: "one@test.local",
        password: PASSWORD,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await a.request("/auth/login", "POST", {
        email: "one@test.local",
        password: "AnotherSafePassword456",
      })
    ).status,
    200,
  );
});
test("停用即时撤销会话，管理员重置密码并强制修改", async (t) => {
  const { client } = await fixture(t),
    a = client(),
    c = client();
  const u = await register(c);
  await a.request("/auth/login", "POST", admin);
  await a.request(
    `/users/${u.id}/status`,
    "POST",
    { disabled: true },
    { "If-Match": '"1"' },
  );
  assert.equal((await c.request("/bookings")).status, 401);
  assert.equal(
    (
      await c.request("/auth/login", "POST", {
        email: u.email,
        password: PASSWORD,
      })
    ).status,
    403,
  );
  await a.request(
    `/users/${u.id}/status`,
    "POST",
    { disabled: false },
    { "If-Match": '"2"' },
  );
  const reset = await a.request(
    `/users/${u.id}/reset-password`,
    "POST",
    undefined,
    { "If-Match": '"3"' },
  );
  assert.ok(reset.data.temporaryPassword);
  const login = await c.request("/auth/login", "POST", {
    email: u.email,
    password: reset.data.temporaryPassword,
  });
  assert.equal(login.data.user.mustChangePassword, true);
  assert.equal((await c.request("/bookings")).status, 403);
  assert.equal(
    (
      await c.request("/auth/password", "POST", {
        currentPassword: reset.data.temporaryPassword,
        newPassword: PASSWORD,
      })
    ).status,
    200,
  );
});
test("企业数据与设计图隔离，公开场地不泄漏联系人", async (t) => {
  const { client } = await fixture(t),
    a = client(),
    b = client(),
    guest = client();
  await register(a);
  await register(b, "two@test.local");
  const id = (await a.request("/bookings", "POST", booking())).data.id;
  assert.equal((await b.request("/bookings")).data.items.length, 0);
  assert.equal((await b.request(`/bookings/${id}`)).status, 403);
  assert.equal((await b.request(`/bookings/${id}/image`)).status, 403);
  assert.equal((await guest.request(`/bookings/${id}/image`)).status, 401);
  assert.equal((await a.request(`/bookings/${id}/image`)).status, 200);
  const venue = await guest.request("/venue");
  assert.ok(!JSON.stringify(venue.data).includes("13800138000"));
});
test("申报日期、图片校验和重复提交均在服务端执行", async (t) => {
  const { client } = await fixture(t),
    c = client();
  await register(c);
  const d = new Date(today() + "T12:00:00Z");
  d.setDate(d.getDate() + 3);
  assert.equal(
    (
      await c.request(
        "/bookings",
        "POST",
        booking({ end: d.toISOString().slice(0, 10) }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await c.request(
        "/bookings",
        "POST",
        booking({ image: "data:image/png;base64,aGVsbG8=" }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await c.request("/bookings", "POST", booking({ slot: 30 }))).status,
    400,
  );
  assert.equal((await c.request("/bookings", "POST", booking())).status, 201);
  assert.equal((await c.request("/bookings", "POST", booking())).status, 409);
});
test("并发审核同一位置只有一条能够通过", async (t) => {
  const { client } = await fixture(t),
    a = client(),
    b = client(),
    m = client();
  await register(a);
  await register(b, "two@test.local");
  await m.request("/auth/login", "POST", admin);
  const x = (await a.request("/bookings", "POST", booking())).data.id,
    y = (await b.request("/bookings", "POST", booking())).data.id;
  assert.equal(
    (
      await a.request(
        `/bookings/${x}/review`,
        "POST",
        { status: "已通过" },
        { "If-Match": '"1"' },
      )
    ).status,
    403,
  );
  const results = await Promise.all([
    m.request(
      `/bookings/${x}/review`,
      "POST",
      { status: "已通过" },
      { "If-Match": '"1"' },
    ),
    m.request(
      `/bookings/${y}/review`,
      "POST",
      { status: "已通过" },
      { "If-Match": '"1"' },
    ),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await client().request("/venue")).data.occupied.length, 1);
});
test("退回原因必填，撤回与状态流转受保护", async (t) => {
  const { client } = await fixture(t),
    a = client(),
    m = client();
  await register(a);
  await m.request("/auth/login", "POST", admin);
  const id = (await a.request("/bookings", "POST", booking())).data.id;
  assert.equal(
    (
      await m.request(
        `/bookings/${id}/review`,
        "POST",
        { status: "未通过" },
        { "If-Match": '"1"' },
      )
    ).status,
    400,
  );
  await m.request(
    `/bookings/${id}/review`,
    "POST",
    {
      status: "未通过",
      reason: "请修改设计图",
    },
    { "If-Match": '"1"' },
  );
  assert.equal(
    (await a.request(`/bookings/${id}`)).data.booking.reason,
    "请修改设计图",
  );
  assert.equal(
    (
      await a.request(`/bookings/${id}/withdraw`, "POST", undefined, {
        "If-Match": '"2"',
      })
    ).status,
    409,
  );
  const other = (await a.request("/bookings", "POST", booking({ slot: 2 })))
    .data.id;
  assert.equal(
    (
      await a.request(`/bookings/${other}/withdraw`, "POST", undefined, {
        "If-Match": '"1"',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await m.request(
        `/bookings/${other}/review`,
        "POST",
        { status: "已通过" },
        { "If-Match": '"2"' },
      )
    ).status,
    409,
  );
});
test("暂停开放、公告及审计均需管理员权限", async (t) => {
  const { client } = await fixture(t),
    a = client(),
    m = client();
  await register(a);
  await m.request("/auth/login", "POST", admin);
  assert.equal(
    (await a.request("/notices", "POST", { title: "x", content: "x" })).status,
    403,
  );
  const id = (
    await m.request("/notices", "POST", {
      title: "场地须知",
      content: "公告正文",
      pinned: true,
    })
  ).data.id;
  assert.equal(
    (await client().request("/notices")).data.items[0].title,
    "场地须知",
  );
  await m.request(
    `/notices/${id}`,
    "PATCH",
    {
      title: "更新标题",
      content: "更新正文",
    },
    { "If-Match": '"1"' },
  );
  assert.equal(
    (await client().request("/notices")).data.items[0].title,
    "更新标题",
  );
  await m.request(`/notices/${id}`, "DELETE", undefined, { "If-Match": '"2"' });
  assert.equal((await client().request("/notices")).data.items.length, 0);
  await m.request("/closures", "POST", {
    slot: 1,
    start: today(),
    end: today(),
    reason: "场地维护",
  });
  assert.equal((await a.request("/bookings", "POST", booking())).status, 409);
  const closures = (await m.request("/closures")).data.items;
  assert.equal(closures.length, 1);
  await m.request(`/closures/${closures[0].id}`, "DELETE");
  assert.equal((await a.request("/bookings", "POST", booking())).status, 201);
  assert.equal((await a.request("/audit")).status, 403);
  assert.ok((await m.request("/audit")).data.items.length > 3);
});
test("登录失败次数超限会被限制", async (t) => {
  const { client } = await fixture(t),
    c = client();
  for (let i = 0; i < 10; i++)
    assert.equal(
      (
        await c.request("/auth/login", "POST", {
          email: "nobody@test.local",
          password: "wrong",
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await c.request("/auth/login", "POST", {
        email: "nobody@test.local",
        password: "wrong",
      })
    ).status,
    429,
  );
});
test("账号和申请在进程重启后从数据库恢复", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "outdoor-persistence-")),
    filename = path.join(dir, "app.sqlite");
  let app = await createApp({
    dbPath: filename,
    captchaTestAnswer: "246789",
    maintenance: { scheduled: false },
  });
  await listenHttp(app.server);
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const challenge = await fetch(origin + "/api/auth/captcha");
  const value = await challenge.json();
  const registered = await fetch(origin + "/api/auth/register", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: challenge.headers.get("set-cookie").split(";")[0],
    },
    body: JSON.stringify({
      ...enterprise("persist@test.local"),
      captchaId: value.id,
      captcha: "246789",
    }),
  });
  assert.equal(registered.status, 201);
  await app.close();
  app = await createApp({
    dbPath: filename,
    maintenance: { scheduled: false },
  });
  assert.equal(
    app.db.prepare("SELECT email FROM users").get().email,
    "persist@test.local",
  );
  app.db.close();
  await rm(dir, { recursive: true });
});
