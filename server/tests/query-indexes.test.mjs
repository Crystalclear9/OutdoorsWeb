import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openStore } from "../store.mjs";

const queries = [
  [
    "global history",
    "SELECT id,user_id,company,contact,phone,start,end,slot,status,created,reviewer FROM bookings ORDER BY created DESC,id DESC LIMIT 15 OFFSET 0",
    [],
  ],
  [
    "pending queue",
    "SELECT id,company,created FROM bookings WHERE status=? AND cancelled=0 ORDER BY created ASC,id ASC LIMIT 15",
    ["待审核"],
  ],
  [
    "reviewer and submission date",
    "SELECT id,company,created FROM bookings WHERE reviewer=? AND created>=? AND created<=? ORDER BY created DESC,id DESC LIMIT 15",
    ["operator", "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"],
  ],
];

test("历史、待审及审批人日期查询使用索引排序，操作人选项不逐用户扫描申请表", () => {
  const db = openStore(":memory:");
  try {
    for (const [name, sql, args] of queries) {
      const plan = db
        .prepare("EXPLAIN QUERY PLAN " + sql)
        .all(...args)
        .map((row) => row.detail)
        .join("\n");
      assert.match(plan, /USING (?:COVERING )?INDEX/, name);
      assert.doesNotMatch(plan, /TEMP B-TREE|SCAN bookings(?:$|\n)/, name);
    }
    const options = db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT u.id,u.contact FROM users u WHERE EXISTS(SELECT 1 FROM bookings b WHERE b.reviewer=u.id) ORDER BY u.contact,u.id",
      )
      .all()
      .map((row) => row.detail)
      .join("\n");
    // SQLite releases may label the correlated lookup as "b EXISTS".
    assert.match(
      options,
      /SEARCH b(?: EXISTS)? USING (?:COVERING )?INDEX.*reviewer=/,
    );
    assert.doesNotMatch(options, /SCAN b(?:$|\n)/);
  } finally {
    db.close();
  }
});

test("版本七旧库增量补齐查询索引，账号、图片、联系及费用记录保留且重复启动幂等", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "outdoors-index-"));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("outdoors-index-"));
    await rm(directory, { recursive: true, force: true });
  });
  const filename = path.join(directory, "app.sqlite");
  let db = openStore(filename);
  let expected;
  try {
    db.exec(`
      INSERT INTO users(id,email,password_hash,role,company,contact,phone,created) VALUES
        ('operator','operator@test.local','fixture','admin','学校','审核人','','2026-10-01T00:00:00.000Z'),
        ('owner','owner@test.local','fixture','enterprise','企业','联系人','13800138000','2026-10-01T00:00:00.000Z');
      INSERT INTO bookings(id,user_id,company,contact,phone,start,end,slot,status,image,image_type,created,reviewer)
        VALUES('HISTORY-1','owner','企业','联系人','13800138000','2026-10-01','2026-10-01',1,'已通过',X'010203','image/webp','2026-10-01T00:00:00.000Z','operator');
      INSERT INTO booking_fees(booking_id,amount_fen,state,instructions,updated) VALUES('HISTORY-1',1200,'paid','正式收款说明','2026-10-01T01:00:00.000Z');
      UPDATE case_contacts SET state='reached',attempts=1,version=2 WHERE booking_id='HISTORY-1';
      DROP INDEX bookings_created;
      DROP INDEX bookings_status_created;
      DROP INDEX bookings_reviewer_created;
    `);
    expected = {
      users: db.prepare("SELECT * FROM users ORDER BY id").all(),
      booking: db.prepare("SELECT * FROM bookings").get(),
      contact: db.prepare("SELECT * FROM case_contacts").get(),
      fee: db.prepare("SELECT * FROM booking_fees").get(),
    };
  } finally {
    db.close();
  }
  for (let i = 0; i < 2; i++) {
    db = openStore(filename);
    try {
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 7);
      assert.deepEqual(
        {
          users: db.prepare("SELECT * FROM users ORDER BY id").all(),
          booking: db.prepare("SELECT * FROM bookings").get(),
          contact: db.prepare("SELECT * FROM case_contacts").get(),
          fee: db.prepare("SELECT * FROM booking_fees").get(),
        },
        expected,
      );
      for (const [, sql, args] of queries) {
        const plan = db
          .prepare("EXPLAIN QUERY PLAN " + sql)
          .all(...args)
          .map((r) => r.detail)
          .join("\n");
        assert.doesNotMatch(plan, /TEMP B-TREE|SCAN bookings(?:$|\n)/);
      }
    } finally {
      db.close();
    }
  }
});
