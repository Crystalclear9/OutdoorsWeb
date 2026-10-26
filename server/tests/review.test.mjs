import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fixture,
  manager,
  register,
  staff,
  booking,
  seedLegacyBooking,
} from "./helpers.mjs";

test("历史预约的审批检查保留暂停、已占用、竞争提示且企业不获取管理信息", async (t) => {
  const { client, db } = await fixture(t),
    a = client(),
    c = client(),
    d = client();
  await manager(a);
  await register(c);
  await register(d, "second@test.local");
  const first = (await seedLegacyBooking({ db }, c)).data;
  await seedLegacyBooking({ db }, d);
  let detail = (await a.request("/bookings/" + first.id)).data.booking;
  assert.deepEqual(detail.reviewCheck, { blockers: [], competing: 1 });
  assert.equal(
    (await c.request("/bookings/" + first.id)).data.booking.reviewCheck,
    undefined,
  );
  db.prepare(
    "INSERT INTO closures VALUES('legacy-closure',1,?,?,'维护',?)",
  ).run(booking().start, booking().end, new Date().toISOString());
  detail = (await a.request("/bookings/" + first.id)).data.booking;
  assert.deepEqual(detail.reviewCheck.blockers, ["所选时段暂停开放"]);
  const other = (await seedLegacyBooking({ db }, c, { slot: 2 })).data;
  const pending = (await seedLegacyBooking({ db }, d, { slot: 2 })).data;
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

test("内容批量审批逐条鉴别版本，同日申请均可通过且审计仅写一次", async (t) => {
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
    [true, true, true, false],
  );
  assert.match(r.data.results[3].error, /修改/);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit WHERE action='booking.approved'",
      )
      .get().n,
    3,
  );
  const retry = await a.request("/bookings/review-batch", "POST", payload);
  assert.ok(retry.data.results.every((r) => !r.ok));
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit WHERE action='booking.approved'",
      )
      .get().n,
    3,
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
