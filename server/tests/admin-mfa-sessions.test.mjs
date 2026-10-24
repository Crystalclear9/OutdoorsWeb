import test from "node:test";
import assert from "node:assert/strict";
import { fixture, manager, register } from "./helpers.mjs";

async function setup(t) {
  const previous = process.env.REQUIRE_ADMIN_MFA;
  process.env.REQUIRE_ADMIN_MFA = "true";
  t.after(() => {
    if (previous === undefined) delete process.env.REQUIRE_ADMIN_MFA;
    else process.env.REQUIRE_ADMIN_MFA = previous;
  });
  return fixture(t);
}

test("要求MFA的管理员未登记时仍可逐个撤销本人其他设备及当前会话", async (t) => {
  const { client } = await setup(t),
    first = client(),
    second = client();
  assert.equal((await manager(first)).mfaRequired, true);
  await manager(second);
  const firstList = await first.request("/auth/sessions"),
    secondList = await second.request("/auth/sessions");
  assert.equal(firstList.status, 200);
  assert.equal(secondList.status, 200);
  const other = secondList.data.items.find((session) => session.current),
    current = firstList.data.items.find((session) => session.current);
  assert.ok(other && current && other.id !== current.id);
  assert.equal(
    (
      await first.request(`/auth/sessions/${other.id}`, "DELETE", undefined, {
        "X-CSRF-Token": "invalid",
      })
    ).status,
    403,
  );
  assert.ok((await second.request("/auth/session")).data.user);
  assert.equal(
    (await first.request(`/auth/sessions/${other.id}`, "DELETE")).status,
    200,
  );
  assert.equal((await second.request("/auth/session")).data.user, null);
  const remaining = await first.request("/auth/sessions");
  assert.equal(remaining.data.items.length, 1);
  assert.equal(remaining.data.items[0].id, current.id);
  assert.equal(
    (await first.request(`/auth/sessions/${current.id}`, "DELETE")).status,
    200,
  );
  assert.equal((await first.request("/auth/session")).data.user, null);
});

test("MFA登记前的单设备退出例外不能撤销他人会话或开放业务接口", async (t) => {
  const { client } = await setup(t),
    admin = client(),
    enterprise = client();
  await manager(admin);
  const owner = await register(enterprise),
    foreign = (await enterprise.request("/auth/sessions")).data.items.find(
      (session) => session.current,
    );
  assert.equal(
    (await admin.request(`/auth/sessions/${foreign.id}`, "DELETE")).status,
    404,
  );
  assert.equal(
    (await enterprise.request("/auth/session")).data.user.id,
    owner.id,
  );
  for (const path of ["/users", "/bookings", "/audit", "/operations"]) {
    assert.equal((await admin.request(path)).status, 403, path);
  }
  assert.equal(
    (await admin.request("/auth/logout-others", "POST")).status,
    200,
  );
  assert.equal((await admin.request("/auth/sessions")).status, 200);
});
