import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, register, manager, staff } from "./helpers.mjs";

test("企业核验权限、隐私、版本与资料变更复核，保留原审批和核验审计", async (t) => {
  const f = await fixture(t),
    root = f.client(),
    owner = f.client(),
    other = f.client(),
    reviewer = f.client();
  await manager(root);
  const user = await register(owner);
  await register(other, "other@company.local");
  await staff(root, reviewer, ["bookings.review"], "verify-review@test.local");
  const path = `/enterprise-verifications/${user.id}`;
  let view = (await owner.request(path)).data;
  assert.equal(view.state, "pending");
  assert.equal((await other.request(path)).status, 403);
  const payload = {
    state: "verified",
    version: 0,
    profileVersion: view.profileVersion,
    evidence: "与企业授权联系人电话核实，内部依据001",
    note: "已核实企业授权联系人",
  };
  assert.equal((await owner.request(path, "POST", payload)).status, 403);
  assert.equal((await reviewer.request(path, "POST", payload)).status, 403);
  assert.equal(
    (await root.request(path, "POST", { ...payload, evidence: "   " })).status,
    400,
  );
  assert.equal((await root.request(path, "POST", payload)).status, 200);
  assert.equal((await root.request(path, "POST", payload)).status, 409);
  view = (await owner.request(path)).data;
  assert.equal(view.state, "verified");
  assert.equal(view.version, 1);
  assert.equal(view.evidence, undefined);
  assert.equal((await reviewer.request(path)).data.evidence, undefined);
  assert.equal((await root.request(path)).data.evidence, payload.evidence);
  const profile = await owner.request("/profile", "PATCH", {
    company: "变更后的核验企业",
    contact: "新联系人",
    phone: "13900139000",
  });
  assert.equal(profile.status, 200);
  const changed = (await owner.request(path)).data;
  assert.equal(changed.state, "needs_review");
  assert.equal(
    (await root.request(path, "POST", { ...payload, version: 1 })).status,
    409,
  );
  assert.equal(
    (
      await root.request(path, "POST", {
        ...payload,
        version: 1,
        profileVersion: changed.profileVersion,
      })
    ).status,
    200,
  );
  assert.equal((await owner.request(path)).data.state, "verified");
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM audit WHERE action='enterprise.verification_updated' AND target=?",
      )
      .get(user.id).n,
    2,
  );
});
