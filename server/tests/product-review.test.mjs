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
  const f = await fixture(t),
    root = f.client(),
    owner = f.client(),
    finance = f.client(),
    reviewer = f.client();
  await manager(root);
  await register(owner);
  await staff(root, finance, ["payments.manage"], "late-finance@test.local");
  await staff(root, reviewer, ["bookings.review"], "late-reviewer@test.local");
  const id = (await seedLegacyBooking(f, owner, booking())).data.id;
  assert.equal(
    (
      await root.request(
        `/bookings/${id}/review`,
        "POST",
        { status: "已通过" },
        ver(1),
      )
    ).status,
    200,
  );
  return { ...f, root, owner, finance, reviewer, id };
}
test("取消后迟到款项仅财务凭最新版本、到账流水及依据登记，进入退款待办并闭环", async (t) => {
  const f = await setup(t),
    route = `/casework/${f.id}/fee`;
  await f.finance.request(route, "POST", {
    action: "issue",
    amountFen: 12345,
    instructions: "学校财务窗口",
    note: "收费依据",
  });
  await f.owner.request(
    `/bookings/${f.id}/cancel`,
    "POST",
    { reason: "活动取消" },
    ver(2),
  );
  const payload = {
    action: "late_confirm",
    reference: "BANK-LATE-123",
    note: "核对单位银行账户，取消后实际入账",
  };
  assert.equal(
    (await f.owner.request(route, "POST", payload, ver(2))).status,
    403,
  );
  assert.equal(
    (await f.reviewer.request(route, "POST", payload, ver(2))).status,
    403,
  );
  assert.equal((await f.finance.request(route, "POST", payload)).status, 428);
  assert.equal(
    (await f.finance.request(route, "POST", payload, ver(1))).status,
    409,
  );
  assert.equal(
    (
      await f.finance.request(
        route,
        "POST",
        { ...payload, reference: "" },
        ver(2),
      )
    ).status,
    400,
  );
  assert.equal(
    (await f.finance.request(route, "POST", { ...payload, note: "" }, ver(2)))
      .status,
    400,
  );
  assert.equal(
    (await f.finance.request(route, "POST", payload, ver(2))).status,
    200,
  );
  assert.equal(
    (await f.finance.request(route, "POST", payload, ver(2))).status,
    409,
  );
  const queue = (await f.finance.request("/casework?scope=open")).data;
  assert.equal(queue.items.find((r) => r.id === f.id).fee.state, "paid");
  assert.equal(
    (
      await f.finance.request(
        route,
        "POST",
        { action: "refund", note: "已线下全额退款，REFUND-LATE-123" },
        ver(3),
      )
    ).status,
    200,
  );
  const fee = (await f.owner.request(`/casework/${f.id}`)).data.item.fee;
  assert.equal(fee.state, "refunded");
  assert.equal(fee.reference, "BANK-LATE-123");
  assert.ok(
    f.db
      .prepare(
        "SELECT * FROM audit WHERE action='case.fee_late_confirm' AND target=?",
      )
      .get(f.id),
  );
});
test("电话完成登记必须显式纠正，保留审计、恢复待办且不能重放或越权", async (t) => {
  const f = await setup(t),
    route = `/casework/${f.id}/contact`;
  await f.root.request(
    route,
    "POST",
    { state: "reached", note: "原电话登记" },
    ver(1),
  );
  assert.equal(
    (
      await f.root.request(
        route,
        "POST",
        { state: "unreachable", note: "覆盖" },
        ver(2),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await f.owner.request(
        route,
        "POST",
        { action: "reopen", note: "无权" },
        ver(2),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.finance.request(
        route,
        "POST",
        { action: "reopen", note: "无权" },
        ver(2),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.reviewer.request(
        route,
        "POST",
        { action: "reopen", note: "" },
        ver(2),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.reviewer.request(
        route,
        "POST",
        { action: "reopen", note: "误选接通，实际需继续联系" },
        ver(2),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await f.reviewer.request(
        route,
        "POST",
        { action: "reopen", note: "重复" },
        ver(2),
      )
    ).status,
    409,
  );
  const item = (await f.reviewer.request(`/casework/${f.id}`)).data.item;
  assert.equal(item.contactResult.state, "unreachable");
  assert.equal(item.contactResult.reached_at, null);
  assert.equal(item.contactResult.attempts, 1);
  assert.ok(
    (await f.reviewer.request("/casework?scope=open")).data.items.some(
      (r) => r.id === f.id,
    ),
  );
  assert.ok(
    f.db
      .prepare(
        "SELECT * FROM audit WHERE action='case.contact_reopened' AND target=?",
      )
      .get(f.id),
  );
  assert.equal(
    (
      await f.reviewer.request(
        route,
        "POST",
        { state: "reached", note: "重新拨通并告知" },
        ver(3),
      )
    ).status,
    200,
  );
});
