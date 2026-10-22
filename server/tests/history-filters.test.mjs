import test from "node:test";
import assert from "node:assert/strict";
import { fixture, register, manager, staff, booking } from "./helpers.mjs";

test("申请按北京时间提交日期含首尾整天过滤，保持企业归属与无效日期校验", async (t) => {
  const f = await fixture(t),
    owner = f.client(),
    other = f.client(),
    root = f.client();
  await register(owner);
  await register(other, "other-history@test.local");
  await manager(root);
  const dates = [
      "2026-10-20T15:59:59.999Z",
      "2026-10-20T16:00:00.000Z",
      "2026-10-21T15:59:59.999Z",
      "2026-10-21T16:00:00.000Z",
      "2026-10-21T04:00:00.000Z",
    ],
    ids = [];
  for (let i = 0; i < dates.length; i++) {
    const made = await (i === 4 ? other : owner).request(
      "/bookings",
      "POST",
      booking({ slot: i + 1 }),
    );
    assert.equal(made.status, 201);
    ids.push(made.data.id);
    f.db
      .prepare("UPDATE bookings SET created=? WHERE id=?")
      .run(dates[i], made.data.id);
  }
  const query = "/bookings?from=2026-10-21&to=2026-10-21";
  const mine = await owner.request(query);
  assert.equal(mine.status, 200);
  assert.deepEqual(
    mine.data.items.map((r) => r.id).sort(),
    ids.slice(1, 3).sort(),
  );
  const all = await root.request(query);
  assert.equal(all.data.total, 3);
  assert.deepEqual(
    all.data.items.map((r) => r.id).sort(),
    [ids[1], ids[2], ids[4]].sort(),
  );
  assert.equal(
    (await owner.request("/bookings?from=2026-10-21")).data.total,
    3,
  );
  assert.equal((await owner.request("/bookings?to=2026-10-21")).data.total, 3);
  for (const invalid of [
    "from=2026-02-30",
    "to=garbage",
    "from=2026-10-22&to=2026-10-21",
  ])
    assert.equal((await root.request("/bookings?" + invalid)).status, 400);
});

test("历史操作人筛选仅审核角色可用，保留停用审核人的记录而不泄漏账号资料", async (t) => {
  const f = await fixture(t),
    root = f.client(),
    owner = f.client(),
    reviewer = f.client(),
    reader = f.client();
  await manager(root);
  await register(owner);
  const operator = await staff(
    root,
    reviewer,
    ["bookings.review"],
    "operator-history@test.local",
  );
  await staff(root, reader, ["bookings.review"], "reader-history@test.local");
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const made = await owner.request(
      "/bookings",
      "POST",
      booking({ slot: i + 1 }),
    );
    assert.equal(made.status, 201);
    ids.push(made.data.id);
    assert.equal(
      (
        await (i ? root : reviewer).request(
          `/bookings/${made.data.id}/review`,
          "POST",
          { status: "已通过" },
          { "If-Match": '"1"' },
        )
      ).status,
      200,
    );
  }
  assert.equal(
    (
      await root.request(
        `/users/${operator.id}/status`,
        "POST",
        { disabled: true },
        { "If-Match": `"${operator.version}"` },
      )
    ).status,
    200,
  );
  const options = await reader.request("/bookings/reviewers");
  assert.equal(options.status, 200);
  assert.ok(options.data.items.some((r) => r.id === operator.id));
  for (const item of options.data.items)
    assert.deepEqual(Object.keys(item).sort(), ["id", "name"]);
  const filtered = await reader.request("/bookings?reviewer=" + operator.id);
  assert.equal(filtered.status, 200);
  assert.equal(filtered.data.total, 1);
  assert.equal(filtered.data.items[0].id, ids[0]);
  assert.equal(filtered.data.items[0].reviewerName, operator.contact);
  assert.equal((await owner.request("/bookings/reviewers")).status, 403);
  assert.equal(
    (await owner.request("/bookings?reviewer=" + operator.id)).status,
    403,
  );
  const own = await owner.request("/bookings");
  for (const item of own.data.items) {
    assert.equal(Object.hasOwn(item, "reviewer"), false);
    assert.equal(Object.hasOwn(item, "reviewerName"), false);
  }
  assert.equal(
    (await reader.request("/bookings?reviewer=nonexistent")).data.total,
    0,
  );
});
