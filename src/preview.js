import { dateString } from "./utils.js";
import { PERMISSIONS } from "./permissions.js";

// Preview identities never become server credentials. All requests are handled
// locally while previewing; writes are rejected before reaching fetch().
export const previewAvailable = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
  || import.meta.env.VITE_ENABLE_PREVIEW === "true";
export const previewRoles = [
  ["guest", "游客"], ["enterprise", "企业"],
  ["reviewer", "审核人员"], ["admin", "管理员"],
];
const requestedRole = new URLSearchParams(location.search).get("preview");
export const previewRole = previewAvailable && previewRoles.some(([id]) => id === requestedRole)
  ? requestedRole : "";
const today = dateString();
const created = `${today}T08:00:00+08:00`;
const enterprise = { id: "preview-enterprise", role: "enterprise", company: "示例企业", contact: "企业联系人", email: "company@example.com", phone: "13800000000", version: 1, disabled: false, permissions: [] };
const reviewer = { id: "preview-reviewer", role: "admin", company: "大学生活动中心", contact: "审核人员", email: "reviewer@example.com", permissions: ["bookings.review"], version: 1 };
const admin = { ...reviewer, id: "preview-admin", contact: "管理员", email: "admin@example.com", isSuperAdmin: true, permissions: PERMISSIONS.map((p) => p.key) };
const identities = { guest: null, enterprise, reviewer, admin };
const bookings = [
  { id: "PREVIEW-001", slot: 11, status: "待审核", reason: "" },
  { id: "PREVIEW-002", slot: 7, status: "已通过", reason: "" },
  { id: "PREVIEW-003", slot: 18, status: "未通过", reason: "请补充设计图尺寸后重新提交。" },
].map((item) => ({ ...item, user_id: enterprise.id, company: enterprise.company, contact: enterprise.contact, phone: enterprise.phone, email: enterprise.email, start: today, end: today, created, updated: created, version: 1, reviewCheck: { blockers: [], competing: 0 } }));
const notices = [{ id: "preview-notice", title: "布展预约办理说明", content: "请选择活动日期和桁架位置，上传设计图后提交申请。审核结果可在“我的申请”中查看。", created, pinned: 1, version: 1 }];

export async function previewApi(path, options = {}) {
  if ((options.method || "GET").toUpperCase() !== "GET") {
    throw new Error("当前为身份预览。请切换到真实账号后办理业务。");
  }
  const url = new URL(path, "https://preview.invalid");
  const route = url.pathname;
  if (route === "/auth/session") return { user: identities[previewRole], csrf: null };
  if (route === "/venue") return { total: 29, occupied: url.searchParams.get("date") === today ? [{ slot: 7 }] : [], closed: [] };
  if (route === "/notices") return { items: notices };
  if (route === "/summary") return { counts: { "待审核": 1, "已通过": 1, "未通过": 1 } };
  if (route === "/bookings") {
    const status = url.searchParams.get("status"), query = url.searchParams.get("q") || "";
    const items = bookings.filter((b) => (!status || b.status === status) && `${b.company} ${b.id}`.includes(query));
    return { items, total: items.length, pages: 1 };
  }
  if (route.startsWith("/bookings/")) {
    const booking = bookings.find((b) => b.id === route.split("/")[2]);
    if (booking) return { booking };
  }
  if (route === "/users") return { items: [enterprise] };
  if (route === "/access") return { items: [admin, reviewer] };
  if (route === "/closures" || route === "/audit") return { items: [] };
  if (route === "/auth/sessions") return { items: [{ id: "preview-session", current: true, agent: "预览浏览器", created, expires: `${today}T23:59:59+08:00` }] };
  throw new Error("此页面暂不提供预览数据。");
}

export function previewDesign() {
  // A labelled, local sample lets the review layout load without private files.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" fill="#f3f0e9"/><path d="M60 60H900V480H60Z" fill="none" stroke="#762e39" stroke-width="2"/><text x="100" y="190" font-family="sans-serif" font-size="42" fill="#762e39">企业布展设计图</text><text x="100" y="255" font-family="sans-serif" font-size="23" fill="#666">身份预览 · 示例材料</text><path d="M100 310H860" stroke="#bba48b"/><text x="100" y="390" font-family="sans-serif" font-size="18" fill="#666">仅用于查看审核页面布局</text></svg>`;
  return URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
}
