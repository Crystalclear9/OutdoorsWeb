import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import sharp from "sharp";
import { hashToken } from "../security.mjs";
import { fixture, register, manager, booking, IMAGE } from "./helpers.mjs";

const version = (n) => ({ "If-Match": `"${n}"` });
const input = (extra = {}) => booking({ image: undefined, ...extra });
const payload = (extra = {}) => {
  const { image, slot, ...fields } = booking(extra);
  return fields;
};
const jpeg = sharp(randomBytes(1400 * 1400 * 3), {
  raw: { width: 1400, height: 1400, channels: 3 },
})
  .jpeg({ quality: 82 })
  .toBuffer();
async function largeUpload() {
  const bytes = await jpeg;
  assert.ok(bytes.length < 3 * 1024 * 1024);
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}
async function rejected(f, owner, root, image = IMAGE) {
  const made = await owner.request("/bookings", "POST", booking({ image }));
  assert.equal(made.status, 201);
  assert.equal(
    (
      await root.request(
        `/bookings/${made.data.id}/review`,
        "POST",
        { status: "未通过", reason: "调整文字后补正" },
        version(1),
      )
    ).status,
    200,
  );
  return made.data.id;
}

test("已接受的大设计图可从原单或归档复用，草稿续存与提交不重传且幂等", async (t) => {
  for (const archived of [false, true]) {
    await t.test(archived ? "归档原图" : "在线原图", async (t) => {
      const f = await fixture(t),
        owner = f.client(),
        root = f.client();
      await register(owner);
      await manager(root);
      const id = await rejected(f, owner, root, await largeUpload());
      const original = Buffer.from(
        f.db.prepare("SELECT image FROM bookings WHERE id=?").get(id).image,
      );
      assert.ok(original.length > 3 * 1024 * 1024);
      assert.ok(original.length <= 6 * 1024 * 1024);
      if (archived) {
        const at = new Date().toISOString();
        f.db
          .prepare("INSERT INTO archives VALUES(?,?,?,?,?,?,?,?)")
          .run(
            `image-${id}`,
            "image",
            at,
            at,
            1,
            original.length,
            hashToken(original),
            gzipSync(original),
          );
        f.db.prepare("UPDATE bookings SET image=X'' WHERE id=?").run(id);
      }
      const key = { "Idempotency-Key": "source-reuse-stable-123456" };
      const copy = input({ reuseImage: "source", source_booking_id: id });
      const made = await owner.request("/bookings", "POST", copy, key);
      assert.equal(made.status, 201);
      assert.equal(
        (await owner.request("/bookings", "POST", copy, key)).data.id,
        made.data.id,
      );
      assert.deepEqual(
        Buffer.from(
          f.db
            .prepare("SELECT image FROM bookings WHERE id=?")
            .get(made.data.id).image,
        ),
        original,
      );
      const saved = await owner.request("/drafts", "POST", {
        id: "large-copy-draft",
        payload: payload({ source_booking_id: id }),
        reuseImage: "source",
      });
      assert.equal(saved.status, 201);
      const draft = saved.data.draft;
      assert.deepEqual(
        Buffer.from(draft.image.split(",")[1], "base64"),
        original,
      );
      const changed = await owner.request(
        `/drafts/${draft.id}`,
        "PATCH",
        {
          payload: payload({ source_booking_id: id, contact: "补正联系人" }),
          reuseImage: "draft",
        },
        version(draft.version),
      );
      assert.equal(changed.status, 200);
      const reopened = (await owner.request(`/drafts/${draft.id}`)).data.draft;
      assert.equal(reopened.payload.contact, "补正联系人");
      const submit = input({
        ...reopened.payload,
        reuseImage: "draft",
        draftId: draft.id,
        draftVersion: reopened.version,
      });
      const submitKey = { "Idempotency-Key": "draft-reuse-stable-123456" };
      const result = await owner.request(
        "/bookings",
        "POST",
        submit,
        submitKey,
      );
      assert.equal(result.status, 201);
      assert.equal((await owner.request(`/drafts/${draft.id}`)).status, 404);
      const retry = await owner.request("/bookings", "POST", submit, submitKey);
      assert.equal(retry.status, 201);
      assert.equal(retry.data.id, result.data.id);
      assert.deepEqual(
        Buffer.from(
          f.db
            .prepare("SELECT image FROM bookings WHERE id=?")
            .get(result.data.id).image,
        ),
        original,
      );
      assert.deepEqual(
        {
          ...f.db
            .prepare("SELECT status,reason,version FROM bookings WHERE id=?")
            .get(id),
        },
        { status: "未通过", reason: "调整文字后补正", version: 2 },
      );
    });
  }
});

test("小于3MB的新上传经转换后超过3MB，仍可保存草稿、续办及提交", async (t) => {
  const f = await fixture(t),
    owner = f.client();
  await register(owner);
  const saved = await owner.request("/drafts", "POST", {
    payload: payload(),
    image: await largeUpload(),
  });
  assert.equal(saved.status, 201);
  const draft = saved.data.draft;
  assert.ok(
    Buffer.from(draft.image.split(",")[1], "base64").length > 3 * 1024 * 1024,
  );
  const patch = await owner.request(
    `/drafts/${draft.id}`,
    "PATCH",
    { payload: payload({ contact: "继续办理" }) },
    version(draft.version),
  );
  assert.equal(patch.status, 200);
  const result = await owner.request(
    "/bookings",
    "POST",
    input({
      reuseImage: "draft",
      draftId: draft.id,
      draftVersion: patch.data.draft.version,
    }),
  );
  assert.equal(result.status, 201);
});

test("原图引用不能绕过归属、原单状态、草稿版本及新上传限制", async (t) => {
  const f = await fixture(t),
    owner = f.client(),
    other = f.client(),
    root = f.client();
  await register(owner);
  await register(other, "reference-other@test.local");
  await manager(root);
  const pending = await owner.request("/bookings", "POST", booking());
  assert.equal(
    (
      await owner.request(
        "/bookings",
        "POST",
        input({ reuseImage: "source", source_booking_id: pending.data.id }),
      )
    ).status,
    409,
  );
  const id = await rejected(f, owner, root, await largeUpload());
  const saved = await owner.request("/drafts", "POST", {
    payload: payload({ source_booking_id: id }),
    reuseImage: "source",
  });
  assert.equal(saved.status, 201);
  const draft = saved.data.draft;
  const before = f.db.prepare("SELECT COUNT(*) n FROM bookings").get().n;
  for (const request of [
    () =>
      other.request(
        "/bookings",
        "POST",
        input({ reuseImage: "source", source_booking_id: id }),
      ),
    () =>
      other.request("/drafts", "POST", {
        payload: { source_booking_id: id },
        reuseImage: "source",
      }),
    () =>
      other.request(
        "/bookings",
        "POST",
        input({
          reuseImage: "draft",
          draftId: draft.id,
          draftVersion: draft.version,
        }),
      ),
    () =>
      other.request(
        `/drafts/${draft.id}`,
        "PATCH",
        { payload: {}, reuseImage: "draft" },
        version(draft.version),
      ),
  ])
    assert.equal((await request()).status, 404);
  assert.equal(
    (
      await owner.request(
        `/drafts/${draft.id}`,
        "PATCH",
        { payload: payload(), reuseImage: "draft" },
        version(draft.version + 1),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await owner.request(
        "/bookings",
        "POST",
        input({
          reuseImage: "draft",
          draftId: draft.id,
          draftVersion: draft.version + 1,
        }),
      )
    ).status,
    409,
  );
  for (const bad of [
    input({ reuseImage: "draft" }),
    input({ reuseImage: "source" }),
    input({ reuseImage: "other" }),
    booking({ reuseImage: "source", source_booking_id: id }),
  ])
    assert.equal((await owner.request("/bookings", "POST", bad)).status, 400);
  assert.equal(
    (
      await owner.request("/drafts", "POST", {
        payload: {},
        reuseImage: "draft",
      })
    ).status,
    400,
  );
  // Keep this request below the independent HTTP body cap, so it exercises
  // the unchanged 3MB upload limit rather than a transport disconnect.
  const oversized = `data:image/webp;base64,${Buffer.alloc(3 * 1024 * 1024 + 1).toString("base64")}`;
  assert.equal(
    (await owner.request("/bookings", "POST", booking({ image: oversized })))
      .status,
    400,
  );
  assert.equal(
    (
      await owner.request("/drafts", "POST", {
        payload: {},
        image: oversized,
      })
    ).status,
    400,
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM bookings").get().n, before);
  assert.equal(
    (await owner.request(`/drafts/${draft.id}`)).data.draft.version,
    draft.version,
  );
});

test("复用图片按实际字节计入共享配额，超额无副作用，提交草稿不重复计费", async (t) => {
  const f = await fixture(t),
    owner = f.client(),
    root = f.client();
  const user = await register(owner);
  await manager(root);
  const id = await rejected(f, owner, root);
  const draft = (
    await owner.request("/drafts", "POST", { payload: payload(), image: IMAGE })
  ).data.draft;
  const limit = 200 * 1024 * 1024;
  const used = () =>
    f.db
      .prepare(
        "SELECT (SELECT COALESCE(SUM(length(image)),0) FROM bookings WHERE user_id=?) + (SELECT COALESCE(SUM(length(image)),0) FROM booking_drafts WHERE user_id=?) n",
      )
      .get(user.id, user.id).n;
  f.db
    .prepare(
      "INSERT INTO bookings(id,user_id,company,contact,phone,start,end,slot,status,image,image_type,created) SELECT 'quota-padding',user_id,company,contact,phone,start,end,slot,status,zeroblob(?),image_type,created FROM bookings WHERE id=?",
    )
    .run(limit - used(), id);
  const snapshot = () =>
    ["bookings", "booking_drafts", "notifications", "audit"].map(
      (name) => f.db.prepare(`SELECT COUNT(*) n FROM ${name}`).get().n,
    );
  const before = snapshot();
  assert.equal(
    (
      await owner.request("/drafts", "POST", {
        payload: payload({ source_booking_id: id }),
        reuseImage: "source",
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await owner.request(
        "/bookings",
        "POST",
        input({ reuseImage: "source", source_booking_id: id }),
      )
    ).status,
    413,
  );
  assert.deepEqual(snapshot(), before);
  assert.equal(used(), limit);
  const submit = await owner.request(
    "/bookings",
    "POST",
    input({
      reuseImage: "draft",
      draftId: draft.id,
      draftVersion: draft.version,
    }),
  );
  assert.equal(submit.status, 201);
  assert.equal(used(), limit);
  assert.equal((await owner.request(`/drafts/${draft.id}`)).status, 404);
});
