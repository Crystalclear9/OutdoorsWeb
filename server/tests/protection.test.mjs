import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  fixture,
  register,
  manager,
  staff,
  booking,
  seedLegacyBooking,
  PASSWORD,
} from "./helpers.mjs";

function delayedRequest(c, route, payload) {
  const data = JSON.stringify(payload);
  let req;
  const done = new Promise((resolve, reject) => {
    req = http.request(
      c.origin + "/api" + route,
      {
        method: "POST",
        headers: {
          ...c.headers,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let text = "";
        res.on("data", (b) => (text += b));
        res.on("end", () =>
          resolve({ status: res.statusCode, data: JSON.parse(text) }),
        );
      },
    );
    req.on("error", reject);
    req.write(data.slice(0, 1));
  });
  return { done, finish: () => req.end(data.slice(1)) };
}

test("同一请求并发重试返回同一申请，不重复写入或重复审计", async (t) => {
  const { client, db } = await fixture(t),
    c = client();
  await register(c);
  const headers = { "Idempotency-Key": "retry-safe-request-0001" };
  const results = await Promise.all(
    Array.from({ length: 12 }, () =>
      c.request("/bookings", "POST", booking(), headers),
    ),
  );
  assert.ok(results.every((r) => r.status === 201));
  assert.equal(new Set(results.map((r) => r.data.id)).size, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bookings").get().n, 1);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit WHERE action='booking.submitted'",
      )
      .get().n,
    1,
  );
  assert.equal(
    (
      await c.request(
        "/bookings",
        "POST",
        booking({ builder_contact: "另一搭建方" }),
        headers,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await c.request("/bookings", "POST", booking(), {
        "Idempotency-Key": "different-request-0002",
      })
    ).status,
    201,
  );
});
test("绕过接口直接写数据库仍不能造成预约与暂停安排重叠", async (t) => {
  const { client, db } = await fixture(t),
    c = client(),
    m = client();
  await register(c);
  await manager(m);
  const id = (await seedLegacyBooking({ db }, c)).data.id;
  await m.request(
    `/bookings/${id}/review`,
    "POST",
    { status: "已通过" },
    { "If-Match": '"1"' },
  );
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO closures(id,slot,start,end,reason,created) SELECT 'bypass',slot,start,end,'维护',created FROM bookings WHERE id=?",
        )
        .run(id),
    /SLOT_CONFLICT/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO bookings(id,user_id,company,contact,phone,start,end,slot,status,image,image_type,created) SELECT 'bypass',user_id,company,contact,phone,start,end,slot,'已通过',image,image_type,created FROM bookings WHERE id=?",
        )
        .run(id),
    /SLOT_CONFLICT/,
  );
  assert.throws(
    () => db.prepare("UPDATE bookings SET status='待审核' WHERE id=?").run(id),
    /INVALID_BOOKING_STATE/,
  );
  assert.throws(
    () => db.prepare("UPDATE bookings SET slot=2 WHERE id=?").run(id),
    /IMMUTABLE_BOOKING/,
  );
});
test("公告版本校验阻止两位编辑覆盖对方结果", async (t) => {
  const { client } = await fixture(t),
    a = client(),
    b = client();
  await manager(a);
  await manager(b);
  const id = (
    await a.request("/notices", "POST", { title: "原公告", content: "原正文" })
  ).data.id;
  assert.equal(
    (
      await a.request(`/notices/${id}`, "PATCH", {
        title: "无版本",
        content: "正文",
      })
    ).status,
    428,
  );
  const results = await Promise.all([
    a.request(
      `/notices/${id}`,
      "PATCH",
      { title: "甲编辑", content: "甲正文" },
      { "If-Match": '"1"' },
    ),
    b.request(
      `/notices/${id}`,
      "PATCH",
      { title: "乙编辑", content: "乙正文" },
      { "If-Match": '"1"' },
    ),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (
      await a.request(`/notices/${id}`, "DELETE", undefined, {
        "If-Match": '"1"',
      })
    ).status,
    409,
  );
  assert.equal((await a.request("/notices")).data.items[0].version, 2);
});
test("工作人员只能执行明确授予的权限，不能自行授权或查看企业私有内容", async (t) => {
  const { client } = await fixture(t),
    root = client(),
    limited = client(),
    enterprise = client();
  await manager(root);
  await register(enterprise);
  const id = (await enterprise.request("/bookings", "POST", booking())).data.id;
  const u = await staff(root, limited, ["notices.manage"]);
  assert.deepEqual(u.permissions, ["notices.manage"]);
  assert.equal(u.isSuperAdmin, false);
  assert.equal(
    (
      await limited.request("/notices", "POST", {
        title: "授权公告",
        content: "正文",
      })
    ).status,
    200,
  );
  for (const route of [
    "/users",
    "/closures",
    "/audit",
    "/access",
    `/bookings/${id}`,
    `/bookings/${id}/image`,
  ])
    assert.equal((await limited.request(route)).status, 403, route);
  assert.equal(
    (
      await limited.request(
        `/bookings/${id}/review`,
        "POST",
        {
          status: "已通过",
        },
        { "If-Match": '"1"' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await limited.request("/access/staff", "POST", {
        email: "evil@test.local",
        contact: "越权",
        permissions: ["accounts.manage"],
        currentPassword: PASSWORD,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await limited.request("/profile", "PATCH", {
        company: "活动中心",
        contact: "工作人员",
        phone: "13800138000",
        role: "admin",
        is_super: 1,
        permissions: ["accounts.manage"],
      })
    ).status,
    200,
  );
  assert.equal(
    (await limited.request("/auth/session")).data.user.isSuperAdmin,
    false,
  );
  assert.equal((await limited.request("/users")).status, 403);
});
test("授权需要超级管理员密码与最新版本，变更立即撤销已有会话", async (t) => {
  const { client } = await fixture(t),
    root = client(),
    c = client();
  const superUser = await manager(root),
    u = await staff(root, c, ["notices.manage"]);
  assert.equal(
    (
      await root.request(
        `/access/${u.id}`,
        "PATCH",
        { permissions: ["accounts.manage"], currentPassword: "wrong" },
        { "If-Match": `"${u.version}"` },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await root.request(
        `/access/${u.id}`,
        "PATCH",
        { permissions: ["unknown"], currentPassword: PASSWORD },
        { "If-Match": `"${u.version}"` },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await root.request(
        `/access/${superUser.id}`,
        "PATCH",
        { permissions: [], currentPassword: PASSWORD },
        { "If-Match": `"${superUser.version}"` },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await root.request(
        `/access/${u.id}`,
        "PATCH",
        { permissions: ["accounts.manage"], currentPassword: PASSWORD },
        { "If-Match": `"${u.version}"` },
      )
    ).status,
    200,
  );
  assert.equal(
    (await c.request("/notices", "POST", { title: "旧会话", content: "正文" }))
      .status,
    401,
  );
  assert.equal(
    (
      await root.request(
        `/access/${u.id}`,
        "PATCH",
        { permissions: ["audit.read"], currentPassword: PASSWORD },
        { "If-Match": `"${u.version}"` },
      )
    ).status,
    409,
  );
  await c.request("/auth/login", "POST", {
    email: u.email,
    password: PASSWORD,
  });
  assert.deepEqual((await c.request("/auth/session")).data.user.permissions, [
    "accounts.manage",
  ]);
  assert.equal(
    (
      await c.request("/notices", "POST", {
        title: "权限已收回",
        content: "正文",
      })
    ).status,
    403,
  );
});
test("上传过程中停用账号，上传完成后不能继续写入", async (t) => {
  const { client, db } = await fixture(t),
    root = client(),
    c = client();
  await manager(root);
  const u = await register(c);
  const delayed = delayedRequest(c, "/bookings", booking());
  await root.request(
    `/users/${u.id}/status`,
    "POST",
    { disabled: true },
    { "If-Match": '"1"' },
  );
  delayed.finish();
  assert.equal((await delayed.done).status, 401);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bookings").get().n, 0);
});
test("请求读取期间撤回授权，不能用旧权限发表公告", async (t) => {
  const { client, db } = await fixture(t),
    root = client(),
    c = client();
  await manager(root);
  const u = await staff(root, c, ["notices.manage"]);
  const delayed = delayedRequest(c, "/notices", {
    title: "滞留请求",
    content: "正文",
  });
  await root.request(
    `/access/${u.id}`,
    "PATCH",
    { permissions: [], currentPassword: PASSWORD },
    { "If-Match": `"${u.version}"` },
  );
  delayed.finish();
  assert.equal((await delayed.done).status, 401);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notices").get().n, 0);
});
test("会话仅本人可撤销，其他设备退出后令牌不能再使用", async (t) => {
  const { client, db } = await fixture(t),
    one = client(),
    two = client(),
    other = client();
  await register(one);
  await two.request("/auth/login", "POST", {
    email: "enterprise@test.local",
    password: PASSWORD,
  });
  await register(other, "other@test.local");
  const sessions = (await one.request("/auth/sessions")).data.items;
  assert.equal(sessions.length, 2);
  assert.ok(sessions.every((s) => !("token_hash" in s)));
  const foreign = (await other.request("/auth/sessions")).data.items[0];
  assert.equal(
    (await one.request(`/auth/sessions/${foreign.id}`, "DELETE")).status,
    404,
  );
  await one.request("/auth/logout-others", "POST");
  assert.equal((await two.request("/bookings")).status, 401);
  assert.equal((await one.request("/auth/sessions")).data.items.length, 1);
  db.prepare(
    "UPDATE sessions SET expires=0 WHERE user_id=(SELECT id FROM users WHERE email=?)",
  ).run("enterprise@test.local");
  assert.equal((await one.request("/bookings")).status, 401);
  assert.equal((await one.request("/auth/session")).data.user, null);
});
