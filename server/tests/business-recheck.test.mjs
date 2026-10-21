import test from "node:test";
import assert from "node:assert/strict";
import { fixture, manager, register, booking } from "./helpers.mjs";

const ver = (n) => ({ "If-Match": `"${n}"` });

test("改期复制设计图遵守磁盘健康门禁，失败不创建半成品且恢复后可重试", async (t) => {
  const f = await fixture(t),
    root = f.client(),
    owner = f.client();
  await manager(root);
  await register(owner);
  const made = await owner.request("/bookings", "POST", booking());
  assert.equal(made.status, 201);
  const id = made.data.id;
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
  const counts = () => ({
    bookings: f.db.prepare("SELECT COUNT(*) n FROM bookings").get().n,
    contacts: f.db.prepare("SELECT COUNT(*) n FROM case_contacts").get().n,
    notices: f.db.prepare("SELECT COUNT(*) n FROM notifications").get().n,
    audits: f.db.prepare("SELECT COUNT(*) n FROM audit").get().n,
  });
  const before = counts(),
    health = f.maintenance.health;
  let probes = [];
  f.maintenance.health = (probe) => {
    probes.push(probe);
    return { ok: false, database: true, freeBytes: 0 };
  };
  const payload = { start: booking().start, end: booking().end, slot: 2 };
  const failed = await owner.request(
    `/bookings/${id}/reschedule`,
    "POST",
    payload,
    ver(2),
  );
  assert.equal(failed.status, 503);
  assert.match(failed.data.error, /空间不足/);
  assert.deepEqual(probes, [false]);
  assert.deepEqual(counts(), before);
  assert.deepEqual(
    {
      ...f.db
        .prepare("SELECT cancelled,version FROM bookings WHERE id=?")
        .get(id),
    },
    { cancelled: 0, version: 2 },
  );
  f.maintenance.health = health;
  const retried = await owner.request(
    `/bookings/${id}/reschedule`,
    "POST",
    payload,
    ver(2),
  );
  assert.equal(retried.status, 201);
  const child = f.db
    .prepare("SELECT reschedule_of,status FROM bookings WHERE id=?")
    .get(retried.data.id);
  assert.equal(child.reschedule_of, id);
  assert.equal(child.status, "待审核");
});
