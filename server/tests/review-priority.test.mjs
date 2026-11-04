import test from "node:test";
import assert from "node:assert/strict";
import { fixture, register, manager, staff, TODAY, IMAGE } from "./helpers.mjs";

const day = (n) =>
  new Date(Date.parse(TODAY()) + n * 86400000).toISOString().slice(0, 10);
function seed(f, user, id, start, hours, status = "待审核", cancelled = 0) {
  f.db
    .prepare(
      "INSERT INTO bookings(id,user_id,company,contact,phone,builder_contact,builder_phone,content_only,start,end,slot,status,image,image_type,created,cancelled) VALUES(?,?,?,'联系人','13800138000','搭建方','13900139000',1,?,?,1,?,?,'image/png',?,?)",
    )
    .run(
      id,
      user.id,
      id,
      day(start),
      day(start),
      status,
      Buffer.from(IMAGE.split(",")[1], "base64"),
      new Date(Date.now() - hours * 3600000).toISOString(),
      cancelled,
    );
}
async function setup(t) {
  const f = await fixture(t),
    owner = f.client(),
    root = f.client();
  const user = await register(owner);
  await manager(root);
  return { ...f, owner, root, user };
}
const ids = (r) => r.data.items.map((row) => row.id);

test("审批临期与逾时只包含可操作待审，重叠计数去重且阈值可配置", async (t) => {
  const f = await setup(t);
  for (const row of [
    ["today", 0, 1],
    ["near-new", 2, 2],
    ["near-old", 2, 30],
    ["far-old", 3, 30],
    ["far-new", 4, 1],
    ["expired", -1, 99],
    ["approved", 0, 99, "已通过"],
    ["rejected", 0, 99, "未通过"],
    ["cancelled", 0, 99, "已通过", 1],
  ])
    seed(f, f.user, ...row);
  const summary = await f.root.request("/summary");
  assert.deepEqual(summary.data.reviewQueue, {
    pending: 5,
    upcoming: 3,
    overdue: 2,
    attention: 4,
    upcomingDays: 2,
    overdueHours: 24,
  });
  const all = await f.root.request(
    "/bookings?status=" + encodeURIComponent("待审核") + "&order=start",
  );
  assert.deepEqual(ids(all), [
    "today",
    "near-old",
    "near-new",
    "far-old",
    "far-new",
  ]);
  assert.deepEqual(
    all.data.items.find((r) => r.id === "near-old").reviewPriority,
    { upcoming: true, overdue: true },
  );
  assert.deepEqual(
    all.data.items.find((r) => r.id === "far-new").reviewPriority,
    { upcoming: false, overdue: false },
  );
  assert.deepEqual(
    ids(await f.root.request("/bookings?reviewScope=upcoming&order=start")),
    ["today", "near-old", "near-new"],
  );
  assert.deepEqual(
    ids(await f.root.request("/bookings?reviewScope=overdue&order=start")),
    ["near-old", "far-old"],
  );
  assert.deepEqual(
    ids(await f.root.request("/bookings?reviewScope=attention&order=start")),
    ["today", "near-old", "near-new", "far-old"],
  );
  assert.deepEqual(
    ids(
      await f.root.request(
        "/bookings?reviewScope=upcoming&upcomingDays=0&order=start",
      ),
    ),
    ["today"],
  );
  assert.equal(
    (await f.root.request("/bookings?reviewScope=overdue&overdueHours=48")).data
      .total,
    0,
  );
  const custom = (
    await f.root.request("/summary?upcomingDays=3&overdueHours=1")
  ).data.reviewQueue;
  assert.equal(custom.upcoming, 4);
  assert.equal(custom.overdue, 5);
  assert.equal(custom.attention, 5);
  assert.deepEqual(
    ids(
      await f.root.request("/bookings?reviewScope=attention&q=far&order=start"),
    ),
    ["far-old"],
  );
  assert.equal(
    (
      await f.root.request(
        "/bookings?status=" +
          encodeURIComponent("已通过") +
          "&reviewScope=attention",
      )
    ).data.total,
    0,
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM delivery_jobs").get().n, 0);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM notifications").get().n,
    0,
    "队列读取不发企业通知",
  );
});

test("开始日期同日按创建时间和编号稳定翻页，原提交排序保留", async (t) => {
  const f = await setup(t);
  const created = new Date(Date.now() - 2 * 3600000).toISOString();
  for (let n = 17; n >= 0; n--) {
    const id = `tie-${String(n).padStart(2, "0")}`;
    seed(f, f.user, id, 1, 2);
    f.db.prepare("UPDATE bookings SET created=? WHERE id=?").run(created, id);
  }
  const first = await f.root.request(
      "/bookings?reviewScope=upcoming&order=start&page=1",
    ),
    second = await f.root.request(
      "/bookings?reviewScope=upcoming&order=start&page=2",
    );
  assert.equal(first.data.pages, 2);
  assert.deepEqual(
    [...ids(first), ...ids(second)],
    Array.from({ length: 18 }, (_, n) => `tie-${String(n).padStart(2, "0")}`),
  );
  assert.deepEqual(
    ids(await f.root.request("/bookings?order=oldest")),
    ids(first),
  );
  assert.equal(
    ids(await f.root.request("/bookings?order=newest"))[0],
    "tie-17",
  );
});

test("审批提醒参数仅审核人员使用，无效阈值不静默取默认值", async (t) => {
  const f = await setup(t),
    finance = f.client();
  await staff(
    f.root,
    finance,
    ["payments.manage"],
    "priority-finance@test.local",
  );
  for (const actor of [f.owner, finance]) {
    assert.equal(
      (await actor.request("/bookings?reviewScope=attention")).status,
      403,
    );
    assert.equal((await actor.request("/bookings?order=start")).status, 403);
    assert.equal((await actor.request("/bookings?upcomingDays=2")).status, 403);
  }
  assert.equal((await f.owner.request("/summary")).data.reviewQueue, undefined);
  for (const params of [
    "reviewScope=bogus",
    "upcomingDays=-1",
    "upcomingDays=31",
    "upcomingDays=1.5",
    "upcomingDays=",
    "overdueHours=0",
    "overdueHours=721",
    "overdueHours=NaN",
  ])
    assert.equal(
      (await f.root.request("/bookings?" + params)).status,
      400,
      params,
    );
  assert.equal((await f.root.request("/summary?overdueHours=0")).status, 400);
});
