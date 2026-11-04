import test from "node:test";
import assert from "node:assert/strict";
import { fixture, register, booking, IMAGE, manager } from "./helpers.mjs";
import { createDraftRoutes } from "../draft-routes.mjs";
import { createSecurity } from "../core.mjs";
import { openStore } from "../store.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const values = () => {
  const { image, slot, ...payload } = booking();
  return payload;
};
const match = (draft) => ({ "If-Match": `"${draft.version}"` });

test("草稿存入SQLite，关闭数据库重开仍可恢复字段和设计图", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "outdoors-draft-persist-")),
    filename = path.join(dir, "app.sqlite");
  let db = openStore(filename);
  t.after(async () => {
    db.close();
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("outdoors-draft-persist-"));
    await rm(dir, { recursive: true, force: true });
  });
  db.prepare(
    "INSERT INTO users(id,email,password_hash,role,company,contact,phone,created) VALUES('owner','owner@persist.test','unused','enterprise','公司','联系','13800138000',?)",
  ).run(new Date().toISOString());
  const sec = {
    current: () => ({ id: "owner" }),
    write: (_req, _permission, fn) => fn({ id: "owner" }),
    limit: () => {},
  };
  let result;
  const req = {
    method: "POST",
    headers: { "content-type": "application/json" },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(
        JSON.stringify({ payload: { company: "数据库恢复" }, image: IMAGE }),
      );
    },
  };
  await createDraftRoutes(
    db,
    sec,
    (_res, data) => {
      result = data;
    },
    { health: () => ({ ok: true }) },
  )(req, {}, new URL("http://local/api/drafts"));
  const id = result.draft.id;
  db.close();
  db = openStore(filename);
  await createDraftRoutes(
    db,
    sec,
    (_res, data) => {
      result = data;
    },
    { health: () => ({ ok: true }) },
  )({ method: "GET" }, {}, new URL(`http://local/api/drafts/${id}`));
  assert.equal(result.draft.payload.company, "数据库恢复");
  assert.match(result.draft.image, /^data:image\/webp;base64,/);
});

test("草稿按企业私有保存部分字段与设计图，刷新会话恢复，版本竞争不覆盖，删除需版本", async (t) => {
  const f = await fixture(t),
    a = f.client(),
    b = f.client(),
    root = f.client();
  await register(a);
  await register(b, "other-draft@test.local");
  await manager(root);
  const made = await a.request("/drafts", "POST", {
    id: "persistent-draft",
    payload: { company: "未完成草稿" },
    image: IMAGE,
  });
  assert.equal(made.status, 201);
  const draft = made.data.draft;
  assert.match(draft.image, /^data:image\/(png|webp);base64,/);
  assert.equal((await b.request(`/drafts/${draft.id}`)).status, 404);
  assert.equal(
    (await b.request(`/drafts/${draft.id}`, "DELETE", undefined, match(draft)))
      .status,
    404,
  );
  assert.equal((await root.request("/drafts")).status, 403);
  assert.equal((await a.request("/auth/session")).status, 200);
  assert.equal(
    (await a.request(`/drafts/${draft.id}`)).data.draft.payload.company,
    "未完成草稿",
  );
  const concurrent = await Promise.all(
    ["first", "second"].map((company) =>
      a.request(
        `/drafts/${draft.id}`,
        "PATCH",
        { payload: { company } },
        match(draft),
      ),
    ),
  );
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (await a.request(`/drafts/${draft.id}`, "DELETE", undefined, match(draft)))
      .status,
    409,
  );
  const latest = (await a.request(`/drafts/${draft.id}`)).data.draft;
  assert.ok(latest.image, "PATCH省略图片应保留原图");
  assert.equal(
    (await a.request(`/drafts/${draft.id}`, "DELETE", undefined, match(latest)))
      .status,
    200,
  );
  assert.equal((await a.request(`/drafts/${draft.id}`)).status, 404);
});

test("草稿图片完整解码、字段边界和存储门禁；保存失败不改变已存草稿", async (t) => {
  const f = await fixture(t),
    a = f.client();
  await register(a);
  const made = await a.request("/drafts", "POST", {
    payload: values(),
    image: IMAGE,
  });
  const draft = made.data.draft;
  assert.equal(made.status, 201);
  assert.equal(
    (
      await a.request(
        `/drafts/${draft.id}`,
        "PATCH",
        { payload: values(), image: "data:image/png;base64,aGVsbG8=" },
        match(draft),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await a.request("/drafts", "POST", {
        payload: { company: "a".repeat(81) },
      })
    ).status,
    400,
  );
  const sec = createSecurity(f.db, false),
    blocked = createDraftRoutes(
      f.db,
      sec,
      () => {
        throw Error("unexpected send");
      },
      { health: () => ({ ok: false }) },
    );
  const req = {
    method: "PATCH",
    url: `/api/drafts/${draft.id}`,
    headers: Object.fromEntries(
      Object.entries({
        ...a.headers,
        "content-type": "application/json",
        ...match(draft),
      }).map(([key, value]) => [key.toLowerCase(), value]),
    ),
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ payload: { company: "不应保存" } }));
    },
  };
  await assert.rejects(
    () => blocked(req, {}, new URL(req.url, f.origin)),
    (e) => e.status === 503,
  );
  const unchanged = (await a.request(`/drafts/${draft.id}`)).data.draft;
  assert.equal(unchanged.version, draft.version);
  assert.equal(unchanged.payload.company, draft.payload.company);
});

test("退回复制生成新申请且保留原审核，提交原子清理草稿、幂等重试返回同一结果", async (t) => {
  const f = await fixture(t),
    a = f.client(),
    other = f.client(),
    root = f.client();
  await register(a);
  await register(other, "copy-other@test.local");
  await manager(root);
  const original = await a.request("/bookings", "POST", booking());
  assert.equal(original.status, 201);
  const id = original.data.id;
  assert.equal(
    (
      await a.request("/drafts", "POST", {
        payload: { ...values(), source_booking_id: id },
      })
    ).status,
    409,
  );
  const reviewed = await root.request(
    `/bookings/${id}/review`,
    "POST",
    { status: "未通过", reason: "请修改设计图" },
    { "If-Match": '"1"' },
  );
  assert.equal(reviewed.status, 200);
  assert.equal(
    (
      await other.request("/drafts", "POST", {
        payload: { source_booking_id: id },
      })
    ).status,
    404,
  );
  const draft = (
    await a.request("/drafts", "POST", {
      payload: { ...values(), source_booking_id: id },
      image: IMAGE,
    })
  ).data.draft;
  const input = booking({
    source_booking_id: id,
    draftId: draft.id,
    draftVersion: draft.version,
  });
  const key = { "Idempotency-Key": "draft-submit-stable-12345" };
  const submitted = await a.request("/bookings", "POST", input, key);
  assert.equal(submitted.status, 201);
  assert.equal((await a.request(`/drafts/${draft.id}`)).status, 404);
  const repeated = await a.request("/bookings", "POST", input, key);
  assert.equal(repeated.status, 201);
  assert.equal(repeated.data.id, submitted.data.id);
  const old = f.db
    .prepare("SELECT status,reason,version FROM bookings WHERE id=?")
    .get(id);
  assert.deepEqual(
    { ...old },
    { status: "未通过", reason: "请修改设计图", version: 2 },
  );
  assert.equal(
    f.db
      .prepare("SELECT source_booking_id FROM bookings WHERE id=?")
      .get(submitted.data.id).source_booking_id,
    id,
  );
  assert.throws(
    () =>
      f.db
        .prepare("UPDATE bookings SET source_booking_id=NULL WHERE id=?")
        .run(submitted.data.id),
    /IMMUTABLE/,
  );
});

test("提交旧版本或其他企业草稿失败，草稿和审核记录均不丢失", async (t) => {
  const f = await fixture(t),
    a = f.client(),
    b = f.client();
  await register(a);
  await register(b, "draft-attacker@test.local");
  const draft = (
    await a.request("/drafts", "POST", { payload: values(), image: IMAGE })
  ).data.draft;
  await a.request(
    `/drafts/${draft.id}`,
    "PATCH",
    { payload: { ...values(), contact: "新联系人" } },
    match(draft),
  );
  assert.equal(
    (
      await a.request(
        "/bookings",
        "POST",
        booking({ draftId: draft.id, draftVersion: draft.version }),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await b.request(
        "/bookings",
        "POST",
        booking({ draftId: draft.id, draftVersion: 2 }),
      )
    ).status,
    404,
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM bookings").get().n, 0);
  assert.equal(
    (await a.request(`/drafts/${draft.id}`)).data.draft.payload.contact,
    "新联系人",
  );
});
