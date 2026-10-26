import test from "node:test";
import assert from "node:assert/strict";
import { fixture, register, manager, booking } from "./helpers.mjs";

async function midnight(t) {
  const RealDate = globalThis.Date;
  let clock = RealDate.parse("2026-10-23T15:59:59.000Z");
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [clock]));
    }
    static now() {
      return clock;
    }
  };
  t.after(() => {
    globalThis.Date = RealDate;
  });
  const f = await fixture(t);
  const owner = f.client(),
    root = f.client();
  await register(owner);
  await manager(root);
  let armed = false;
  const original = f.db.exec.bind(f.db);
  f.db.exec = (sql) => {
    const result = original(sql);
    if (armed && sql === "BEGIN IMMEDIATE") {
      clock += 2000;
      armed = false;
    }
    return result;
  };
  return {
    ...f,
    owner,
    root,
    arm: () => {
      armed = true;
    },
    advance: () => {
      clock += 2000;
    },
  };
}

for (const action of ["booking", "onsite", "reschedule"]) {
  test(`等待写事务跨越北京时间午夜后重新校验${action}日期`, async (t) => {
    const f = await midnight(t);
    let original;
    if (action === "reschedule") {
      const made = await f.owner.request(
        "/bookings",
        "POST",
        booking({ start: "2026-10-25", end: "2026-10-25" }),
      );
      assert.equal(made.status, 201);
      original = made.data.id;
      assert.equal(
        (
          await f.root.request(
            `/bookings/${original}/review`,
            "POST",
            { status: "已通过" },
            { "If-Match": '"1"' },
          )
        ).status,
        200,
      );
    }
    const audits = f.db.prepare("SELECT count(*) n FROM audit").get().n;
    const notifications = f.db
      .prepare("SELECT count(*) n FROM notifications")
      .get().n;
    f.arm();
    const response =
      action === "booking"
        ? await f.owner.request("/bookings", "POST", booking())
        : action === "closure"
          ? await f.root.request("/closures", "POST", {
              slot: 1,
              start: "2026-10-23",
              end: "2026-10-23",
              reason: "暂停开放",
            })
          : action === "onsite"
            ? await f.root.request("/onsite", "POST", {
                date: "2026-10-23",
                items: [
                  { slot: 1, present: true, note: "现场核对", version: 0 },
                ],
              })
            : await f.owner.request(
                `/bookings/${original}/reschedule`,
                "POST",
                { slot: 2, start: "2026-10-23", end: "2026-10-23" },
                { "If-Match": '"2"' },
              );
    assert.equal(response.status, 400, JSON.stringify(response));
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM bookings").get().n,
      original ? 1 : 0,
    );
    assert.equal(f.db.prepare("SELECT count(*) n FROM closures").get().n, 0);
    assert.equal(f.db.prepare("SELECT count(*) n FROM onsite").get().n, 0);
    assert.equal(f.db.prepare("SELECT count(*) n FROM audit").get().n, audits);
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM notifications").get().n,
      notifications,
    );
    if (original)
      assert.equal(
        f.db.prepare("SELECT cancelled FROM bookings WHERE id=?").get(original)
          .cancelled,
        0,
      );
  });
}

test("已完成申请跨午夜重试原幂等请求仍返回原编号，不重复提交", async (t) => {
  const f = await midnight(t);
  const payload = booking(),
    headers = { "Idempotency-Key": "midnight-retry-request-0001" };
  const first = await f.owner.request("/bookings", "POST", payload, headers);
  assert.equal(first.status, 201);
  f.advance();
  const retry = await f.owner.request("/bookings", "POST", payload, headers);
  assert.equal(retry.status, 201, JSON.stringify(retry));
  assert.equal(retry.data.id, first.data.id);
  assert.equal(f.db.prepare("SELECT count(*) n FROM bookings").get().n, 1);
});
