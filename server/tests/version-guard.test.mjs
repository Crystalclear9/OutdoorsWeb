import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, manager, register, booking } from "./helpers.mjs";

const version = (n) => ({ "If-Match": `"${n}"` });

test("单条审批和撤回必须携带最新版本，缺失、畸形和过期请求不改变申请或审计", async (t) => {
  const { client, db } = await fixture(t),
    root = client(),
    owner = client();
  await manager(root);
  await register(owner);
  for (const action of ["review", "withdraw"]) {
    const id = (
        await owner.request(
          "/bookings",
          "POST",
          booking({ slot: action === "review" ? 1 : 2 }),
        )
      ).data.id,
      actor = action === "review" ? root : owner,
      body = action === "review" ? { status: "已通过" } : undefined,
      route = `/bookings/${id}/${action}`,
      before = db.prepare("SELECT COUNT(*) n FROM audit").get().n;
    for (const [headers, status] of [
      [{}, 428],
      [{ "If-Match": "1" }, 400],
      [version(2), 409],
    ]) {
      assert.equal(
        (await actor.request(route, "POST", body, headers)).status,
        status,
      );
      assert.equal(
        db.prepare("SELECT status FROM bookings WHERE id=?").get(id).status,
        "待审核",
      );
      assert.equal(db.prepare("SELECT COUNT(*) n FROM audit").get().n, before);
    }
    assert.equal(
      (await actor.request(route, "POST", body, version(1))).status,
      200,
    );
    assert.equal(
      (await actor.request(route, "POST", body, version(1))).status,
      409,
    );
  }
});

test("账号停启用和密码重置必须携带最新版本，旧页面不能覆盖账号的新状态", async (t) => {
  const { client, db } = await fixture(t),
    root = client(),
    owner = client();
  await manager(root);
  const user = await register(owner),
    route = `/users/${user.id}`;
  for (const [action, payload] of [
    ["status", { disabled: true }],
    ["reset-password", undefined],
  ]) {
    const original = db
      .prepare("SELECT password_hash,disabled,version FROM users WHERE id=?")
      .get(user.id);
    for (const [headers, status] of [
      [{}, 428],
      [{ "If-Match": "1" }, 400],
      [version(2), 409],
    ]) {
      assert.equal(
        (await root.request(`${route}/${action}`, "POST", payload, headers))
          .status,
        status,
      );
      assert.deepEqual(
        db
          .prepare(
            "SELECT password_hash,disabled,version FROM users WHERE id=?",
          )
          .get(user.id),
        original,
      );
      assert.equal(
        (await owner.request("/auth/session")).data.user.id,
        user.id,
      );
    }
  }
  assert.equal(
    (
      await root.request(
        `${route}/status`,
        "POST",
        { disabled: true },
        version(1),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await root.request(
        `${route}/status`,
        "POST",
        { disabled: false },
        version(1),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await root.request(
        `${route}/reset-password`,
        "POST",
        undefined,
        version(1),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await root.request(
        `${route}/status`,
        "POST",
        { disabled: false },
        version(2),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await root.request(
        `${route}/reset-password`,
        "POST",
        undefined,
        version(3),
      )
    ).status,
    200,
  );
  assert.equal(
    db.prepare("SELECT version,must_change FROM users WHERE id=?").get(user.id)
      .version,
    4,
  );
});
