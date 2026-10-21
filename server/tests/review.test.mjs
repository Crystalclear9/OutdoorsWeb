import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, manager, register, staff, booking } from "./helpers.mjs";

test("审批提示区分暂停、已占用、竞争待办；企业不获取管理员检查信息", async (t) => {
  const { client } = await fixture(t),
    a = client(),
    c = client(),
    d = client();
  await manager(a);
  await register(c);
  await register(d, "second@test.local");
  const first = (await c.request("/bookings", "POST", booking())).data;
  await d.request("/bookings", "POST", booking());
  let detail = (await a.request("/bookings/" + first.id)).data.booking;
  assert.deepEqual(detail.reviewCheck, { blockers: [], competing: 1 });
  assert.equal(
    (await c.request("/bookings/" + first.id)).data.booking.reviewCheck,
    undefined,
  );
  await a.request("/closures", "POST", {
    slot: 1,
    start: booking().start,
    end: booking().end,
    reason: "维护",
  });
  detail = (await a.request("/bookings/" + first.id)).data.booking;
  assert.deepEqual(detail.reviewCheck.blockers, ["所选时段暂停开放"]);
  const other = (await c.request("/bookings", "POST", booking({ slot: 2 })))
    .data;
  const pending = (await d.request("/bookings", "POST", booking({ slot: 2 })))
    .data;
  await a.request(
    "/bookings/" + other.id + "/review",
    "POST",
    {
      status: "已通过",
    },
    { "If-Match": '"1"' },
  );
  assert.deepEqual(
    (await a.request("/bookings/" + pending.id)).data.booking.reviewCheck
      .blockers,
    ["与已通过预约冲突"],
  );
});

test("批量审批逐条鉴别版本与冲突，成功记录仅写一次审计", async (t) => {
  const { client, db } = await fixture(t),
    a = client(),
    c = client(),
    d = client();
  await manager(a);
  await register(c);
  await register(d, "second@test.local");
  const ids = [];
  ids.push((await c.request("/bookings", "POST", booking())).data.id);
  ids.push((await d.request("/bookings", "POST", booking())).data.id);
  ids.push(
    (await c.request("/bookings", "POST", booking({ slot: 2 }))).data.id,
  );
  ids.push(
    (await c.request("/bookings", "POST", booking({ slot: 3 }))).data.id,
  );
  await c.request("/bookings/" + ids[3] + "/withdraw", "POST", undefined, {
    "If-Match": '"1"',
  });
  const payload = {
    status: "已通过",
    items: ids.map((id) => ({ id, version: 1 })),
  };
  const r = await a.request("/bookings/review-batch", "POST", payload);
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.data.results.map((r) => r.ok),
    [true, false, true, false],
  );
  assert.match(r.data.results[1].error, /冲突/);
  assert.match(r.data.results[3].error, /修改/);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit WHERE action='booking.approved'",
      )
      .get().n,
    2,
  );
  const retry = await a.request("/bookings/review-batch", "POST", payload);
  assert.ok(retry.data.results.every((r) => !r.ok));
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit WHERE action='booking.approved'",
      )
      .get().n,
    2,
  );
});

test("批量退回必须有原因与版本，未授权账号不可调用，格式错误不写入", async (t) => {
  const { client, db } = await fixture(t),
    a = client(),
    c = client(),
    s = client();
  await manager(a);
  await register(c);
  await staff(a, s, ["notices.manage"]);
  const id = (await c.request("/bookings", "POST", booking())).data.id;
  const payload = {
    status: "未通过",
    reason: "请补充清晰设计图",
    items: [{ id, version: 1 }],
  };
  assert.equal(
    (await c.request("/bookings/review-batch", "POST", payload)).status,
    403,
  );
  assert.equal(
    (await s.request("/bookings/review-batch", "POST", payload)).status,
    403,
  );
  for (const extra of [
    { reason: "" },
    { items: [{ id }] },
    {
      items: [
        { id, version: 1 },
        { id, version: 1 },
      ],
    },
    { items: [] },
  ])
    assert.equal(
      (
        await a.request("/bookings/review-batch", "POST", {
          ...payload,
          ...extra,
        })
      ).status,
      400,
    );
  assert.equal(
    db.prepare("SELECT status FROM bookings WHERE id=?").get(id).status,
    "待审核",
  );
  assert.equal(
    (await a.request("/bookings/review-batch", "POST", payload)).data.results[0]
      .ok,
    true,
  );
  assert.equal(
    db.prepare("SELECT reason FROM bookings WHERE id=?").get(id).reason,
    payload.reason,
  );
});

test("批量审批与另一个管理员同时审批，只有一份通过记录", async (t) => {
  const { client, db } = await fixture(t),
    a = client(),
    b = client(),
    c = client();
  await manager(a);
  await manager(b);
  await register(c);
  const id = (await c.request("/bookings", "POST", booking())).data.id;
  const payload = { status: "已通过", items: [{ id, version: 1 }] };
  const results = await Promise.all([
    a.request("/bookings/review-batch", "POST", payload),
    b.request(
      "/bookings/" + id + "/review",
      "POST",
      { status: "已通过" },
      { "If-Match": '"1"' },
    ),
  ]);
  const succeeded =
    Number(results[0].data.results[0].ok) + Number(results[1].status === 200);
  assert.equal(succeeded, 1);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit WHERE action='booking.approved'",
      )
      .get().n,
    1,
  );
});
