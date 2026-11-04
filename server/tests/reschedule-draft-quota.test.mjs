import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { hashToken } from "../security.mjs";
import {
  fixture,
  register,
  manager,
  booking,
  IMAGE,
  TODAY,
} from "./helpers.mjs";

const LIMIT = 200 * 1024 * 1024;
const version = (n) => ({ "If-Match": `"${n}"` });
const day = (n) =>
  new Date(Date.parse(TODAY()) + n * 86400000).toISOString().slice(0, 10);

test("改期复制同时计入草稿占用，超额回滚且删除草稿后可重试（含归档源图）", async (t) => {
  for (const archived of [false, true]) {
    await t.test(archived ? "读取归档源图" : "读取未归档源图", async (t) => {
      const f = await fixture(t),
        owner = f.client(),
        root = f.client();
      const user = await register(owner);
      await manager(root);
      const made = await owner.request(
        "/bookings",
        "POST",
        booking({ start: day(7), end: day(7) }),
      );
      assert.equal(made.status, 201);
      const id = made.data.id;
      assert.equal(
        (
          await root.request(
            `/bookings/${id}/review`,
            "POST",
            { status: "已通过" },
            version(1),
          )
        ).status,
        200,
      );
      const sourceImage = Buffer.from(
        f.db.prepare("SELECT image FROM bookings WHERE id=?").get(id).image,
      );
      if (archived) {
        // Exercise the supported archive restore path using the real upload,
        // compressed and hashed exactly as the archival storage format expects.
        const at = new Date().toISOString();
        f.db
          .prepare("INSERT INTO archives VALUES(?,?,?,?,?,?,?,?)")
          .run(
            `image-${id}`,
            "image",
            at,
            at,
            1,
            sourceImage.length,
            hashToken(sourceImage),
            gzipSync(sourceImage),
          );
        f.db.prepare("UPDATE bookings SET image=X'' WHERE id=?").run(id);
      }
      const draft = await owner.request("/drafts", "POST", {
        payload: { company: "占用空间但尚未提交的草稿" },
        image: IMAGE,
      });
      assert.equal(draft.status, 201);
      const used = () =>
        f.db
          .prepare(
            "SELECT (SELECT COALESCE(SUM(length(image)),0) FROM bookings WHERE user_id=?) + (SELECT COALESCE(SUM(length(image)),0) FROM booking_drafts WHERE user_id=?) bytes",
          )
          .get(user.id, user.id).bytes;
      // Native in-memory quota padding stands for stored image history; no
      // large network body, filesystem fixture or mocked quota query is used.
      f.db
        .prepare(
          "INSERT INTO bookings(id,user_id,company,contact,phone,builder_contact,builder_phone,content_only,start,end,slot,status,image,image_type,created) SELECT 'quota-history',user_id,company,contact,phone,builder_contact,builder_phone,content_only,start,end,slot,'未通过',zeroblob(?),image_type,created FROM bookings WHERE id=?",
        )
        .run(LIMIT - used() - 1, id);
      const snapshot = () =>
        Object.fromEntries(
          [
            "bookings",
            "booking_drafts",
            "case_contacts",
            "notifications",
            "audit",
            "archives",
          ].map((name) => [
            name,
            f.db.prepare(`SELECT COUNT(*) n FROM ${name}`).get().n,
          ]),
        );
      const before = snapshot(),
        bytesBefore = used();
      assert.equal(bytesBefore, LIMIT - 1);
      const request = () =>
        owner.request(
          `/bookings/${id}/reschedule`,
          "POST",
          { start: day(8), end: day(8) },
          version(2),
        );
      const refused = await request();
      assert.equal(refused.status, 413);
      assert.match(refused.data.error, /存储已达上限/);
      assert.deepEqual(snapshot(), before);
      assert.equal(used(), bytesBefore);
      assert.deepEqual(
        {
          ...f.db
            .prepare("SELECT cancelled,version FROM bookings WHERE id=?")
            .get(id),
        },
        { cancelled: 0, version: 2 },
      );
      assert.equal(
        (
          await owner.request(
            `/drafts/${draft.data.draft.id}`,
            "DELETE",
            undefined,
            version(draft.data.draft.version),
          )
        ).status,
        200,
      );
      const afterRelease = used();
      assert.ok(afterRelease + sourceImage.length <= LIMIT);
      const accepted = await request();
      assert.equal(accepted.status, 201);
      const child = f.db
        .prepare(
          "SELECT reschedule_of,length(image) bytes FROM bookings WHERE id=?",
        )
        .get(accepted.data.id);
      assert.equal(child.reschedule_of, id);
      assert.equal(child.bytes, sourceImage.length);
      assert.equal(used(), afterRelease + sourceImage.length);
      assert.equal(snapshot().audit, before.audit + 1);
    });
  }
});
