import test from "node:test";
import assert from "node:assert/strict";
import { fixture, register, manager, staff, booking } from "./helpers.mjs";

const version = (n) => ({ "If-Match": `"${n}"` });
const successful = (response, status = 200) =>
  assert.equal(response.status, status, JSON.stringify(response));

test("生效预约作废重开费用期间保留财务和企业待办，已结清与取消作废不混入", async (t) => {
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
    "void-queue-finance@test.local",
  );
  const ids = {};
  for (const [index, state] of [
    "none",
    "due",
    "submitted",
    "paid",
    "waived",
    "void",
    "cancelledVoid",
  ].entries()) {
    const made = await owner.request(
      "/bookings",
      "POST",
      booking({ slot: index + 1 }),
    );
    successful(made, 201);
    const id = (ids[state] = made.data.id);
    successful(
      await root.request(
        `/bookings/${id}/review`,
        "POST",
        { status: "已通过" },
        version(1),
      ),
    );
    // Completed contact follow-up must not hide an unfinished financial task.
    successful(
      await root.request(
        `/casework/${id}/contact`,
        "POST",
        { state: "reached", note: "已接通并告知审批结论" },
        version(1),
      ),
    );
    if (state === "none") continue;
    successful(
      await finance.request(`/casework/${id}/fee`, "POST", {
        action: state === "waived" ? "waive" : "issue",
        amountFen: 10000,
        instructions: "单位正式收款说明",
        note: "学校收费依据或免缴依据",
      }),
    );
    if (state === "submitted")
      successful(
        await owner.request(
          `/casework/${id}/fee`,
          "POST",
          { action: "submit", reference: "2026-10-24 银行流水 TEST-10000" },
          version(1),
        ),
      );
    if (state === "paid")
      successful(
        await finance.request(
          `/casework/${id}/fee`,
          "POST",
          { action: "confirm", note: "单位银行账户已核实到账" },
          version(1),
        ),
      );
    if (state === "void")
      successful(
        await finance.request(
          `/casework/${id}/fee`,
          "POST",
          { action: "void", note: "原金额有误，作废后重新安排" },
          version(1),
        ),
      );
    if (state === "cancelledVoid")
      successful(
        await owner.request(
          `/bookings/${id}/cancel`,
          "POST",
          { reason: "活动取消" },
          version(2),
        ),
      );
  }
  const expected = [ids.none, ids.due, ids.submitted, ids.void].sort();
  for (const actor of [finance, owner]) {
    const queue = await actor.request("/casework?scope=open");
    successful(queue);
    assert.equal(queue.data.total, 4);
    assert.deepEqual(queue.data.items.map((item) => item.id).sort(), expected);
    const all = await actor.request("/casework?scope=all");
    successful(all);
    assert.equal(all.data.total, 7);
  }
  // Reissuing uses the current fee version; a final waiver clears the task.
  successful(
    await finance.request(
      `/casework/${ids.void}/fee`,
      "POST",
      {
        action: "waive",
        note: "重新核对后按学校规则免缴",
      },
      version(2),
    ),
  );
  for (const actor of [finance, owner]) {
    const queue = await actor.request("/casework?scope=open");
    successful(queue);
    assert.equal(queue.data.total, 3);
    assert.ok(!queue.data.items.some((item) => item.id === ids.void));
  }
});
