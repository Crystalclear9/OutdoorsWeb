import test from "node:test";
import assert from "node:assert/strict";
import { fixture, manager, register } from "./helpers.mjs";

test("旧异常通知可筛选、分页并核实，末页清空自动回退", async (t) => {
  const f = await fixture(t),
    root = f.client(),
    owner = f.client();
  await manager(root);
  await register(owner);
  const insert = f.db.prepare(
    "INSERT INTO delivery_jobs(id,kind,payload,state,next_at,created) VALUES(?,?,?,?,?,?)",
  );
  const payload = JSON.stringify({
    phone: "13800138000",
    bookingId: "historical-booking",
  });
  for (let i = 0; i < 51; i++)
    insert.run(
      `old-${String(i).padStart(3, "0")}`,
      "sms",
      payload,
      i % 2 ? "failed" : "uncertain",
      0,
      "2026-01-01T00:00:00.000Z",
    );
  for (let i = 0; i < 50; i++)
    insert.run(
      `new-${i}`,
      "sms",
      payload,
      "accepted",
      0,
      "2026-02-01T00:00:00.000Z",
    );
  const first = (await root.request("/operations/deliveries?scope=attention"))
    .data;
  const second = (
    await root.request("/operations/deliveries?scope=attention&page=2")
  ).data;
  assert.equal(first.total, 51);
  assert.equal(first.pages, 2);
  assert.equal(first.items.length, 50);
  assert.equal(second.items.length, 1);
  assert.equal(
    new Set([...first.items, ...second.items].map((r) => r.id)).size,
    51,
  );
  assert.ok(
    first.items.every((r) => ["failed", "uncertain"].includes(r.state)),
  );
  assert.equal(second.items[0].phone, "138****8000");
  const job = second.items[0];
  assert.equal(
    (
      await root.request(`/operations/deliveries/${job.id}`, "POST", {
        action: "accepted",
        reason: "服务商已确认受理",
        version: job.version,
      })
    ).status,
    200,
  );
  const refreshed = (
    await root.request("/operations/deliveries?scope=attention&page=2")
  ).data;
  assert.equal(refreshed.page, 1);
  assert.equal(refreshed.total, 50);
  assert.ok(!refreshed.items.some((r) => r.id === job.id));
  const history = (
    await root.request("/operations/deliveries?scope=all&page=3")
  ).data;
  assert.equal(history.total, 101);
  assert.equal(history.items.length, 1);
  assert.equal(
    (await root.request("/operations/deliveries?scope=invalid")).status,
    400,
  );
  assert.equal(
    (await owner.request("/operations/deliveries?scope=attention")).status,
    403,
  );
});
