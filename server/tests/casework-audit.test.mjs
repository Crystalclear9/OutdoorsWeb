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

const ver = (n) => ({ "If-Match": `"${n}"` });
async function setup(t) {
  const f = await fixture(t);
  const root = f.client(),
    owner = f.client(),
    reviewer = f.client(),
    finance = f.client();
  await manager(root);
  await register(owner);
  await staff(root, reviewer, ["bookings.review"], "reviewer-audit@test.local");
  const financier = await staff(
    root,
    finance,
    ["payments.manage"],
    "finance-audit@test.local",
  );
  const id = (await seedLegacyBooking(f, owner, booking())).data.id;
  const approve = (target = id) =>
    root.request(
      `/bookings/${target}/review`,
      "POST",
      { status: "已通过" },
      ver(1),
    );
  return { ...f, root, owner, reviewer, finance, financier, id, approve };
}
const open = async (client) =>
  (await client.request("/casework?scope=open")).data;

test("独立审核和财务的待办只包含本角色能够处理的事项，企业保留自身办理范围", async (t) => {
  const f = await setup(t);
  assert.equal((await open(f.reviewer)).total, 1);
  assert.equal((await open(f.finance)).total, 0);
  assert.equal((await open(f.owner)).total, 1);
  await f.approve();
  assert.equal((await open(f.finance)).total, 1);
  await f.root.request(
    `/casework/${f.id}/contact`,
    "POST",
    { state: "reached", note: "实际电话告知审核结果" },
    ver(1),
  );
  await f.finance.request(`/casework/${f.id}/fee`, "POST", {
    action: "issue",
    amountFen: 100,
    instructions: "单位窗口",
    note: "批准的收费标准",
  });
  assert.equal((await open(f.reviewer)).total, 0);
  assert.equal((await open(f.finance)).total, 1);
  assert.equal((await open(f.owner)).total, 1);
  assert.equal((await f.reviewer.request("/casework?scope=all")).data.total, 1);
  await f.finance.request(
    `/casework/${f.id}/fee`,
    "POST",
    { action: "confirm", note: "核实银行实际入账" },
    ver(1),
  );
  assert.equal((await open(f.finance)).total, 0);
  assert.equal((await open(f.owner)).total, 0);
});

for (const method of ["cancel", "reschedule"])
  for (const state of ["paid", "submitted"])
    test(`${method}后向独立财务发送一次${state}核款退款提醒，过期重试不重复通知`, async (t) => {
      const f = await setup(t);
      await f.approve();
      await f.finance.request(`/casework/${f.id}/fee`, "POST", {
        action: "issue",
        amountFen: 100,
        instructions: "单位窗口",
        note: "收费标准",
      });
      if (state === "paid")
        await f.finance.request(
          `/casework/${f.id}/fee`,
          "POST",
          { action: "confirm", note: "银行实际到账" },
          ver(1),
        );
      else
        await f.owner.request(
          `/casework/${f.id}/fee`,
          "POST",
          { action: "submit", reference: "实际银行流水" },
          ver(1),
        );
      const notifications = () =>
        f.db
          .prepare(
            "SELECT * FROM notifications WHERE user_id=? AND title='预约取消，费用需核对'",
          )
          .all(f.financier.id);
      let act;
      if (method === "cancel")
        act = () =>
          f.owner.request(
            `/bookings/${f.id}/cancel`,
            "POST",
            { reason: "活动取消" },
            ver(2),
          );
      else {
        const replacement = await f.owner.request(
          `/bookings/${f.id}/reschedule`,
          "POST",
          {
            start: new Date(Date.parse(booking().start) + 86400000)
              .toISOString()
              .slice(0, 10),
            end: new Date(Date.parse(booking().end) + 86400000)
              .toISOString()
              .slice(0, 10),
          },
          ver(2),
        );
        assert.equal(replacement.status, 201);
        act = () => f.approve(replacement.data.id);
      }
      assert.equal((await act()).status, 200);
      assert.equal(notifications().length, 1);
      assert.equal(notifications()[0].target, f.id);
      assert.match(
        notifications()[0].content,
        state === "paid" ? /线下退款/ : /流水是否到账/,
      );
      assert.equal((await act()).status, 409);
      assert.equal(notifications().length, 1);
      assert.equal(
        (await open(f.finance)).items.some((r) => r.id === f.id),
        true,
      );
      assert.equal(
        (await open(f.reviewer)).items.some((r) => r.id === f.id),
        false,
      );
    });

test("无需核款的取消不制造退款提醒，已停用财务不接收通知", async (t) => {
  const f = await setup(t);
  await f.approve();
  await f.finance.request(`/casework/${f.id}/fee`, "POST", {
    action: "issue",
    amountFen: 100,
    instructions: "单位窗口",
    note: "收费依据",
  });
  await f.owner.request(
    `/bookings/${f.id}/cancel`,
    "POST",
    { reason: "尚未付款取消" },
    ver(2),
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM notifications WHERE title='预约取消，费用需核对'",
      )
      .get().n,
    0,
  );
  const second = (await seedLegacyBooking(f, f.owner, booking({ slot: 2 })))
    .data.id;
  await f.approve(second);
  await f.finance.request(`/casework/${second}/fee`, "POST", {
    action: "issue",
    amountFen: 100,
    instructions: "单位窗口",
    note: "收费依据",
  });
  await f.finance.request(
    `/casework/${second}/fee`,
    "POST",
    { action: "confirm", note: "核实实际到账" },
    ver(1),
  );
  f.db.prepare("UPDATE users SET disabled=1 WHERE id=?").run(f.financier.id);
  await f.owner.request(
    `/bookings/${second}/cancel`,
    "POST",
    { reason: "需要退款" },
    ver(2),
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM notifications WHERE title='预约取消，费用需核对' AND user_id=?",
      )
      .get(f.financier.id).n,
    0,
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM notifications WHERE title='预约取消，费用需核对'",
      )
      .get().n,
    1,
  );
});
