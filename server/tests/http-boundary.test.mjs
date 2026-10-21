import test from "node:test";
import assert from "node:assert/strict";
import { fixture, manager, TODAY } from "./helpers.mjs";

test("明确允许的跨源管理页面可以预检并更新日历，未授权来源仍被拒绝", async (t) => {
  const allowed = "https://office.example.test";
  const f = await fixture(t, ":memory:", { allowedOrigins: allowed });
  const root = f.client();
  await manager(root);
  const url = `${f.origin}/api/casework/calendar/${TODAY()}`;
  const preflight = await fetch(url, {
    method: "OPTIONS",
    headers: {
      Origin: allowed,
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "content-type,x-csrf-token,if-match",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), allowed);
  assert.equal(
    preflight.headers.get("access-control-allow-credentials"),
    "true",
  );
  assert.ok(
    preflight.headers
      .get("access-control-allow-methods")
      .split(/,\s*/)
      .includes("PUT"),
  );
  assert.ok(
    preflight.headers.get("access-control-allow-headers").includes("If-Match"),
  );
  assert.equal(
    (
      await root.request(
        `/casework/calendar/${TODAY()}`,
        "PUT",
        { working: false },
        { Origin: allowed, "If-Match": '"1"' },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(url, {
        method: "OPTIONS",
        headers: {
          Origin: "https://untrusted.example.test",
          "Access-Control-Request-Method": "PUT",
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await root.request(
        `/casework/calendar/${TODAY()}`,
        "PUT",
        { working: true },
        { Origin: allowed, "If-Match": '"2"', "X-CSRF-Token": "invalid" },
      )
    ).status,
    403,
  );
});
