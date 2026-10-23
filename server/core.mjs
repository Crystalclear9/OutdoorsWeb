import { randomUUID } from "node:crypto";
import { hashToken, randomToken, publicUser } from "./security.mjs";
import { PERMISSION_KEYS, can } from "../shared/permissions.js";
import sharp from "sharp";
let imageDecoders = 0;
const imageQueue = [];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const fail = (condition, status, message) => {
  if (condition) throw new HttpError(status, message);
};
export const clean = (v, max = 100) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
export const now = () => new Date().toISOString();
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const dateValid = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !isNaN(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
export function dateRange(start, end, booking = false) {
  fail(
    !dateValid(start) || !dateValid(end) || end < start,
    400,
    "请选择有效的起止日期",
  );
  fail(
    booking && (Date.parse(end) - Date.parse(start)) / 86400000 > 2,
    400,
    "每次申报不可超过 3 天（含起止日期）",
  );
}
export function dates(start, end, booking = false) {
  dateRange(start, end, booking);
  fail(start < today(), 400, "开始日期不能早于今天");
}
export function fields(body) {
  const company = clean(body.company, 80),
    contact = clean(body.contact, 30),
    phone = typeof body.phone === "string" ? body.phone.trim() : "";
  fail(
    !company || !contact || !/^1\d{10}$/.test(phone),
    400,
    "请填写企业名称、联系人和有效的 11 位手机号",
  );
  return { company, contact, phone };
}
export async function body(req) {
  fail(
    !String(req.headers["content-type"] || "").startsWith("application/json"),
    415,
    "请求需要使用 JSON 格式",
  );
  const parts = [];
  let size = 0;
  for await (const p of req) {
    size += p.length;
    fail(size > 4500000, 413, "文件过大，请上传 3 MB 以内的设计图");
    parts.push(p);
  }
  let data;
  try {
    data = JSON.parse(Buffer.concat(parts).toString());
  } catch {
    throw new HttpError(400, "请求格式无效");
  }
  fail(
    !data || typeof data !== "object" || Array.isArray(data),
    400,
    "请求格式无效",
  );
  return data;
}
export function tx(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function versionCheck(req, row, required = false) {
  const value = req.headers["if-match"];
  fail(required && !value, 428, "缺少记录版本，请刷新后重试");
  if (value !== undefined) {
    fail(!/^"[1-9]\d*"$/.test(value), 400, "记录版本无效");
    fail(
      Number(value.slice(1, -1)) !== row.version,
      409,
      "记录已被其他人修改，请刷新后重试",
    );
  }
}
export function createSecurity(db, secure) {
  const age = 7 * 86400000;
  const enrich = (u) =>
    u
      ? {
          ...u,
          mfa_enabled: !!db
            .prepare("SELECT enabled FROM mfa WHERE user_id=?")
            .get(u.id)?.enabled,
          permissions:
            u.role === "admin"
              ? u.is_super
                ? PERMISSION_KEYS
                : db
                    .prepare(
                      "SELECT permission FROM user_permissions WHERE user_id=?",
                    )
                    .all(u.id)
                    .map((r) => r.permission)
              : [],
        }
      : null;
  const present = (u) => publicUser(enrich(u));
  function session(req) {
    const token = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("hust_session="))
      ?.slice(13);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return enrich(
      db
        .prepare(
          "SELECT s.token_hash,s.csrf,s.expires,s.id AS session_id,s.created AS session_created,u.* FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires>? AND u.disabled=0",
        )
        .get(hashToken(token), Date.now()),
    );
  }
  function current(req, permission) {
    const u = session(req);
    fail(!u, 401, "登录已失效，请重新登录");
    const requestPath = new URL(req.url, "http://localhost").pathname;
    fail(
      u.role === "admin" &&
        process.env.REQUIRE_ADMIN_MFA === "true" &&
        !u.mfa_enabled &&
        !requestPath.startsWith("/api/auth/mfa") &&
        ![
          "/api/auth/logout",
          "/api/auth/password",
          "/api/auth/sessions",
          "/api/auth/logout-others",
        ].includes(requestPath),
      403,
      "请先在账号设置中开启两步验证",
    );
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
      fail(
        req.headers["x-csrf-token"] !== u.csrf,
        403,
        "安全校验失败，请刷新后重试",
      );
    fail(
      permission === "enterprise" && u.role !== "enterprise",
      403,
      "仅企业账号可以提交申请",
    );
    fail(
      permission === "super" && (u.role !== "admin" || !u.is_super),
      403,
      "仅超级管理员可以管理授权",
    );
    if (permission && !["enterprise", "super"].includes(permission))
      fail(!can(present(u), permission), 403, "当前账号没有此操作权限");
    if (
      !["/api/auth/password", "/api/auth/logout"].includes(
        new URL(req.url, "http://localhost").pathname,
      )
    )
      fail(u.must_change, 403, "请先在账号设置中修改临时密码");
    return u;
  }
  function cookie(res, token, expire = false) {
    res.setHeader(
      "Set-Cookie",
      `hust_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expire ? 0 : age / 1000}${secure ? "; Secure" : ""}`,
    );
  }
  function start(req, res, user) {
    // All successful authentication paths replace only this browser's previous
    // session. Keep other devices, and do not revoke anything before MFA succeeds.
    const previous = session(req);
    if (previous)
      db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
        previous.token_hash,
      );
    const token = randomToken(),
      csrf = randomToken();
    db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    db.prepare(
      "INSERT INTO sessions(token_hash,user_id,csrf,expires,id,created,agent) VALUES(?,?,?,?,?,?,?)",
    ).run(
      hashToken(token),
      user.id,
      csrf,
      Date.now() + age,
      randomUUID(),
      Date.now(),
      clean(req.headers["user-agent"], 200),
    );
    cookie(res, token);
    return { user: present(user), csrf };
  }
  const audit = (actor, action, target, details = {}) =>
    db
      .prepare(
        "INSERT INTO audit(actor,action,target,created,details) VALUES(?,?,?,?,?)",
      )
      .run(actor, action, target, now(), JSON.stringify(details));
  const write = (req, permission, fn) =>
    tx(db, () => fn(current(req, permission)));
  function limit(key, max, windowMs) {
    const t = Date.now();
    const result = db
      .prepare(
        `INSERT INTO rate_limits(key,attempts,reset) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset<=? THEN 1 ELSE attempts+1 END,reset=CASE WHEN reset<=? THEN ? ELSE reset END WHERE reset<=? OR attempts<? RETURNING attempts`,
      )
      .get(key, t + windowMs, t, t, t + windowMs, t, max);
    fail(!result, 429, "尝试次数过多，请稍后再试");
  }
  return { session, current, present, start, cookie, audit, write, limit };
}
export async function decodeImage(value) {
  const m =
    typeof value === "string" &&
    value.match(
      /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/,
    );
  fail(!m, 400, "请上传 PNG、JPG 或 WebP 桁架设计图");
  const image = Buffer.from(m[2], "base64");
  fail(
    !image.length || image.length > 3 * 1024 * 1024,
    400,
    "设计图最大支持 3 MB",
  );
  const valid =
    m[1] === "image/png"
      ? image
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : m[1] === "image/jpeg"
        ? image[0] === 255 && image[1] === 216 && image[2] === 255
        : image.toString("ascii", 0, 4) === "RIFF" &&
          image.toString("ascii", 8, 12) === "WEBP";
  fail(!valid, 400, "图片内容与文件格式不匹配");
  if (imageDecoders >= 2) {
    fail(imageQueue.length >= 16, 503, "图片处理繁忙，请稍后重试");
    await new Promise((resolve) => imageQueue.push(resolve));
  } else imageDecoders++;
  try {
    const decoder = sharp(image, {
      failOn: "warning",
      limitInputPixels: 20000000,
    });
    const metadata = await decoder.metadata();
    fail(
      (metadata.pages || 1) !== 1 ||
        metadata.width > 10000 ||
        metadata.height > 10000,
      400,
      "图片须为静态图片，最长边不超过 10000 像素",
    );
    // Decode every pixel, remove metadata and re-encode before persisting untrusted input.
    const decoded = await decoder.rotate().webp({ lossless: true }).toBuffer();
    fail(decoded.length > 6 * 1024 * 1024, 400, "图片解码后过大，请降低分辨率");
    return { image: decoded, type: "image/webp" };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(
      400,
      "图片损坏、无法完整解码或超过 2000 万像素，请重新导出后上传",
    );
  } finally {
    const next = imageQueue.shift();
    if (next) next();
    else imageDecoders--;
  }
}
export function databaseError(error) {
  const text = String(error);
  if (/SLOT_CONFLICT/.test(text))
    return new HttpError(409, "该桁架在所选时段已占用或暂停开放");
  if (/DUPLICATE_PENDING/.test(text))
    return new HttpError(409, "您已提交该时段的申请，请勿重复申报");
  if (/INVALID_BOOKING_STATE|IMMUTABLE_BOOKING/.test(text))
    return new HttpError(409, "申请状态已变化，请刷新后重试");
  if (/INVALID_DATE_RANGE/.test(text))
    return new HttpError(400, "申报或暂停日期无效");
  if (/database is locked|SQLITE_BUSY/.test(text))
    return new HttpError(503, "当前操作较多，请稍后重试");
  return error;
}
