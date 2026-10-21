import test from "node:test";
import assert from "node:assert/strict";
import { fixture, register, manager, booking, TODAY } from "./helpers.mjs";
import { createDelivery } from "../delivery.mjs";

const version = (n) => ({ "If-Match": `"${n}"` });
function queue(
  db,
  id,
  userId,
  bookingId,
  phone = "13800138000",
  state = "pending",
) {
  db.prepare(
    "INSERT INTO delivery_jobs(id,kind,payload,state,next_at,created) VALUES(?,'voice',?,?,0,?)",
  ).run(
    id,
    JSON.stringify({
      userId,
      bookingId,
      phone,
      message: "审核结果，请登录查看",
    }),
    state,
    new Date().toISOString(),
  );
}
async function makeBooking(owner, root, slot, status = "已通过") {
  const made = await owner.request("/bookings", "POST", booking({ slot }));
  assert.equal(made.status, 201);
  if (status !== "待审核")
    assert.equal(
      (
        await root.request(
          `/bookings/${made.data.id}/review`,
          "POST",
          { status, reason: status === "未通过" ? "材料需要补充" : "" },
          version(1),
        )
      ).status,
      200,
    );
  return made.data.id;
}
function bind(db, id, phone) {
  db.prepare("INSERT INTO verified_phones VALUES(?,?)").run(phone, id);
  db.prepare("INSERT INTO contact_preferences VALUES(?,1,1)").run(id);
}

test("取消及人工重试的陈旧审批结果不发送，悬空或归属不符的任务取消并留审计", async (t) => {
  const f = await fixture(t),
    owner = f.client(),
    other = f.client(),
    root = f.client();
  const user = await register(owner),
    otherUser = await register(other, "other-delivery@test.local");
  await manager(root);
  bind(f.db, user.id, "13800138000");
  bind(f.db, otherUser.id, "13900139000");
  const cancelled = await makeBooking(owner, root, 1),
    valid = await makeBooking(owner, root, 2),
    rejected = await makeBooking(owner, root, 3, "未通过"),
    pending = await makeBooking(owner, root, 4, "待审核"),
    expired = "historical-approved",
    expiredRejected = "historical-rejected";
  // Simulate a durable queue resuming after the approved/rejected event dates.
  const yesterday = new Date(TODAY() + "T00:00:00Z");
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const past = yesterday.toISOString().slice(0, 10);
  for (const [id, source] of [
    [expired, valid],
    [expiredRejected, rejected],
  ])
    f.db
      .prepare(
        "INSERT INTO bookings(id,user_id,company,contact,phone,start,end,slot,status,image,image_type,created) SELECT ?,user_id,company,contact,phone,?,?,slot,status,image,image_type,created FROM bookings WHERE id=?",
      )
      .run(id, past, past, source);
  queue(f.db, "cancelled-retry", user.id, cancelled, undefined, "failed");
  assert.equal(
    (
      await root.request("/operations/deliveries/cancelled-retry", "POST", {
        action: "retry",
        reason: "服务商已核实未受理，等待重试",
        version: 1,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await owner.request(
        `/bookings/${cancelled}/cancel`,
        "POST",
        { reason: "活动取消" },
        version(2),
      )
    ).status,
    200,
  );
  queue(f.db, "valid-approved", user.id, valid);
  queue(f.db, "valid-rejected", user.id, expiredRejected);
  queue(f.db, "missing-booking", user.id, "nonexistent-booking");
  queue(f.db, "wrong-owner", otherUser.id, valid, "13900139000");
  queue(f.db, "pending-booking", user.id, pending);
  queue(f.db, "expired-approved", user.id, expired);
  const sent = [],
    delivery = createDelivery(f.db, f.maintenance, {
      scheduled: false,
      sendPhone: async (...args) => {
        sent.push(args);
        return "provider-receipt";
      },
    });
  t.after(() => delivery.close());
  await delivery.run();
  await delivery.run();
  assert.equal(sent.length, 2);
  const rows = f.db
    .prepare("SELECT id,state,version,last_error FROM delivery_jobs")
    .all();
  for (const id of [
    "cancelled-retry",
    "missing-booking",
    "wrong-owner",
    "pending-booking",
    "expired-approved",
  ]) {
    const row = rows.find((r) => r.id === id);
    assert.equal(row.state, "cancelled", id);
    assert.ok(row.last_error, id);
    assert.equal(row.version, id === "cancelled-retry" ? 4 : 3, id);
    assert.equal(
      f.db
        .prepare(
          "SELECT COUNT(*) n FROM audit WHERE action='delivery.cancelled' AND target=?",
        )
        .get(id).n,
      1,
    );
  }
  assert.equal(rows.find((r) => r.id === "valid-approved").state, "accepted");
  assert.equal(rows.find((r) => r.id === "valid-rejected").state, "accepted");
});

test("发送前重新校验账号停用、号码换绑和退订，取消队列不会向旧号码泄露结果", async (t) => {
  const f = await fixture(t),
    root = f.client();
  await manager(root);
  const users = [];
  for (let i = 0; i < 4; i++) {
    const owner = f.client(),
      user = await register(owner, `delivery-account-${i}@test.local`),
      phone = `1380013800${i}`;
    bind(f.db, user.id, phone);
    const id = await makeBooking(owner, root, i + 1);
    queue(f.db, `account-${i}`, user.id, id, phone);
    users.push(user);
  }
  f.db.prepare("UPDATE users SET disabled=1 WHERE id=?").run(users[0].id);
  f.db
    .prepare("UPDATE verified_phones SET phone='13900139001' WHERE user_id=?")
    .run(users[1].id);
  f.db
    .prepare("UPDATE contact_preferences SET voice=0 WHERE user_id=?")
    .run(users[2].id);
  const sent = [],
    delivery = createDelivery(f.db, f.maintenance, {
      scheduled: false,
      sendPhone: async (kind, phone) => {
        sent.push({ kind, phone });
        return "provider-receipt";
      },
    });
  t.after(() => delivery.close());
  await delivery.run();
  await delivery.run();
  assert.deepEqual(sent, [{ kind: "voice", phone: "13800138003" }]);
  for (let i = 0; i < 3; i++) {
    assert.equal(
      f.db
        .prepare("SELECT state FROM delivery_jobs WHERE id=?")
        .get(`account-${i}`).state,
      "cancelled",
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT COUNT(*) n FROM audit WHERE action='delivery.cancelled' AND target=?",
        )
        .get(`account-${i}`).n,
      1,
    );
  }
});
