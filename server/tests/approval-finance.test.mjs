import test from "node:test";
import assert from "node:assert/strict";
import {
  fixture,
  manager,
  register,
  staff,
  booking,
  seedLegacyBooking,
} from "./helpers.mjs";

const version = (n) => ({ "If-Match": `"${n}"` });
const future = (days) =>
  new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
async function setup(t) {
  const f = await fixture(t),
    root = f.client(),
    owner = f.client(),
    finance = f.client(),
    inactive = f.client(),
    unrelated = f.client();
  const admin = await manager(root);
  await register(owner);
  const fin = await staff(
    root,
    finance,
    ["payments.manage"],
    "approved-finance@test.local",
  );
  const stopped = await staff(
    root,
    inactive,
    ["payments.manage"],
    "inactive-finance@test.local",
  );
  const other = await staff(
    root,
    unrelated,
    ["audit.read"],
    "unrelated-finance@test.local",
  );
  const old = (await root.request("/access")).data.items.find(
    (u) => u.id === stopped.id,
  );
  assert.equal(
    (
      await root.request(
        `/users/${stopped.id}/status`,
        "POST",
        { disabled: true },
        version(old.version),
      )
    ).status,
    200,
  );
  return { ...f, root, owner, finance, admin, fin, stopped, other };
}
async function apply(f, slot) {
  const made = await seedLegacyBooking(
    f,
    f.owner,
    booking({ slot, start: future(30), end: future(30) }),
  );
  assert.equal(made.status, 201);
  return made.data.id;
}
function recipients(f, id) {
  return f.db
    .prepare(
      "SELECT user_id FROM notifications WHERE target=? AND title='新预约待财务办理' ORDER BY user_id",
    )
    .all(id)
    .map((r) => r.user_id);
}
function assertTask(f, id) {
  assert.deepEqual(recipients(f, id), [f.admin.id, f.fin.id].sort());
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) n FROM booking_fees WHERE booking_id=?")
      .get(id).n,
    0,
    "通知待办不能自动虚构费用单",
  );
}

test("审批通过向在职财务和超级管理员产生一次真实待办，退回与重复审批不误发", async (t) => {
  const f = await setup(t),
    id = await apply(f, 1);
  assert.equal(
    (
      await f.root.request(
        `/bookings/${id}/review`,
        "POST",
        { status: "已通过" },
        version(1),
      )
    ).status,
    200,
  );
  assertTask(f, id);
  const messages = (await f.finance.request("/notifications")).data.items;
  assert.ok(
    messages.some((m) => m.target === id && m.title === "新预约待财务办理"),
  );
  const queue = (await f.finance.request("/casework?scope=open")).data.items;
  assert.ok(queue.some((r) => r.id === id && r.fee === null));
  assert.equal(
    (
      await f.root.request(
        `/bookings/${id}/review`,
        "POST",
        { status: "已通过" },
        version(1),
      )
    ).status,
    409,
  );
  assertTask(f, id);
  const rejected = await apply(f, 2);
  assert.equal(
    (
      await f.root.request(
        `/bookings/${rejected}/review`,
        "POST",
        { status: "未通过", reason: "调整设计" },
        version(1),
      )
    ).status,
    200,
  );
  assert.deepEqual(recipients(f, rejected), []);
});

test("批量通过逐条生成财务待办，重复批次不增加通知", async (t) => {
  const f = await setup(t),
    ids = [await apply(f, 3), await apply(f, 4)];
  const payload = {
    status: "已通过",
    items: ids.map((id) => ({ id, version: 1 })),
  };
  const first = await f.root.request("/bookings/review-batch", "POST", payload);
  assert.equal(first.status, 200);
  assert.ok(first.data.results.every((r) => r.ok));
  ids.forEach((id) => assertTask(f, id));
  const second = await f.root.request(
    "/bookings/review-batch",
    "POST",
    payload,
  );
  assert.ok(second.data.results.every((r) => !r.ok));
  ids.forEach((id) => assertTask(f, id));
});

test("历史预约改期转为内容审核，不再创建新财务待办且保留旧单历史", async (t) => {
  const f = await setup(t),
    original = await apply(f, 5);
  assert.equal(
    (
      await f.root.request(
        `/bookings/${original}/review`,
        "POST",
        { status: "已通过" },
        version(1),
      )
    ).status,
    200,
  );
  const replacement = await f.owner.request(
    `/bookings/${original}/reschedule`,
    "POST",
    { slot: 6, start: future(31), end: future(31) },
    version(2),
  );
  assert.equal(replacement.status, 201);
  const id = replacement.data.id;
  assert.equal(
    (
      await f.root.request(
        `/bookings/${id}/review`,
        "POST",
        { status: "已通过" },
        version(1),
      )
    ).status,
    200,
  );
  assertTask(f, original);
  assert.deepEqual(recipients(f, id), []);
  assert.equal(
    (await f.owner.request(`/bookings/${original}`)).data.booking.status,
    "已取消",
  );
  assert.equal((await f.finance.request(`/casework/${id}`)).status, 410);
});
