import test from "node:test";
import assert from "node:assert/strict";
import { bookingNextStep } from "../../src/booking-next-step.js";

const today = "2026-10-23";
const approved = { status: "已通过", cancelled: 0, end: "2026-10-25" };
test("企业提示不把审批或流水提交当作收款，并优先处理取消后的资金", () => {
  assert.match(bookingNextStep(approved, today).detail, /财务将确认/);
  assert.match(
    bookingNextStep({ ...approved, fee: { state: "submitted" } }, today).detail,
    /等待财务确认到账/,
  );
  for (const state of ["paid", "reconcile", "void", "refunded"]) {
    const cancelled = bookingNextStep(
      { ...approved, cancelled: 1, fee: { state } },
      today,
    );
    assert.doesNotMatch(cancelled.title, /准备布展|按通知缴费/);
    assert.match(cancelled.detail, /退款|停止付款|请勿重复付款/);
  }
  const ended = bookingNextStep(
    { ...approved, end: "2026-10-22", fee: { state: "waived" } },
    today,
  );
  assert.equal(ended.title, "预约时段已结束");
  assert.match(ended.detail, /免缴/);
  assert.match(
    bookingNextStep({ ...approved, fee: { state: "refunded" } }, today).detail,
    /预约仍有效/,
  );
});
