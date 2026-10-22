import test from "node:test";
import assert from "node:assert/strict";
import { fixture, register, manager, booking } from "./helpers.mjs";
import { createDelivery } from "../delivery.mjs";

for (const outcome of ["accepted", "failed"])
  test(`服务商迟到${outcome}结果不能覆盖人工核实已受理的新版任务`, async (t) => {
    const f = await fixture(t),
      owner = f.client(),
      root = f.client(),
      user = await register(owner);
    await manager(root);
    const made = await owner.request("/bookings", "POST", booking());
    assert.equal(made.status, 201);
    const id = made.data.id;
    assert.equal(
      (
        await root.request(
          `/bookings/${id}/review`,
          "POST",
          { status: "已通过" },
          { "If-Match": '"1"' },
        )
      ).status,
      200,
    );
    f.db
      .prepare("INSERT INTO verified_phones VALUES('13800138000',?)")
      .run(user.id);
    f.db.prepare("INSERT INTO contact_preferences VALUES(?,1,1)").run(user.id);
    f.db
      .prepare(
        "INSERT INTO delivery_jobs(id,kind,payload,next_at,created) VALUES('race-job','voice',?,0,?)",
      )
      .run(
        JSON.stringify({
          userId: user.id,
          bookingId: id,
          phone: "13800138000",
          message: "结果通知",
        }),
        new Date().toISOString(),
      );
    let complete,
      sent = 0;
    const pending = new Promise((resolve, reject) => {
      complete = () =>
        outcome === "accepted"
          ? resolve("late-provider-id")
          : reject(Object.assign(new Error("迟到拒绝响应"), { status: 503 }));
    });
    const first = createDelivery(f.db, f.maintenance, {
      scheduled: false,
      sendPhone: () => {
        sent++;
        return pending;
      },
    });
    const second = createDelivery(f.db, f.maintenance, { scheduled: false });
    const running = first.run();
    try {
      assert.equal(sent, 1);
      // Simulate a stalled sender exceeding its lease while another worker runs.
      f.db
        .prepare("UPDATE delivery_jobs SET next_at=0 WHERE id='race-job'")
        .run();
      await second.run();
      const uncertain = f.db
        .prepare("SELECT state,version FROM delivery_jobs WHERE id='race-job'")
        .get();
      assert.equal(uncertain.state, "uncertain");
      assert.equal(
        (
          await root.request("/operations/deliveries/race-job", "POST", {
            action: "accepted",
            reason: "已核对服务商，确认受理",
            version: uncertain.version,
          })
        ).status,
        200,
      );
      const checked = f.db
        .prepare("SELECT * FROM delivery_jobs WHERE id='race-job'")
        .get();
      complete();
      await running;
      const after = f.db
        .prepare("SELECT * FROM delivery_jobs WHERE id='race-job'")
        .get();
      assert.deepEqual(after, checked);
      await first.run();
      assert.equal(sent, 1);
      const audit = f.db
        .prepare(
          "SELECT details FROM audit WHERE action='delivery.late_result' AND target='race-job'",
        )
        .all();
      assert.equal(audit.length, 1);
      assert.equal(
        JSON.parse(audit[0].details).state,
        outcome === "accepted" ? "accepted" : "pending",
      );
    } finally {
      complete();
      await running;
      await first.close();
      await second.close();
    }
  });
