import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BUILDER_PHONE_PATTERN,
  validBuilderPhone,
} from "../../shared/booking-contact.js";
import { openStore } from "../store.mjs";
import { fixture, register, booking } from "./helpers.mjs";

const accepted = [
  "13800138000",
  "027-87540000",
  "027-87540000-1234",
  "02787540000",
  "0755-12345678",
  "075512345678-123456",
  "010-1234567-1",
];
const rejected = [
  "87540000",
  "027-123",
  "027--87540000",
  "027-87540000-",
  "027-87540000-1234567",
  "13800138000-1",
  "+86-027-87540000",
  "027 87540000",
  "027-8754abcd",
  "2".repeat(26),
];

test("搭建方联系方式使用共享完整校验，HTML pattern语法支持手机、含区号座机及分机", () => {
  const browserPattern = new RegExp(`^(?:${BUILDER_PHONE_PATTERN})$`, "v");
  for (const phone of accepted) {
    assert.equal(validBuilderPhone(phone), true, phone);
    assert.equal(browserPattern.test(phone), true, phone);
  }
  for (const phone of [...rejected, null, 13800138000])
    assert.equal(validBuilderPhone(phone), false, String(phone));
});

test("真实申请API接受座机与分机且保存原号码，拒绝不完整区号、异常分隔及非字符串", async (t) => {
  const f = await fixture(t),
    owner = f.client();
  await register(owner);
  for (const phone of accepted) {
    const made = await owner.request(
      "/bookings",
      "POST",
      booking({ builder_phone: ` ${phone} ` }),
    );
    assert.equal(made.status, 201, JSON.stringify(made));
    const row = (await owner.request("/bookings/" + made.data.id)).data.booking;
    assert.equal(row.builder_phone, phone);
    assert.equal(
      f.db
        .prepare("SELECT builder_phone FROM bookings WHERE id=?")
        .get(made.data.id).builder_phone,
      phone,
    );
  }
  for (const phone of [...rejected, 13800138000]) {
    const result = await owner.request(
      "/bookings",
      "POST",
      booking({ builder_phone: phone }),
    );
    assert.equal(result.status, 400, JSON.stringify(result));
  }
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM bookings").get().n,
    accepted.length,
  );
});

test("已有版本8数据库重开会替换旧手机号触发器，数据库写入也检查座机分段与数字", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "outdoor-builder-phone-"));
  let db;
  try {
    const file = path.join(dir, "phone.sqlite");
    db = openStore(file);
    db.exec(
      "DROP TRIGGER booking_content_fields; CREATE TRIGGER booking_content_fields BEFORE INSERT ON bookings WHEN NEW.content_only=1 AND length(NEW.builder_phone)<>11 BEGIN SELECT RAISE(ABORT,'OLD_MOBILE_ONLY'); END;",
    );
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 8);
    db.close();
    db = openStore(file);
    db.prepare(
      "INSERT INTO users(id,email,password_hash,role,company,contact,phone,created) VALUES('builder-user','builder@test.local','unused','enterprise','企业','联系人','13800138000',?)",
    ).run(new Date().toISOString());
    const insert = db.prepare(
      "INSERT INTO bookings(id,user_id,company,contact,phone,builder_contact,builder_phone,content_only,start,end,slot,status,image,image_type,created) VALUES(?,'builder-user','企业','联系人','13800138000','搭建方',?,1,?,?,1,'待审核',X'01','image/png',?)",
    );
    for (const [i, phone] of accepted.entries())
      insert.run(
        "accepted-" + i,
        phone,
        booking().start,
        booking().end,
        new Date().toISOString(),
      );
    for (const [i, phone] of rejected.entries())
      assert.throws(
        () =>
          insert.run(
            "rejected-" + i,
            phone,
            booking().start,
            booking().end,
            new Date().toISOString(),
          ),
        /INVALID_BUILDER/,
        phone,
      );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM bookings").get().n,
      accepted.length,
    );
  } finally {
    db?.close();
    // This test owns exactly this freshly created temporary child directory.
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.match(path.basename(dir), /^outdoor-builder-phone-[A-Za-z0-9]{6}$/);
    await rm(dir, { recursive: true, force: true });
  }
});
