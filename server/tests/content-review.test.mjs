import test from "node:test";
import assert from "node:assert/strict";
import {
  fixture,
  manager,
  register,
  booking,
  seedLegacyBooking,
  PASSWORD,
} from "./helpers.mjs";
import {
  bookingView,
  expiredReview,
  BOOKING_LOCATION,
} from "../booking-policy.mjs";
import { archiveHistory } from "../business.mjs";
import { overdueCases } from "../casework.mjs";

const version = (n = 1) => ({ "If-Match": `"${n}"` });
const day = (offset) =>
  new Date(Date.parse(booking().start) + offset * 86400000)
    .toISOString()
    .slice(0, 10);
async function setup(t) {
  const f = await fixture(t),
    owner = f.client(),
    root = f.client();
  const user = await register(owner);
  await manager(root);
  return { ...f, owner, root, user };
}
function historicalPending(
  f,
  {
    id = "expired-content",
    start = day(-1),
    end = start,
    reschedule_of = null,
    created = new Date().toISOString(),
  } = {},
) {
  f.db
    .prepare(
      "INSERT INTO bookings(id,user_id,company,contact,phone,builder_contact,builder_phone,content_only,start,end,slot,status,image,image_type,created,reschedule_of) VALUES(?,?,?,?,?,?,?,1,?,?,1,'待审核',?,'image/png',?,?)",
    )
    .run(
      id,
      f.user.id,
      "过期内容企业",
      "企业联系人",
      "13800138000",
      "搭建联系人",
      "13900139000",
      start,
      end,
      Buffer.from(booking().image.split(",")[1], "base64"),
      created,
      reschedule_of,
    );
  return id;
}

test("内容申请必填搭建方且位置固定，幂等比较包含搭建方，不创建企业缴费或电话任务", async (t) => {
  const f = await setup(t);
  for (const extra of [
    { builder_contact: "" },
    { builder_phone: "bad" },
    { builder_phone: 13900139000 },
  ])
    assert.equal(
      (await f.owner.request("/bookings", "POST", booking(extra))).status,
      400,
    );
  const headers = { "Idempotency-Key": "content-builder-test-01" };
  const payload = booking({ slot: 29 });
  const made = await f.owner.request("/bookings", "POST", payload, headers);
  assert.equal(made.status, 201);
  assert.equal(
    (
      await f.owner.request(
        "/bookings",
        "POST",
        { ...payload, slot: 2 },
        headers,
      )
    ).data.id,
    made.data.id,
  );
  assert.equal(
    (
      await f.owner.request(
        "/bookings",
        "POST",
        { ...payload, builder_contact: "其他搭建联系人" },
        headers,
      )
    ).status,
    409,
  );
  const detail = (await f.owner.request("/bookings/" + made.data.id)).data
    .booking;
  assert.equal(detail.location, BOOKING_LOCATION);
  assert.equal(detail.content_only, 1);
  assert.equal(detail.builder_contact, payload.builder_contact);
  assert.equal(detail.builder_phone, payload.builder_phone);
  assert.equal(detail.slot, 1);
  f.db
    .prepare("INSERT INTO verified_phones VALUES('13800138000',?)")
    .run(f.user.id);
  f.db.prepare("INSERT INTO contact_preferences VALUES(?,1,1)").run(f.user.id);
  assert.equal(
    (
      await f.root.request(
        `/bookings/${made.data.id}/review`,
        "POST",
        { status: "已通过" },
        version(),
      )
    ).status,
    200,
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM delivery_jobs").get().n, 0);
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM notifications WHERE title='新预约待财务办理'",
      )
      .get().n,
    0,
  );
  assert.equal((await f.root.request("/casework?scope=all")).data.total, 0);
  assert.equal(
    (await f.owner.request("/casework/" + made.data.id)).status,
    410,
  );
  assert.equal(
    (
      await f.owner.request(
        `/casework/${made.data.id}/fee`,
        "POST",
        { action: "submit", reference: "流水" },
        version(),
      )
    ).status,
    410,
  );
});

test("默认平台同日多企业可通过，旧位置暂停和占用不阻止内容审核", async (t) => {
  const f = await setup(t),
    other = f.client();
  await register(other, "content-second@test.local");
  f.db
    .prepare("INSERT INTO closures VALUES('legacy-closure',1,?,?,'旧维护',?)")
    .run(day(0), day(0), new Date().toISOString());
  const ids = await Promise.all(
    [f.owner, other].map(
      async (c) => (await c.request("/bookings", "POST", booking())).data.id,
    ),
  );
  const results = await Promise.all(
    ids.map((id) =>
      f.root.request(
        `/bookings/${id}/review`,
        "POST",
        { status: "已通过" },
        version(),
      ),
    ),
  );
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200],
  );
  assert.equal((await f.owner.request("/venue")).data.occupied.length, 0);
});

test("过期待审按身份投影且筛选汇总一致，不伪造审核人时间，也不能通过退回或撤回", async (t) => {
  const f = await setup(t),
    id = historicalPending(f);
  const created = await f.owner.request("/bookings", "POST", booking());
  assert.equal(created.status, 201);
  for (const [c, status] of [
    [f.root, "过期未审核"],
    [f.owner, "未通过"],
  ]) {
    const row = (await c.request("/bookings/" + id)).data.booking;
    assert.equal(row.status, status);
    assert.equal(row.reviewExpired, true);
    assert.equal(row.reviewed, null);
    assert.match(row.reason, /申请日期已过期/);
    const filtered = (
      await c.request("/bookings?status=" + encodeURIComponent(status))
    ).data;
    assert.deepEqual(
      filtered.items.map((x) => x.id),
      [id],
    );
    assert.equal(filtered.total, 1);
    assert.equal((await c.request("/summary")).data.counts[status], 1);
    assert.equal((await c.request("/summary")).data.counts["待审核"], 1);
    assert.equal(
      (await c.request("/bookings?status=" + encodeURIComponent("待审核"))).data
        .total,
      1,
    );
  }
  for (const status of ["已通过", "未通过"])
    assert.equal(
      (
        await f.root.request(
          `/bookings/${id}/review`,
          "POST",
          { status, reason: "人工尝试" },
          version(),
        )
      ).status,
      409,
    );
  assert.equal(
    (
      await f.owner.request(
        `/bookings/${id}/withdraw`,
        "POST",
        undefined,
        version(),
      )
    ).status,
    409,
  );
  const batch = await f.root.request("/bookings/review-batch", "POST", {
    status: "已通过",
    items: [{ id, version: 1 }],
  });
  assert.deepEqual(
    batch.data.results.map((r) => r.ok),
    [false],
  );
  const stored = f.db
    .prepare("SELECT status,reviewed,reviewer,version FROM bookings WHERE id=?")
    .get(id);
  assert.deepEqual(
    { ...stored },
    { status: "待审核", reviewed: null, reviewer: null, version: 1 },
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM audit WHERE target=? AND action IN ('booking.approved','booking.rejected','booking.withdrawn')",
      )
      .get(id).n,
    0,
  );
  assert.equal(
    (
      await f.owner.request(
        "/bookings?status=" + encodeURIComponent("过期未审核"),
      )
    ).status,
    403,
  );
});

test("过期是北京时间开始日期前未审核的投影，已审核和取消历史不被覆盖", () => {
  const row = {
    status: "待审核",
    start: "2026-10-26",
    end: "2026-10-28",
    cancelled: 0,
    reason: "",
  };
  assert.equal(expiredReview(row, "2026-10-26"), false);
  assert.equal(bookingView(row, true, "2026-10-27").status, "过期未审核");
  assert.equal(bookingView(row, false, "2026-10-27").status, "未通过");
  assert.equal(
    bookingView({ ...row, status: "已通过" }, false, "2026-10-27").status,
    "已通过",
  );
  assert.equal(
    bookingView({ ...row, cancelled: 1 }, false, "2026-10-27").status,
    "已取消",
  );
});

test("场地开放权限不可新分配且写入退役，旧授权历史读取仍受鉴权", async (t) => {
  const f = await setup(t),
    legacy = await seedLegacyBooking(f, f.owner);
  f.db
    .prepare(
      "INSERT INTO closures VALUES('old-closure',2,?,?,'历史开放安排',?)",
    )
    .run(day(0), day(0), new Date().toISOString());
  assert.equal((await f.owner.request("/closures")).status, 403);
  assert.equal((await f.root.request("/closures")).data.items.length, 1);
  assert.equal(
    (
      await f.root.request("/closures", "POST", {
        slot: 3,
        start: day(0),
        end: day(0),
        reason: "新维护",
      })
    ).status,
    410,
  );
  assert.equal(
    (await f.root.request("/closures/old-closure", "DELETE")).status,
    410,
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM closures").get().n, 1);
  assert.equal(
    (
      await f.root.request("/access/staff", "POST", {
        email: "retired@test.local",
        contact: "旧权限",
        permissions: ["venue.manage"],
        currentPassword: PASSWORD,
      })
    ).status,
    400,
  );
  assert.ok(legacy.data.id);
});

test("历史预约改期需补搭建方并转为内容审核，不携带旧位置申请", async (t) => {
  const f = await setup(t),
    made = await seedLegacyBooking(f, f.owner, {
      start: day(4),
      end: day(4),
      builder_contact: "",
      builder_phone: "",
    }),
    id = made.data.id;
  assert.equal(
    (
      await f.root.request(
        `/bookings/${id}/review`,
        "POST",
        { status: "已通过" },
        version(),
      )
    ).status,
    200,
  );
  const dates = { start: day(5), end: day(5), slot: 29 };
  assert.equal(
    (
      await f.owner.request(
        `/bookings/${id}/reschedule`,
        "POST",
        dates,
        version(2),
      )
    ).status,
    400,
  );
  const changed = await f.owner.request(
    `/bookings/${id}/reschedule`,
    "POST",
    { ...dates, builder_contact: "搭建方补录", builder_phone: "13900139000" },
    version(2),
  );
  assert.equal(changed.status, 201);
  const detail = (await f.owner.request("/bookings/" + changed.data.id)).data
    .booking;
  assert.equal(detail.content_only, 1);
  assert.equal(detail.slot, 1);
  assert.equal(detail.builder_contact, "搭建方补录");
});

test("长期过期待审图片可归档且保留原始未审核事实，取消不会抹掉过期改期事实", async (t) => {
  const f = await setup(t),
    old = historicalPending(f, {
      id: "old-expired",
      start: "2000-01-01",
      created: "2000-01-01T00:00:00Z",
    });
  assert.equal(archiveHistory(f.db, 30).images, 1);
  assert.deepEqual(
    {
      ...f.db
        .prepare("SELECT status,length(image) bytes FROM bookings WHERE id=?")
        .get(old),
    },
    { status: "待审核", bytes: 0 },
  );
  const original = (
    await f.owner.request(
      "/bookings",
      "POST",
      booking({ start: day(4), end: day(4) }),
    )
  ).data.id;
  assert.equal(
    (
      await f.root.request(
        `/bookings/${original}/review`,
        "POST",
        { status: "已通过" },
        version(),
      )
    ).status,
    200,
  );
  const child = historicalPending(f, {
    id: "expired-reschedule",
    reschedule_of: original,
  });
  assert.equal(
    (
      await f.owner.request(
        `/bookings/${original}/cancel`,
        "POST",
        { reason: "取消活动" },
        version(2),
      )
    ).status,
    200,
  );
  assert.equal(
    (await f.root.request("/bookings/" + child)).data.booking.status,
    "过期未审核",
  );
});

test("历史过期待审不形成不可处理的永久电话待办，全部历史仍保留过期说明", async (t) => {
  const f = await setup(t);
  const made = await seedLegacyBooking(f, f.owner, {
    start: day(-1),
    end: day(-1),
  });
  f.db
    .prepare(
      "UPDATE bookings SET created='2000-01-01T00:00:00.000Z' WHERE id=?",
    )
    .run(made.data.id);
  assert.equal((await f.root.request("/casework?scope=open")).data.total, 0);
  assert.equal((await f.owner.request("/casework?scope=open")).data.total, 0);
  assert.equal(overdueCases(f.db), 0);
  const history = (await f.root.request("/casework?scope=all")).data.items;
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "过期未审核");
  assert.equal(history[0].overdue, false);
  assert.equal(
    (await f.owner.request("/casework/" + made.data.id)).data.item.status,
    "未通过",
  );
  assert.equal(
    (
      await f.root.request(
        `/casework/${made.data.id}/contact`,
        "POST",
        { state: "reached", note: "试图登记" },
        version(),
      )
    ).status,
    409,
  );
});
