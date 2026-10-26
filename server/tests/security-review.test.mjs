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

test("独立财务不能读取或操作未审批与退回申请，审核与企业归属权限保持有效", async (t) => {
  const f = await fixture(t),
    root = f.client(),
    owner = f.client(),
    other = f.client(),
    finance = f.client(),
    reviewer = f.client();
  await manager(root);
  await register(owner);
  await register(other, "security-other@test.local");
  await staff(
    root,
    finance,
    ["payments.manage"],
    "security-finance@test.local",
  );
  await staff(
    root,
    reviewer,
    ["bookings.review"],
    "security-reviewer@test.local",
  );
  const pending = (await seedLegacyBooking(f, owner, booking())).data.id;
  const rejected = (await seedLegacyBooking(f, owner, booking({ slot: 2 })))
    .data.id;
  assert.equal(
    (
      await reviewer.request(
        `/bookings/${rejected}/review`,
        "POST",
        {
          status: "未通过",
          reason: "资料需调整",
        },
        ver(1),
      )
    ).status,
    200,
  );
  for (const scope of ["open", "all"])
    assert.equal(
      (await finance.request(`/casework?scope=${scope}`)).data.total,
      0,
    );
  for (const id of [pending, rejected]) {
    assert.equal((await finance.request(`/casework/${id}`)).status, 403);
    assert.equal(
      (
        await finance.request(`/casework/${id}/fee`, "POST", {
          action: "issue",
          amountFen: 100,
          instructions: "财务窗口",
          note: "收费依据",
        })
      ).status,
      403,
    );
    assert.equal((await reviewer.request(`/casework/${id}`)).status, 200);
    assert.equal((await owner.request(`/casework/${id}`)).status, 200);
    assert.equal((await other.request(`/casework/${id}`)).status, 404);
  }
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM booking_fees").get().n, 0);
});

test("独立财务保留已批准、取消及退款费用的完整追溯权限", async (t) => {
  const f = await fixture(t),
    root = f.client(),
    owner = f.client(),
    finance = f.client();
  await manager(root);
  await register(owner);
  await staff(
    root,
    finance,
    ["payments.manage"],
    "security-finance@test.local",
  );
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
  assert.equal((await finance.request(`/casework/${id}`)).status, 200);
  assert.equal(
    (
      await finance.request(`/casework/${id}/fee`, "POST", {
        action: "issue",
        amountFen: 100,
        instructions: "财务窗口",
        note: "核准收费",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await finance.request(
        `/casework/${id}/fee`,
        "POST",
        {
          action: "confirm",
          note: "核实银行实际到账",
        },
        ver(1),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await owner.request(
        `/bookings/${id}/cancel`,
        "POST",
        { reason: "取消活动" },
        ver(2),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await finance.request(
        `/casework/${id}/fee`,
        "POST",
        {
          action: "refund",
          note: "银行已全额退回",
        },
        ver(2),
      )
    ).status,
    200,
  );
  const detail = await finance.request(`/casework/${id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.item.fee.state, "refunded");
  assert.deepEqual(
    (await finance.request("/casework?scope=all")).data.items.map((r) => r.id),
    [id],
  );
  assert.equal((await finance.request("/casework?scope=open")).data.total, 0);
});
