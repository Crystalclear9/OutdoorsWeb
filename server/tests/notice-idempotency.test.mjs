import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fixture, manager, staff } from "./helpers.mjs";
import { hashToken } from "../security.mjs";
import { listenHttp } from "./http-listen.mjs";
const payload = { title: "幂等公告", content: "通知正文", pinned: true };
const headers = (key) => ({ "Idempotency-Key": key });

test("公告已落库但响应丢失，同创建键重试只产生一条公告和一条审计", async (t) => {
  const f = await fixture(t),
    c = f.client();
  await manager(c);
  const key = "notice-lost-response-12345";
  let first;
  const proxy = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const part of req) chunks.push(part);
    const response = await fetch(f.origin + req.url, {
      method: "POST",
      headers: {
        ...c.headers,
        ...headers(key),
        "Content-Type": "application/json",
      },
      body: Buffer.concat(chunks),
    });
    first = { status: response.status, data: await response.json() };
    res.destroy();
  });
  await listenHttp(proxy);
  t.after(async () => {
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
  });
  await assert.rejects(() =>
    fetch(`http://127.0.0.1:${proxy.address().port}/api/notices`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  );
  assert.equal(first.status, 200);
  const retry = await c.request("/notices", "POST", payload, headers(key));
  assert.equal(retry.status, 200);
  assert.equal(retry.data.id, first.data.id);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM notices WHERE id=?").get(first.data.id)
      .n,
    1,
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM audit WHERE action='notice.saved' AND target=?",
      )
      .get(first.data.id).n,
    1,
  );
});

test("同actor并发创建幂等、载荷冲突和无键兼容；不同actor及主动新意图可发相同公告", async (t) => {
  const f = await fixture(t),
    c = f.client(),
    other = f.client();
  await manager(c);
  await staff(c, other, ["notices.manage"], "notice-staff@test.local");
  const key = "notice-concurrent-1234567";
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      c.request("/notices", "POST", payload, headers(key)),
    ),
  );
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(new Set(results.map((r) => r.data.id)).size, 1);
  const id = results[0].data.id;
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM audit WHERE action='notice.saved' AND target=?",
      )
      .get(id).n,
    1,
  );
  assert.equal(
    (
      await c.request(
        "/notices",
        "POST",
        { ...payload, pinned: false },
        headers(key),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await c.request(
        "/notices",
        "POST",
        { ...payload, content: "改动" },
        headers(key),
      )
    ).status,
    409,
  );
  const another = await other.request(
    "/notices",
    "POST",
    payload,
    headers(key),
  );
  assert.equal(another.status, 200);
  assert.notEqual(another.data.id, id);
  const fresh = await c.request(
    "/notices",
    "POST",
    payload,
    headers("notice-new-intent-123456"),
  );
  assert.equal(fresh.status, 200);
  assert.notEqual(fresh.data.id, id);
  const old1 = await c.request("/notices", "POST", payload),
    old2 = await c.request("/notices", "POST", payload);
  assert.equal(old1.status, 200);
  assert.notEqual(old1.data.id, old2.data.id);
  for (const invalid of ["short", "!".repeat(20), "a".repeat(129)])
    assert.equal(
      (await c.request("/notices", "POST", payload, headers(invalid))).status,
      400,
    );
});

test("共享幂等表的其他操作键不可当公告键回放", async (t) => {
  const f = await fixture(t),
    c = f.client();
  const u = await manager(c),
    key = "cross-operation-key-1234";
  f.db
    .prepare("INSERT INTO idempotency VALUES(?,?,?,?,?)")
    .run(
      u.id,
      key,
      hashToken("booking request fingerprint"),
      JSON.stringify({ id: "unrelated-booking-id" }),
      Date.now(),
    );
  const count = f.db.prepare("SELECT COUNT(*) n FROM notices").get().n;
  assert.equal(
    (await c.request("/notices", "POST", payload, headers(key))).status,
    409,
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notices").get().n, count);
});

test("等待请求体期间撤权，创建与既有幂等结果回放均在写事务重新授权", async (t) => {
  const f = await fixture(t),
    root = f.client(),
    writer = f.client();
  await manager(root);
  const user = await staff(
    root,
    writer,
    ["notices.manage"],
    "notice-revoked@test.local",
  );
  const key = "notice-revoked-replay-1234",
    existing = await writer.request("/notices", "POST", payload, headers(key));
  assert.equal(existing.status, 200);
  let started;
  const read = new Promise((resolve) => {
    started = resolve;
  });
  const observe = (req) => {
    if (req.headers["x-notice-probe"] === "yes")
      req.once("data", () => started());
  };
  f.server.prependListener("request", observe);
  t.after(() => f.server.off("request", observe));
  const bytes = JSON.stringify(payload);
  let request;
  const pending = new Promise((resolve, reject) => {
    request = http.request(
      f.origin + "/api/notices",
      {
        method: "POST",
        headers: {
          ...writer.headers,
          ...headers(key),
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(bytes),
          "X-Notice-Probe": "yes",
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (x) => chunks.push(x));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            data: JSON.parse(Buffer.concat(chunks)),
          }),
        );
      },
    );
    request.on("error", reject);
    request.write(bytes.slice(0, 10));
  });
  await read;
  f.db
    .prepare(
      "DELETE FROM user_permissions WHERE user_id=? AND permission='notices.manage'",
    )
    .run(user.id);
  request.end(bytes.slice(10));
  assert.equal((await pending).status, 403);
  assert.equal(
    (
      await writer.request(
        "/notices",
        "POST",
        payload,
        headers("notice-after-revoke-1234"),
      )
    ).status,
    403,
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM audit WHERE action='notice.saved' AND actor=?",
      )
      .get(user.id).n,
    1,
  );
});
