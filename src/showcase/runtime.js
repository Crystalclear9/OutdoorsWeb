// TEMPORARY_PAGES_SHOWCASE: synthetic, tab-local data; never a backend fallback.
import { can } from "../../shared/permissions.js";
import { validBuilderPhone } from "../../shared/booking-contact.js";
import { dateString } from "../utils.js";
import designUrl from "./design.svg?url";

const KEY = "outdoors-temporary-showcase-v1";
const MAX_STORED_DESIGN_LENGTH = 8 * 1024 * 1024 + 128;
export const ROLES = [
  ["enterprise", "企业", "overview"],
  ["super", "管理员", "overview"],
  ["visitor", "游客", "overview"],
];
const now = () => new Date().toISOString();
const day = (offset = 0) =>
  dateString(new Date(Date.now() + offset * 86400000));
const profile = (id, contact, permissions = [], superAdmin = false) => ({
  id,
  email: `${id}@showcase.invalid`,
  company:
    id === "enterprise" ? "示例企业 · 青禾文化" : "大学生活动中心（演示）",
  contact,
  phone: "13800000000",
  role: id === "enterprise" ? "enterprise" : "admin",
  permissions,
  isSuperAdmin: superAdmin,
  mustChangePassword: false,
  mfaRequired: false,
  version: 1,
  created: now(),
  disabled: false,
});
function seed() {
  const users = [
    profile("enterprise", "企业联系人"),
    {
      ...profile("other", "活动联系人"),
      role: "enterprise",
      company: "示例企业 · 星桥科技",
    },
    profile("reviewer", "审核老师", ["bookings.review"]),
    profile("finance", "财务老师", ["payments.manage"]),
    profile("super", "系统管理员", [], true),
  ];
  const rows = [
    ["01", 5, 4, "待审核", "enterprise"],
    ["02", 9, 6, "待审核", "other"],
    ["03", 3, 0, "已通过", "enterprise"],
    ["04", 18, 0, "已通过", "other"],
    ["05", 12, 9, "未通过", "enterprise"],
    ["06", 17, 2, "已通过", "enterprise"],
    ["07", 1, -1, "待审核", "enterprise"],
  ];
  return {
    schema: 2,
    idempotency: [],
    drafts: [],
    verifications: {},
    verificationHistory: {},
    role: "enterprise",
    users,
    bookings: rows.map(([id, _slot, offset, status, user_id]) => ({
      id: `SHOWCASE-${id}`,
      slot: 1,
      content_only: 1,
      location: "大活A座平台",
      builder_contact: "搭建方联系人",
      builder_phone: "13900000000",
      start: day(offset),
      end: day(offset),
      status,
      user_id,
      company:
        user_id === "enterprise" ? users[0].company : "示例企业 · 星桥科技",
      contact: user_id === "enterprise" ? "企业联系人" : "活动联系人",
      phone: "13800000000",
      created: new Date(Date.now() - (30 + Number(id)) * 3600000).toISOString(),
      due: new Date(Date.now() + 86400000).toISOString(),
      reviewed: status === "待审核" ? null : now(),
      reason: status === "未通过" ? "请补充清晰的宣传内容及尺寸说明。" : "",
      reviewer: status === "待审核" ? null : "reviewer",
      reviewerName: status === "待审核" ? null : "审核老师",
      cancelled: 0,
      version: 1,
      contactResult: {
        state: status === "已通过" ? "reached" : "pending",
        attempts: status === "已通过" ? 1 : 0,
        reached_at: status === "已通过" ? now() : null,
        note: "演示电话记录",
        version: 1,
      },
      fee: null,
    })),
    notices: [
      {
        id: "notice-1",
        title: "户外广场布展申请与材料说明",
        content:
          "本页面为阶段成果演示。顶部仅提供企业、管理员和游客三种身份。企业提交桁架内容供管理员审核，所有企业、申请及设计图均为虚构示例。",
        pinned: 1,
        created: now(),
        updated: now(),
        version: 1,
      },
      {
        id: "notice-2",
        title: "桁架布展安全与现场核对",
        content:
          "布展地点统一为大活A座平台。请先阅读允许摆放区域示意图，提交清晰的桁架设计图和搭建方联系方式；无需申请具体桁架位置。",
        pinned: 0,
        created: now(),
        updated: now(),
        version: 1,
      },
    ],
    closures: [],
    onsite: [],
    calendar: [],
    calendarVersion: 1,
    audit: [],
    read: [],
    preferences: { sms: 0, voice: 0 },
  };
}
const object = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value, names) =>
  object(value) && names.every((name) => typeof value[name] === "string");
const timestamp = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const version = (value) => Number.isSafeInteger(value) && value > 0;
const slot = (value) => Number.isInteger(value) && value >= 1 && value <= 29;
const optionalStrings = (value, names) =>
  names.every((name) => value[name] == null || typeof value[name] === "string");
const dateOnly = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
function validStoredState(saved) {
  if (
    !object(saved) ||
    saved.schema !== 2 ||
    !ROLES.some(([role]) => role === saved.role)
  )
    return false;
  if (
    ![
      "users",
      "bookings",
      "notices",
      "closures",
      "onsite",
      "calendar",
      "audit",
      "read",
    ].every((key) => Array.isArray(saved[key]))
  )
    return false;
  return (
    ROLES.filter(([role]) => role !== "visitor").every(([role]) =>
      saved.users.some((user) => user?.id === role),
    ) &&
    saved.users.every(
      (user) =>
        strings(user, ["id", "email", "company", "contact", "phone"]) &&
        timestamp(user.created) &&
        ["enterprise", "admin"].includes(user.role) &&
        Array.isArray(user.permissions) &&
        user.permissions.every(
          (permission) => typeof permission === "string",
        ) &&
        version(user.version),
    ) &&
    saved.bookings.every(
      (row) =>
        strings(row, [
          "id",
          "user_id",
          "company",
          "contact",
          "phone",
          "builder_contact",
          "builder_phone",
          "start",
          "end",
        ]) &&
        timestamp(row.created) &&
        dateOnly(row.start) &&
        dateOnly(row.end) &&
        optionalStrings(row, [
          "reason",
          "reviewerName",
          "cancel_reason",
          "reschedule_of",
        ]) &&
        (row.reviewed == null || timestamp(row.reviewed)) &&
        row.content_only === 1 &&
        row.location === "大活A座平台" &&
        slot(row.slot) &&
        (row.designImage == null ||
          (typeof row.designImage === "string" &&
            row.designImage.length <= MAX_STORED_DESIGN_LENGTH &&
            /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
              row.designImage,
            ))) &&
        version(row.version) &&
        ["待审核", "已通过", "未通过", "已撤回"].includes(row.status) &&
        object(row.contactResult) &&
        ["pending", "unreachable", "reached"].includes(
          row.contactResult.state,
        ) &&
        version(row.contactResult.version) &&
        optionalStrings(row.contactResult, ["note"]) &&
        (row.contactResult.reached_at == null ||
          timestamp(row.contactResult.reached_at)) &&
        (row.fee === null ||
          (object(row.fee) &&
            [
              "due",
              "submitted",
              "paid",
              "waived",
              "void",
              "reconcile",
              "refunded",
            ].includes(row.fee.state) &&
            Number.isSafeInteger(row.fee.amount_fen) &&
            row.fee.amount_fen >= 0 &&
            optionalStrings(row.fee, ["instructions", "reference", "note"]) &&
            version(row.fee.version))),
    ) &&
    saved.notices.every(
      (row) =>
        strings(row, ["id", "title", "content"]) &&
        timestamp(row.created) &&
        timestamp(row.updated) &&
        version(row.version),
    ) &&
    saved.closures.every(
      (row) =>
        strings(row, ["id", "start", "end", "reason"]) &&
        dateOnly(row.start) &&
        dateOnly(row.end) &&
        slot(row.slot),
    ) &&
    saved.onsite.every(
      (row) =>
        object(row) &&
        slot(row.slot) &&
        typeof row.present === "boolean" &&
        typeof row.note === "string" &&
        version(row.version),
    ) &&
    saved.calendar.every(
      (row) =>
        strings(row, ["date"]) &&
        dateOnly(row.date) &&
        [true, false, 0, 1].includes(row.working),
    ) &&
    saved.audit.every(
      (row) =>
        strings(row, ["id", "email", "action", "target", "details"]) &&
        timestamp(row.created),
    ) &&
    saved.read.every((id) => typeof id === "string") &&
    version(saved.calendarVersion) &&
    object(saved.preferences)
  );
}
function restore() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY));
    if (validStoredState(saved)) {
      // Preserve valid previous samples while adding newly displayed metadata.
      for (const row of saved.bookings) {
        if (!timestamp(row.due))
          row.due = new Date(Date.now() + 86400000).toISOString();
        if (
          !Number.isSafeInteger(row.contactResult.attempts) ||
          row.contactResult.attempts < 0
        )
          row.contactResult.attempts =
            row.contactResult.state === "reached" ? 1 : 0;
      }
      if (
        !Array.isArray(saved.drafts) ||
        saved.drafts.length > 20 ||
        saved.drafts.some(
          (r) =>
            !strings(r, ["id", "user_id", "created", "updated"]) ||
            !object(r.payload) ||
            !version(r.version) ||
            (r.image != null &&
              (typeof r.image !== "string" ||
                !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
                  r.image,
                ) ||
                r.image.length > MAX_STORED_DESIGN_LENGTH)),
        )
      )
        saved.drafts = [];
      if (!object(saved.verifications)) saved.verifications = {};
      if (!object(saved.verificationHistory)) saved.verificationHistory = {};
      if (
        !Array.isArray(saved.idempotency) ||
        saved.idempotency.some(
          (r) =>
            !strings(r, ["actor", "key", "request_hash"]) ||
            !object(r.response) ||
            typeof r.response.id !== "string" ||
            !Number.isSafeInteger(r.created),
        )
      )
        saved.idempotency = [];
      return saved;
    }
  } catch {}
  return seed();
}
let state = restore();
function persist() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    /* Preview remains usable in memory when storage is unavailable. */
    return false;
  }
}
persist();
export const getRole = () => state.role;
export const getUser = () =>
  state.users.find((u) => u.id === state.role) || null;
// Remounting App discards every old identity's UI state, drafts, dialogs and reads.
export function chooseRole(role) {
  if (!ROLES.some(([key]) => key === role)) return;
  state.role = role;
  persist();
}
export function resetShowcase() {
  const role = state.role;
  state = seed();
  state.role = role;
  persist();
}
const error = (message, status = 400) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};
function requireUser(permission) {
  const user = getUser();
  if (
    !user ||
    (permission === "enterprise"
      ? user.role !== "enterprise"
      : permission === "super"
        ? !user.isSuperAdmin
        : permission && !can(user, permission))
  )
    error("当前演示身份无此操作权限", 403);
  return user;
}
const pageOf = (items, url, size = 15) => {
  const total = items.length,
    pages = Math.max(1, Math.ceil(total / size)),
    page = Math.min(
      pages,
      Math.max(1, Number(url.searchParams.get("page")) || 1),
    );
  return {
    items: structuredClone(items.slice((page - 1) * size, page * size)),
    total,
    pages,
    page,
  };
};
function verificationFor(id, internal = false, historyPage = 1) {
  const target =
    state.users.find((u) => u.id === id && u.role === "enterprise") ||
    error("企业账号不存在", 404);
  const row = state.verifications[id],
    profile = {
      company: target.company,
      contact: target.contact,
      phone: target.phone,
    };
  const valid =
    row &&
    ["pending", "verified", "rejected"].includes(row.state) &&
    version(row.version) &&
    object(row.profile);
  return {
    state: valid
      ? JSON.stringify(row.profile) !== JSON.stringify(profile)
        ? "needs_review"
        : row.state
      : "pending",
    version: valid ? row.version : 0,
    profile,
    profileVersion: target.version,
    reviewed: valid ? row.reviewed : null,
    note: valid ? row.note : "",
    ...(internal
      ? {
          evidence: valid ? row.evidence : "",
          historyPage,
          historyPages: Math.max(
            1,
            Math.ceil((state.verificationHistory[id]?.length || 0) / 20),
          ),
          history: (state.verificationHistory[id] || []).slice(
            (historyPage - 1) * 20,
            historyPage * 20,
          ),
        }
      : {}),
  };
}
function searchable(items, url) {
  const query = (url.searchParams.get("q") || "").trim().toLowerCase();
  return items.filter(
    (item) =>
      !query ||
      [
        item.id,
        item.company,
        item.contact,
        item.email,
        item.action,
        item.target,
      ].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(query),
      ),
  );
}
function createdRange(items, url, message) {
  const from = url.searchParams.get("from"),
    to = url.searchParams.get("to");
  if (
    (from && !dateOnly(from)) ||
    (to && !dateOnly(to)) ||
    (from && to && from > to)
  )
    error(message);
  const submittedFrom = from ? Date.parse(`${from}T00:00:00+08:00`) : null,
    submittedTo = to ? Date.parse(`${to}T23:59:59.999+08:00`) : null;
  return items.filter(
    (row) =>
      (submittedFrom === null || Date.parse(row.created) >= submittedFrom) &&
      (submittedTo === null || Date.parse(row.created) <= submittedTo),
  );
}
function reviewExpired(row) {
  return row.status === "待审核" && !row.cancelled && row.start < day();
}
function reviewPolicy(url) {
  const integer = (key, fallback, min, max) => {
    const value = url.searchParams.get(key);
    if (
      value !== null &&
      (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max)
    )
      error("审批提醒阈值无效");
    return value === null ? fallback : Number(value);
  };
  const upcomingDays = integer("upcomingDays", 2, 0, 30),
    overdueHours = integer("overdueHours", 24, 1, 720);
  return {
    upcomingDays,
    overdueHours,
    upcomingThrough: new Date(Date.parse(day()) + upcomingDays * 86400000)
      .toISOString()
      .slice(0, 10),
    overdueBefore: new Date(Date.now() - overdueHours * 3600000).toISOString(),
  };
}
function reviewPriority(row, policy) {
  return {
    upcoming: row.start <= policy.upcomingThrough,
    overdue: row.created < policy.overdueBefore,
  };
}
function reviewQueue(policy) {
  const rows = state.bookings.filter(
    (row) => row.status === "待审核" && !row.cancelled && row.start >= day(),
  );
  const flags = rows.map((row) => reviewPriority(row, policy));
  return {
    pending: rows.length,
    upcoming: flags.filter((r) => r.upcoming).length,
    overdue: flags.filter((r) => r.overdue).length,
    attention: flags.filter((r) => r.upcoming || r.overdue).length,
    upcomingDays: policy.upcomingDays,
    overdueHours: policy.overdueHours,
  };
}
function displayedStatus(row) {
  return reviewExpired(row)
    ? getUser()?.role === "enterprise"
      ? "未通过"
      : "过期未审核"
    : row.status;
}
function check(row) {
  return {
    blockers: reviewExpired(row) ? ["申请日期已过期"] : [],
    competing: 0,
  };
}
function visibleBookings() {
  const user = requireUser();
  return state.bookings.filter((b) =>
    user.role === "enterprise"
      ? b.user_id === user.id
      : can(user, "bookings.review") ||
        (can(user, "payments.manage") && (b.status === "已通过" || b.fee)),
  );
}
function booking(id) {
  return (
    visibleBookings().find((b) => b.id === id) || error("演示申请不存在", 404)
  );
}
function decorated(b) {
  return {
    ...b,
    status: displayedStatus(b),
    reviewExpired: reviewExpired(b),
    reason: reviewExpired(b)
      ? "申请日期已过期，未能在开始日期前完成审核。"
      : b.reason,
    reviewCheck: check(b),
    due: b.due,
    overdue: false,
    fee: can(getUser(), "payments.manage") ? b.fee : undefined,
    events: state.audit.filter((a) => a.target === b.id),
  };
}
function matchVersion(row, options, version) {
  const expected =
    version ??
    Number(String(options.headers?.["If-Match"] || "").replaceAll('"', ""));
  if (expected !== row.version) error("演示记录已变化，请刷新后重试", 409);
}
function log(action, target) {
  state.audit.unshift({
    id: crypto.randomUUID(),
    email: getUser()?.email || "演示",
    action,
    target,
    created: now(),
    details: JSON.stringify({ showcase: true }),
  });
}
function review(id, status, reason, options, version) {
  requireUser("bookings.review");
  const b = booking(id);
  matchVersion(b, options, version);
  if (reviewExpired(b)) error("申请日期已过期，不能继续审核", 409);
  if (b.status !== "待审核") error("演示申请已处理", 409);
  if (
    !["已通过", "未通过"].includes(status) ||
    (status === "未通过" && !String(reason || "").trim())
  )
    error("请填写有效审核结果和退回原因");
  if (status === "已通过" && check(b).blockers.length)
    error(check(b).blockers.join("；"), 409);
  Object.assign(b, {
    status,
    reason,
    reviewed: now(),
    reviewer: getUser().id,
    reviewerName: getUser().contact,
    version: b.version + 1,
  });
  log("booking.reviewed", id);
}
const clean = (value, length) =>
  typeof value === "string" ? value.trim().slice(0, length) : "";
function enterpriseFields(data) {
  const company = clean(data.company, 80),
    contact = clean(data.contact, 30),
    phone = typeof data.phone === "string" ? data.phone.trim() : "";
  if (!company || !contact || !/^1\d{10}$/.test(phone))
    error("请填写企业名称、联系人和有效的 11 位手机号");
  return { company, contact, phone };
}
function validateDates(b) {
  if (
    !dateOnly(b.start) ||
    !dateOnly(b.end) ||
    b.start < day() ||
    b.end < b.start ||
    Date.parse(b.end) - Date.parse(b.start) > 2 * 86400000
  )
    error("请选择布展时长不超过3天的未来日期范围");
}

export async function designBlob(id) {
  const row = booking(id);
  // Local packaged illustration; no /api or external image requests.
  const response = await fetch(row.designImage || designUrl);
  if (!response.ok) error("演示设计图加载失败");
  const blob = await response.blob();
  if (row.designImage) return blob;
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    const png = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!png) error("演示设计图转换失败");
    return png;
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function design(id) {
  return URL.createObjectURL(await designBlob(id));
}
function sourceFor(user, id) {
  if (!id) return null;
  const row = state.bookings.find((r) => r.id === id && r.user_id === user.id);
  if (!row) error("原申请不存在", 404);
  if (!["未通过", "已撤回"].includes(row.status) && !reviewExpired(row))
    error("仅退回、撤回或过期未审核的申请可复制修改", 409);
  return id;
}
async function draftImage(image) {
  if (image == null) return null;
  if (
    typeof image !== "string" ||
    image.length > 4200000 ||
    !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)
  )
    error("请选择3 MB以内的有效设计图");
  try {
    const blob = await (await fetch(image)).blob();
    if (blob.size > 3 * 1024 * 1024) error("设计图过大");
    const bitmap = await createImageBitmap(blob);
    bitmap.close();
  } catch {
    error("设计图无法完整解码");
  }
  return image;
}
async function imageForWrite(body, user, draft, sourceId) {
  if (body.reuseImage !== undefined) {
    if (
      !["source", "draft"].includes(body.reuseImage) ||
      Object.hasOwn(body, "image")
    )
      error("设计图引用方式无效");
    if (body.reuseImage === "draft") {
      if (!draft?.image) error("草稿设计图不存在", 409);
      return draft.image;
    }
    if (!sourceId) error("请选择本人可复制的原申请");
    sourceFor(user, sourceId);
    const blob = await designBlob(sourceId);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("原设计图读取失败"));
      reader.readAsDataURL(blob);
    });
  }
  return body.image === undefined
    ? draft?.image || null
    : draftImage(body.image);
}
export async function request(path, options = {}) {
  const url = new URL(path, "https://showcase.invalid"),
    p = url.pathname,
    m = options.method || "GET",
    b = options.body || {};
  let result;
  if (m === "GET") {
    if (p.startsWith("/enterprise-verifications/")) {
      const user = requireUser(),
        id = decodeURIComponent(p.split("/")[2]),
        internal = can(user, "accounts.manage");
      if (user.id !== id && !internal && !can(user, "bookings.review"))
        error("无权读取企业核验记录", 403);
      const page = Number(url.searchParams.get("historyPage") || 1);
      if (!Number.isSafeInteger(page) || page < 1 || page > 1000000)
        error("核验历史页码无效");
      result = verificationFor(id, internal, page);
    } else if (p === "/drafts" || /^\/drafts\/[\w-]+$/.test(p)) {
      const user = requireUser("enterprise"),
        id = p.split("/")[2];
      const rows = state.drafts.filter((r) => r.user_id === user.id);
      if (id) {
        const draft = rows.find((r) => r.id === id);
        if (!draft) error("草稿不存在", 404);
        result = { draft };
      } else
        result = {
          items: rows
            .map(({ image, ...row }) => row)
            .sort((a, b) => b.updated.localeCompare(a.updated)),
        };
    } else if (p === "/health") result = { ok: true };
    else if (p === "/auth/session")
      result = { user: structuredClone(getUser()), csrf: null };
    else if (p === "/auth/providers")
      result = { sms: false, qq: false, wechat: false };
    else if (p === "/auth/identities") {
      requireUser();
      result = {
        phone: "",
        providers: [],
        configured: { sms: false, qq: false, wechat: false },
        preferences: state.preferences,
      };
    } else if (p === "/auth/mfa") {
      requireUser();
      result = { enabled: false, recoveryRemaining: 0 };
    } else if (p === "/auth/sessions") {
      requireUser();
      result = {
        items: [
          {
            id: "showcase-session",
            current: true,
            agent: "当前标签页 · 临时展示身份",
            created: Date.now(),
            expires: Date.now() + 86400000,
          },
        ],
      };
    } else if (p === "/notices")
      result = {
        items: [...state.notices].sort(
          (a, b) => b.pinned - a.pinned || b.created.localeCompare(a.created),
        ),
      };
    else if (p === "/venue") {
      const date = url.searchParams.get("date") || day();
      const onsite = date === day() ? state.onsite : [];
      result = {
        date,
        total: 29,
        occupied: state.bookings
          .filter(
            (r) =>
              r.content_only === 0 &&
              r.status === "已通过" &&
              !r.cancelled &&
              r.start <= date &&
              r.end >= date,
          )
          .map(({ slot, start, end }) => ({ slot, start, end })),
        closed: state.closures.filter((r) => r.start <= date && r.end >= date),
        onsite: onsite.map(({ slot, present }) => ({ slot, present })),
        actualPlaced: onsite.filter((r) => r.present).length,
      };
    } else if (p === "/summary")
      result = {
        counts: visibleBookings().reduce(
          (counts, row) => ({
            ...counts,
            [row.cancelled ? "已取消" : displayedStatus(row)]:
              (counts[row.cancelled ? "已取消" : displayedStatus(row)] || 0) +
              1,
          }),
          {},
        ),
        ...(can(getUser(), "bookings.review")
          ? { reviewQueue: reviewQueue(reviewPolicy(url)) }
          : {}),
      };
    else if (p === "/bookings/reviewers") {
      requireUser("bookings.review");
      result = {
        items: state.users
          .filter((u) => can(u, "bookings.review"))
          .map(({ id, contact }) => ({ id, name: contact })),
      };
    } else if (p === "/bookings") {
      const user = requireUser(),
        reviewerAccess = can(user, "bookings.review"),
        scope = url.searchParams.get("reviewScope") || "all",
        policy = reviewerAccess ? reviewPolicy(url) : null;
      if (!["all", "upcoming", "overdue", "attention"].includes(scope))
        error("审批队列筛选无效");
      if (
        !reviewerAccess &&
        (scope !== "all" ||
          url.searchParams.get("order") === "start" ||
          url.searchParams.has("upcomingDays") ||
          url.searchParams.has("overdueHours"))
      )
        error("仅审核人员可以使用审批提醒队列", 403);
      let rows = searchable(visibleBookings(), url);
      for (const key of ["status", "reviewer"])
        if (url.searchParams.get(key))
          rows = rows.filter(
            (r) =>
              (key === "status"
                ? r.cancelled
                  ? "已取消"
                  : displayedStatus(r)
                : r[key]) === url.searchParams.get(key),
          );
      rows = createdRange(rows, url, "提交日期范围无效");
      if (scope !== "all")
        rows = rows.filter((row) => {
          if (row.status !== "待审核" || row.cancelled || row.start < day())
            return false;
          const flag = reviewPriority(row, policy);
          return scope === "attention"
            ? flag.upcoming || flag.overdue
            : scope === "upcoming"
              ? flag.upcoming
              : flag.overdue;
        });
      rows.sort((a, b) =>
        url.searchParams.get("order") === "start"
          ? a.start.localeCompare(b.start) ||
            a.created.localeCompare(b.created) ||
            a.id.localeCompare(b.id)
          : (url.searchParams.get("order") === "oldest" ? 1 : -1) *
            (a.created.localeCompare(b.created) || a.id.localeCompare(b.id)),
      );
      result = {
        ...pageOf(
          rows.map((row) => ({
            ...decorated(row),
            ...(reviewerAccess &&
            row.status === "待审核" &&
            !row.cancelled &&
            !reviewExpired(row)
              ? { reviewPriority: reviewPriority(row, policy) }
              : {}),
          })),
          url,
        ),
        ...(reviewerAccess ? { reviewQueue: reviewQueue(policy) } : {}),
      };
    } else if (/^\/bookings\/[^/]+$/.test(p))
      result = { booking: decorated(booking(p.split("/")[2])) };
    else if (p === "/casework") {
      requireUser();
      result = pageOf([], url);
    } else if (p === "/casework/calendar") {
      if (requireUser().role !== "admin")
        error("企业端无需办理通知与缴费", 403);
      result = { items: state.calendar, version: state.calendarVersion };
    } else if (/^\/casework\/[^/]+$/.test(p)) {
      booking(p.split("/")[2]);
      error("内容审核申请无需办理通知与缴费。", 410);
    } else if (p === "/closures") {
      requireUser("venue.manage");
      result = { items: state.closures };
    } else if (p === "/onsite") {
      requireUser("venue.manage");
      const date = url.searchParams.get("date");
      result = {
        date,
        items: date === day() ? state.onsite : [],
        approved: state.bookings.filter(
          (r) =>
            r.content_only === 0 &&
            !r.cancelled &&
            r.status === "已通过" &&
            r.start <= date &&
            r.end >= date,
        ),
      };
    } else if (p === "/users") {
      requireUser("accounts.manage");
      result = pageOf(
        searchable(
          state.users.filter((u) => u.role === "enterprise"),
          url,
        ),
        url,
      );
    } else if (p === "/access") {
      requireUser("super");
      result = { items: state.users.filter((u) => u.role === "admin") };
    } else if (p === "/audit") {
      requireUser("audit.read");
      result = pageOf(
        createdRange(searchable(state.audit, url), url, "日志日期范围无效"),
        url,
      );
    } else if (p === "/archives") {
      requireUser("audit.read");
      result = pageOf([], url);
    } else if (p === "/notifications") {
      requireUser();
      const items = visibleBookings()
        .slice(0, 3)
        .map((r) => ({
          id: r.id,
          target: r.id,
          title:
            displayedStatus(r) === "待审核" ? "布展申请待审核" : "申请办理进度",
          content: `${r.company} · ${displayedStatus(r)}（演示记录）`,
          created: r.created,
          read_at: state.read.includes(r.id) ? now() : null,
        }));
      result = {
        ...pageOf(items, url),
        unread: items.filter((r) => !r.read_at).length,
      };
    } else if (p === "/operations") {
      requireUser("super");
      result = {
        health: { ok: true, freeBytes: null },
        running: false,
        backup: { at: now(), file: "示例备份记录（无真实文件）" },
        backupHours: 24,
        keep: 14,
        archiveCount: 0,
        pendingWorkdayOverdue: 0,
        offsiteConfigured: false,
        alertConfigured: false,
        communicationConfigured: false,
        deliveries: [],
        warnings: [],
        integrations: [],
        databaseStorage: { allocated: 0, reusable: 0 },
        maintenance: { at: now(), ok: true },
      };
    } else if (p === "/operations/deliveries") {
      requireUser("super");
      result = pageOf([], url);
    } else error("此内容不属于当前临时演示范围", 404);
  } else {
    if (p === "/auth/logout") {
      chooseRole("visitor");
      window.dispatchEvent(new Event("showcase-role-changed"));
      return { ok: true };
    }
    requireUser();
    if (p.startsWith("/enterprise-verifications/")) {
      requireUser("accounts.manage");
      if (m !== "POST") error("不支持的请求方法", 405);
      const id = decodeURIComponent(p.split("/")[2]),
        old = verificationFor(id, true),
        evidence = clean(b.evidence, 2000),
        note = clean(b.note, 500);
      if (
        !["pending", "verified", "rejected"].includes(b.state) ||
        !Number.isSafeInteger(b.version) ||
        !Number.isSafeInteger(b.profileVersion)
      )
        error("核验状态或版本无效");
      if (old.version !== b.version || old.profileVersion !== b.profileVersion)
        error("企业资料或核验记录已变化，请重新读取后核对", 409);
      if (b.state !== "pending" && !evidence)
        error("请填写核验依据，避免录入无关证件信息");
      if (b.state === "rejected" && !note)
        error("退回核验需填写企业可见的说明");
      state.verifications[id] = {
        ...old,
        state: b.state,
        note,
        evidence,
        reviewed: now(),
        version: old.version + 1,
      };
      state.verificationHistory[id] = [
        {
          state: b.state,
          profile: old.profile,
          evidence,
          note,
          version: old.version + 1,
          reviewer: getUser().id,
          reviewed: now(),
        },
        ...(state.verificationHistory[id] || []),
      ];
      log("enterprise.verification_updated", id);
      result = verificationFor(id, true);
    } else if (p === "/drafts" || /^\/drafts\/[\w-]+$/.test(p)) {
      const user = requireUser("enterprise"),
        id = p.split("/")[2];
      let before;
      const old = id
        ? state.drafts.find((r) => r.id === id && r.user_id === user.id)
        : null;
      if (id && !old) error("草稿不存在", 404);
      if (old) matchVersion(old, options);
      if (m === "DELETE" && old) {
        before = structuredClone(state);
        state.drafts = state.drafts.filter((r) => r !== old);
        result = { ok: true };
      } else {
        if ((old && m !== "PATCH") || (!old && m !== "POST"))
          error("不支持的草稿操作", 405);
        if (!object(b.payload)) error("草稿内容无效");
        const payload = {};
        for (const [key, max] of Object.entries({
          company: 80,
          contact: 30,
          phone: 11,
          start: 10,
          end: 10,
          builder_contact: 30,
          builder_phone: 25,
          source_booking_id: 100,
        })) {
          if (
            b.payload[key] != null &&
            (typeof b.payload[key] !== "string" || b.payload[key].length > max)
          )
            error("草稿字段无效");
          payload[key] = clean(b.payload[key], max);
        }
        sourceFor(user, payload.source_booking_id);
        const image = await imageForWrite(
          b,
          user,
          old,
          payload.source_booking_id,
        );
        // Image decoding yields. Recheck ownership/version after it so two
        // tabs/tasks cannot both replace the same saved version.
        if (getUser()?.id !== user.id)
          error("演示身份已变化，请重新读取草稿", 409);
        if (old) {
          const current = state.drafts.find(
            (r) => r.id === id && r.user_id === user.id,
          );
          if (!current) error("草稿不存在", 404);
          matchVersion(current, options);
        }
        sourceFor(user, payload.source_booking_id);
        before = structuredClone(state);
        const existing = !old && state.drafts.find((r) => r.id === b.id);
        if (existing) {
          if (
            existing.user_id !== user.id ||
            JSON.stringify(existing.payload) !== JSON.stringify(payload) ||
            existing.image !== image
          )
            error("草稿编号已使用", 409);
          result = { draft: existing };
        } else {
          if (
            !old &&
            state.drafts.filter((r) => r.user_id === user.id).length >= 20
          )
            error("最多保存20份草稿");
          const draft = {
            id: old?.id || b.id || crypto.randomUUID(),
            user_id: user.id,
            payload,
            image,
            version: (old?.version || 0) + 1,
            created: old?.created || now(),
            updated: now(),
          };
          state.drafts = state.drafts.filter((r) => r !== old);
          state.drafts.push(draft);
          result = { draft };
        }
      }
      if (!persist()) {
        state = before;
        error(
          "演示存储空间不足或存储不可用，草稿操作未保存。请减少图片或删除旧草稿后重试。",
          503,
        );
      }
      return structuredClone(result);
    } else if (p === "/bookings/review-batch") {
      requireUser("bookings.review");
      result = {
        results: b.items.map((item) => {
          try {
            review(item.id, b.status, b.reason, options, item.version);
            return { id: item.id, ok: true };
          } catch (e) {
            return { id: item.id, ok: false, error: e.message };
          }
        }),
      };
    } else if (/^\/bookings\/[^/]+\/review$/.test(p)) {
      review(p.split("/")[2], b.status, b.reason, options);
      result = { ok: true };
    } else if (p === "/bookings" && m === "POST") {
      const user = requireUser("enterprise");
      const source = sourceFor(user, b.source_booking_id);
      let draft;
      if (b.draftId) {
        draft = state.drafts.find(
          (r) => r.id === b.draftId && r.user_id === user.id,
        );
        if (!draft) error("草稿不存在", 404);
        if (draft.version !== b.draftVersion)
          error("草稿已在其他页面修改", 409);
      }
      const fields = enterpriseFields(b);
      validateDates(b);
      if (
        typeof b.builder_contact !== "string" ||
        !b.builder_contact.trim() ||
        b.builder_contact.trim().length > 30 ||
        typeof b.builder_phone !== "string" ||
        !validBuilderPhone(b.builder_phone.trim())
      )
        error("请填写搭建方联系人和有效的搭建方联系电话");
      const row = {
        ...b,
        ...fields,
        source_booking_id: source,
        designImage: await imageForWrite(b, user, draft, source),
        id: `SHOWCASE-${crypto.randomUUID().slice(0, 8)}`,
        slot: 1,
        content_only: 1,
        location: "大活A座平台",
        builder_contact: b.builder_contact.trim(),
        builder_phone: b.builder_phone.trim(),
        user_id: user.id,
        status: "待审核",
        created: now(),
        due: new Date(Date.now() + 86400000).toISOString(),
        version: 1,
        cancelled: 0,
        contactResult: { state: "pending", attempts: 0, version: 1 },
        fee: null,
      };
      if (!row.designImage) error("请上传桁架设计图");
      delete row.image;
      delete row.reuseImage;
      if (getUser()?.id !== user.id)
        error("演示身份已变化，请重新读取申请", 409);
      sourceFor(user, b.source_booking_id);
      if (b.draftId) {
        const latest = state.drafts.find(
          (r) => r.id === b.draftId && r.user_id === user.id,
        );
        if (!latest || latest.version !== b.draftVersion)
          error("草稿已变化，请重新读取后提交", 409);
      }
      const beforeDraftSubmission =
        b.draftId || b.source_booking_id ? structuredClone(state) : null;
      state.bookings.unshift(row);
      if (b.draftId)
        state.drafts = state.drafts.filter(
          (r) => !(r.id === b.draftId && r.user_id === user.id),
        );
      result = { id: row.id };
      log("booking.submitted", row.id);
      if (beforeDraftSubmission) {
        if (!persist()) {
          state = beforeDraftSubmission;
          error(
            b.draftId
              ? "演示存储空间不足或存储不可用，申请未提交，原草稿已保留。请减少图片后重试。"
              : "演示存储空间不足或存储不可用，申请未提交，当前输入已保留。请减少图片后重试。",
            503,
          );
        }
        return structuredClone(result);
      }
    } else if (/^\/bookings\/[^/]+\/(cancel|reschedule)$/.test(p)) {
      error(
        "临时演示可查看取消及改期表单；此处不提交取消、改期或退款，请在完整服务中办理。",
      );
    } else if (/^\/bookings\/[^/]+\/withdraw$/.test(p)) {
      const [, , id, action] = p.split("/"),
        row = booking(id);
      matchVersion(row, options);
      requireUser("enterprise");
      if (reviewExpired(row)) error("申请日期已过期，不能撤回", 409);
      if (row.status !== "待审核") error("只有待审核申请可以撤回");
      row.status = "已撤回";
      row.version++;
      log(`booking.${action}`, id);
      result ||= { ok: true };
    } else if (/^\/casework\/[^/]+\/contact$/.test(p)) {
      requireUser("bookings.review");
      const row = booking(p.split("/")[2]);
      if (row.content_only) error("内容审核申请无需办理通知与缴费。", 410);
      row.contactResult = {
        ...row.contactResult,
        state: b.action === "reopen" ? "pending" : b.state,
        reached_at: b.state === "reached" ? now() : null,
        note: b.note,
        attempts: row.contactResult.attempts + (b.action === "reopen" ? 0 : 1),
        version: row.contactResult.version + 1,
      };
      result = { ok: true };
    } else if (/^\/casework\/[^/]+\/fee$/.test(p)) {
      const row = booking(p.split("/")[2]);
      if (row.content_only) error("内容审核申请无需办理通知与缴费。", 410);
      if (b.action === "submit") error("企业端无需办理通知与缴费", 403);
      requireUser("payments.manage");
      if (["issue", "waive"].includes(b.action)) {
        row.fee = {
          state: b.action === "waive" ? "waived" : "due",
          amount_fen: b.action === "waive" ? 0 : b.amountFen,
          instructions: b.instructions,
          note: b.note,
          version: (row.fee?.version || 0) + 1,
        };
      } else {
        if (!row.fee) error("尚无演示费用记录");
        row.fee.state =
          {
            confirm: "paid",
            return: "due",
            void: "void",
            refund: "refunded",
            late_confirm: "paid",
          }[b.action] || error("未知费用操作");
        row.fee.note = b.note;
        row.fee.version++;
      }
      log("case.fee_updated", row.id);
      result = { ok: true };
    } else if (p === "/notices" || /^\/notices\/[^/]+$/.test(p)) {
      const actor = requireUser("notices.manage");
      const id = p.split("/")[2];
      if (m === "DELETE")
        state.notices = state.notices.filter((r) => r.id !== id);
      else {
        const title = clean(b.title, 80),
          content = clean(b.content, 5000),
          fields = { title, content, pinned: b.pinned ? 1 : 0 };
        if (!title || !content) error("请填写公告标题和正文");
        const key =
          !id && m === "POST"
            ? (options.headers?.["Idempotency-Key"] ??
              options.headers?.["idempotency-key"])
            : undefined;
        if (
          key !== undefined &&
          (typeof key !== "string" || !/^[\w-]{16,128}$/.test(key))
        )
          error("重复请求标识无效");
        const fingerprint = JSON.stringify({
          operation: "notice.create",
          title,
          content,
          pinned: !!b.pinned,
        });
        state.idempotency = state.idempotency.filter(
          (r) => r.created >= Date.now() - 86400000,
        );
        const previous =
          key &&
          state.idempotency.find((r) => r.actor === actor.id && r.key === key);
        if (previous) {
          if (previous.request_hash !== fingerprint)
            error("同一请求标识不能用于不同操作或公告内容", 409);
          return structuredClone(previous.response);
        }
        if (id) {
          const row =
            state.notices.find((r) => r.id === id) || error("公告不存在");
          matchVersion(row, options);
          Object.assign(row, fields, {
            updated: now(),
            version: row.version + 1,
          });
        } else {
          const target = crypto.randomUUID();
          state.notices.unshift({
            ...fields,
            id: target,
            created: now(),
            updated: now(),
            version: 1,
          });
          result = { id: target };
          if (key)
            state.idempotency.push({
              actor: actor.id,
              key,
              request_hash: fingerprint,
              response: result,
              created: Date.now(),
            });
        }
      }
      result ||= { ok: true };
      log("notice.saved", id || result.id || "showcase");
    } else if (p === "/closures" || p.startsWith("/closures/")) {
      requireUser("venue.manage");
      error("场地开放安排已停用，企业统一在大活A座平台申报桁架内容。", 410);
    } else if (p === "/onsite") {
      requireUser("venue.manage");
      for (const row of b.items) {
        state.onsite = state.onsite.filter((r) => r.slot !== row.slot);
        state.onsite.push({ ...row, version: row.version + 1 });
      }
      result = { ok: true };
    } else if (p === "/notifications/read") {
      state.read = b.id
        ? [...new Set([...state.read, b.id])]
        : visibleBookings().map((r) => r.id);
      result = { ok: true };
    } else if (p.startsWith("/casework/calendar/")) {
      requireUser("super");
      error(
        "临时演示仅供查看工作日历，不保存日历或重新计算办理时限；请在完整服务中调整。",
      );
    } else
      error(
        "此功能仅展示界面。账号安全、授权、外发通知和系统维护须在完整服务中操作；请勿输入真实密码或资料。",
      );
    persist();
  }
  return structuredClone(result);
}
