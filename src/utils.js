export const dateString = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
export const slotName = (n) =>
  `${n <= 9 ? "A" : n <= 19 ? "B" : "C"}-${String(n <= 9 ? n : n <= 19 ? n - 9 : n - 19).padStart(2, "0")}`;
export const zoneName = (n) =>
  n <= 9 ? "绿地周边" : n <= 19 ? "环形广场" : "东南步道";
export const formatDate = (s) =>
  s
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(s.length === 10 ? s + "T12:00:00+08:00" : s))
    : "";
