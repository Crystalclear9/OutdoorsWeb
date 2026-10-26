import { clean, fail, today } from "./core.mjs";
import { validBuilderPhone } from "../shared/booking-contact.js";

export const BOOKING_LOCATION = "大活A座平台";
export const EXPIRED_REASON = "申请日期已过期，未能在开始日期前完成审核。";
export const expiredReview = (row, date = today()) =>
  !row.cancelled && row.status === "待审核" && row.start < date;

// Expiry is a view of an unreviewed application, never an invented human review.
export function bookingView(row, admin = false, date = today()) {
  const reviewExpired = expiredReview(row, date);
  return {
    ...row,
    location: BOOKING_LOCATION,
    status: row.cancelled
      ? "已取消"
      : reviewExpired
        ? admin
          ? "过期未审核"
          : "未通过"
        : row.status,
    reviewExpired,
    reason: reviewExpired ? row.reason || EXPIRED_REASON : row.reason,
  };
}

export function builderFields(data) {
  const builder_contact = clean(data.builder_contact, 30),
    builder_phone =
      typeof data.builder_phone === "string" ? data.builder_phone.trim() : "";
  fail(
    !builder_contact || !validBuilderPhone(builder_phone),
    400,
    "请填写搭建方联系人及有效的手机号或含区号的座机号（可附分机）",
  );
  return { builder_contact, builder_phone };
}
