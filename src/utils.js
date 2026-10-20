export const dateString = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
export const slotName = (n) => `${String(n).padStart(2, "0")}号`;
import { segmentFor } from "./venue-layout.js";
export const zoneName = (n) => segmentFor(n)?.label || "未知位置";
export const formatDate = (s) =>
  s
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(s.length === 10 ? s + "T12:00:00+08:00" : s))
    : "";
