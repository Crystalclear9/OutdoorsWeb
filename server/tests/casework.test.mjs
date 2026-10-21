import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openStore } from "../store.mjs";
import { overdueCases, workingDeadline } from "../casework.mjs";
import {
  fixture,
  manager,
  register,
  staff,
  booking,
  PASSWORD,
} from "./helpers.mjs";
const ver = (n) => ({ "If-Match": `"${n}"` });
async function setup(t) {
  const f = await fixture(t),
    root = f.client(),
    owner = f.client();
  await manager(root);
  await register(owner);
  const id = (await owner.request("/bookings", "POST", booking())).data.id;
  const approve = () =>
    root.request(
      `/bookings/${id}/review`,
      "POST",
      { status: "已通过" },
      ver(1),
    );
  const read = async (c = root) =>
    (await c.request(`/casework/${id}`)).data.item;
  const fee = (c, data, v) =>
    c.request(`/casework/${id}/fee`, "POST", data, v ? ver(v) : {});
  return { ...f, root, owner, id, approve, read, fee };
}
test("一个工作日按北京时间跳过周末，支持节假日和调休，跨年与凌晨不偏移", () => {
  assert.equal(
    workingDeadline("2026-10-23T02:00:00.000Z"),
    "2026-10-26T02:00:00.000Z",
  );
  assert.equal(
    workingDeadline("2026-10-23T02:00:00.000Z", new Map([["2026-10-24", 1]])),
    "2026-10-24T02:00:00.000Z",
  );
  assert.equal(
    workingDeadline("2026-10-23T02:00:00.000Z", new Map([["2026-10-26", 0]])),
    "2026-10-27T02:00:00.000Z",
  );
  assert.equal(
    workingDeadline("2026-12-31T16:30:00.000Z", new Map([["2027-01-02", 1]])),
    "2027-01-01T16:30:00.000Z",
  );
});
test("工作日历仅超级管理员可修改，版本冲突阻止覆盖，恢复默认和无效日期受保护", async (t) => {
  const f = await setup(t),
    reviewer = f.client();
  await staff(f.root, reviewer, ["bookings.review"]);
  const date = booking().start;
  assert.equal(
    (
      await reviewer.request(
        `/casework/calendar/${date}`,
        "PUT",
        { working: false },
        ver(1),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.root.request(`/casework/calendar/${date}`, "PUT", {
        working: false,
      })
    ).status,
    428,
  );
  assert.equal(
    (
      await f.root.request(
        `/casework/calendar/${date}`,
        "PUT",
        { working: false },
        ver(1),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await f.root.request(
        `/casework/calendar/${date}`,
        "PUT",
        { working: true },
        ver(1),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await f.root.request(
        "/casework/calendar/2026-02-30",
        "PUT",
        { working: true },
        ver(2),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.root.request(
        `/casework/calendar/${date}`,
        "PUT",
        { working: null },
        ver(2),
      )
    ).status,
    200,
  );
  assert.deepEqual((await f.root.request("/casework/calendar")).data.items, []);
});
test("电话结果先审批后登记，内部说明隔离，两个管理员并发更新仅一条成功", async (t) => {
  const f = await setup(t),
    other = f.client();
  await register(other, "other@test.local");
  const contact = (data, v) =>
    f.root.request(`/casework/${f.id}/contact`, "POST", data, ver(v));
  assert.equal(
    (await contact({ state: "reached", note: "已告知" }, 1)).status,
    409,
  );
  await f.approve();
  assert.equal(
    (await contact({ state: "unreachable", note: "内部核对：电话无人接听" }, 1))
      .status,
    200,
  );
  const results = await Promise.all([
    contact({ state: "reached", note: "内部核对：已告知审批结果" }, 2),
    contact({ state: "unreachable", note: "仍未接通" }, 2),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const own = await f.read(f.owner);
  assert.deepEqual(Object.keys(own.contactResult).sort(), [
    "reached_at",
    "state",
  ]);
  assert.equal(JSON.stringify(own).includes("内部核对"), false);
  assert.equal((await other.request(`/casework/${f.id}`)).status, 404);
  assert.equal(
    (
      await f.owner.request(
        `/casework/${f.id}/contact`,
        "POST",
        { state: "reached", note: "自报" },
        ver(3),
      )
    ).status,
    403,
  );
  const current = await f.read();
  if (current.contactResult.state !== "reached")
    await contact(
      { state: "reached", note: "已电话告知" },
      current.contactResult.version,
    );
  assert.equal(overdueCases(f.db, Date.parse(own.due) + 1000), 0);
});
test("缴费从通知、企业流水到财务确认，审核权限不替代财务授权，过期版本不能重复入账", async (t) => {
  const f = await setup(t),
    finance = f.client(),
    reviewer = f.client();
  await staff(f.root, finance, ["payments.manage"], "finance@test.local");
  await staff(f.root, reviewer, ["bookings.review"], "reviewer@test.local");
  assert.equal(
    (
      await f.fee(f.root, {
        action: "issue",
        amountFen: 5000,
        instructions: "单位收款",
        note: "核准收费",
      })
    ).status,
    409,
  );
  await f.approve();
  assert.equal(
    (
      await f.fee(reviewer, {
        action: "issue",
        amountFen: 5000,
        instructions: "单位收款",
        note: "核准收费",
      })
    ).status,
    403,
  );
  const issues = await Promise.all(
    [1, 2].map(() =>
      f.fee(finance, {
        action: "issue",
        amountFen: 5000,
        instructions: "学校财务窗口，核对单位账户后付款",
        note: "场地管理核准收费",
      }),
    ),
  );
  assert.deepEqual(issues.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await f.read(reviewer)).fee, undefined);
  assert.equal(
    (
      await f.owner.request(`/casework/${f.id}/fee`, "POST", {
        action: "submit",
        reference: "银行流水123",
      })
    ).status,
    428,
  );
  assert.equal(
    (await f.fee(f.owner, { action: "submit", reference: "银行流水123" }, 1))
      .status,
    200,
  );
  assert.equal((await f.read()).fee.state, "submitted");
  assert.equal(
    (await f.fee(f.owner, { action: "confirm", note: "自称付款" }, 2)).status,
    403,
  );
  const confirms = await Promise.all(
    [1, 2].map(() =>
      f.fee(finance, { action: "confirm", note: "核对单位银行入账流水ABC" }, 2),
    ),
  );
  assert.deepEqual(confirms.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await f.read()).fee.amount_fen, 5000);
  assert.equal((await f.read()).fee.state, "paid");
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) n FROM audit WHERE action='case.fee_confirm'")
      .get().n,
    1,
  );
  assert.equal(
    (await f.fee(finance, { action: "void", note: "不可抹去入账" }, 3)).status,
    409,
  );
  assert.equal((await finance.request(`/bookings/${f.id}`)).status, 403);
});
test("取消时保留已提交付款的核款待办，核实到账后才登记退款，免缴和退款不会自动扣款", async (t) => {
  const f = await setup(t);
  await f.approve();
  await f.fee(f.root, {
    action: "issue",
    amountFen: 100,
    instructions: "单位窗口",
    note: "核准收费",
  });
  await f.fee(f.owner, { action: "submit", reference: "取消前已付款流水" }, 1);
  assert.equal(
    (
      await f.owner.request(
        `/bookings/${f.id}/cancel`,
        "POST",
        { reason: "取消活动" },
        ver(2),
      )
    ).status,
    200,
  );
  const item = await f.read();
  assert.equal(item.fee.state, "reconcile");
  assert.equal(item.fee.reference, "取消前已付款流水");
  assert.equal(
    (await f.fee(f.owner, { action: "submit", reference: "再次付款" }, 3))
      .status,
    409,
  );
  assert.equal(
    (await f.fee(f.root, { action: "refund", note: "尚未确认入账不能退款" }, 3))
      .status,
    409,
  );
  assert.equal(
    (await f.root.request("/casework?scope=open")).data.items[0].id,
    f.id,
  );
  assert.equal(
    (await f.fee(f.root, { action: "confirm", note: "核实已到账，应退回" }, 3))
      .status,
    200,
  );
  assert.equal(
    (
      await f.fee(
        f.root,
        { action: "refund", note: "银行已全额退回，退款流水R001" },
        4,
      )
    ).status,
    200,
  );
  assert.equal((await f.read()).fee.state, "refunded");
  assert.equal((await f.root.request("/casework?scope=open")).data.total, 0);
});
test("金额用整数分，作废改价保留历史和最新版本，跨账号无费用访问权，免缴有依据", async (t) => {
  const f = await setup(t),
    other = f.client();
  await register(other, "fee-other@test.local");
  await f.approve();
  for (const amountFen of [0, -1, 0.1, 100000001, "100", null])
    assert.equal(
      (
        await f.fee(f.root, {
          action: "issue",
          amountFen,
          instructions: "财务窗口",
          note: "收费依据",
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await f.fee(f.root, {
        action: "issue",
        amountFen: 100,
        instructions: "财务窗口",
        note: "收费依据",
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.fee(other, { action: "submit", reference: "越权流水" }, 1)).status,
    404,
  );
  assert.equal(
    (await f.fee(f.root, { action: "return", note: "未提交流水" }, 1)).status,
    409,
  );
  await f.fee(
    f.root,
    { action: "void", note: "收费标准录入有误，重新核定" },
    1,
  );
  assert.equal(
    (await f.fee(f.root, { action: "waive", note: "活动中心核准免缴" }, 1))
      .status,
    409,
  );
  assert.equal(
    (await f.fee(f.root, { action: "waive", note: "活动中心核准免缴" }, 2))
      .status,
    200,
  );
  const item = await f.read(f.owner);
  assert.equal(item.fee.state, "waived");
  assert.equal(item.fee.amount_fen, 0);
  assert.equal((await other.request("/casework")).data.total, 0);
});
test("已审批但未电话告知仍计算工作日超期，取消和撤回不继续催办", async (t) => {
  const f = await setup(t);
  await f.approve();
  f.db
    .prepare(
      "UPDATE bookings SET created='2026-10-23T02:00:00.000Z' WHERE id=?",
    )
    .run(f.id);
  assert.equal(overdueCases(f.db, Date.parse("2026-10-25T03:00:00Z")), 0);
  assert.equal(overdueCases(f.db, Date.parse("2026-10-26T03:00:00Z")), 1);
  await f.root.request(
    `/bookings/${f.id}/cancel`,
    "POST",
    { reason: "取消活动" },
    ver(2),
  );
  assert.equal(overdueCases(f.db, Date.parse("2026-10-26T03:00:00Z")), 0);
});
test("版本六升级到七保留账号与业务，回填电话跟进表且重复启动不重复通知", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "case-migrate-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filename = path.join(dir, "app.sqlite");
  let db = openStore(filename);
  db.prepare(
    "INSERT INTO users(id,email,password_hash,role,company,contact,phone,created) VALUES('u','u@test.local',?,'enterprise','企业','李老师','13900139000','2026-01-01')",
  ).run(PASSWORD);
  db.prepare(
    "INSERT INTO bookings(id,user_id,company,contact,phone,start,end,slot,status,image,image_type,created) VALUES('legacy','u','旧企业','李老师','13900139000','2026-10-21','2026-10-21',1,'待审核',X'','image/png','2026-10-20T00:00:00.000Z')",
  ).run();
  db.exec(
    "DROP TRIGGER case_contact_insert; DROP TRIGGER case_fee_cancel; DROP TABLE case_contacts; DROP TABLE booking_fees; DROP TABLE calendar_version; DROP TABLE work_calendar; PRAGMA user_version=6;",
  );
  db.close();
  db = openStore(filename);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 7);
  assert.equal(
    db.prepare("SELECT company FROM bookings").get().company,
    "旧企业",
  );
  assert.equal(
    db.prepare("SELECT state FROM case_contacts").get().state,
    "pending",
  );
  db.close();
  db = openStore(filename);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM case_contacts").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications").get().n, 0);
  db.close();
});
