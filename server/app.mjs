import { createServer } from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "./store.mjs";
import {
  hashPassword,
  verifyPassword,
  passwordValid,
  publicUser,
  hashToken,
  randomToken,
} from "./security.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SESSION_AGE = 7 * 24 * 60 * 60 * 1000;
const now = () => new Date().toISOString();
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (condition, status, message) => {
  if (condition) throw new HttpError(status, message);
};
const clean = (v, max = 100) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const emailValue = (v) => clean(v, 254).toLowerCase();
const emailValid = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const dateValid = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !isNaN(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
function dateRange(start, end, booking = false) {
  fail(
    !dateValid(start) || !dateValid(end) || end < start,
    400,
    "请选择有效的起止日期",
  );
  fail(start < today(), 400, "开始日期不能早于今天");
  fail(
    booking && (Date.parse(end) - Date.parse(start)) / 86400000 > 2,
    400,
    "每次申报不可超过 3 天（含起止日期）",
  );
}
function contactFields(body) {
  const company = clean(body.company, 80),
    contact = clean(body.contact, 30),
    phone = clean(body.phone, 11);
  fail(
    !company || !contact || !/^1\d{10}$/.test(phone),
    400,
    "请填写企业名称、联系人和有效的 11 位手机号",
  );
  return { company, contact, phone };
}
async function jsonBody(req) {
  fail(
    !String(req.headers["content-type"] || "").startsWith("application/json"),
    415,
    "请求需要使用 JSON 格式",
  );
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    fail(size > 4500000, 413, "文件过大，请上传 3 MB 以内的设计图");
    chunks.push(c);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "请求格式无效");
  }
  fail(
    !body || Array.isArray(body) || typeof body !== "object",
    400,
    "请求格式无效",
  );
  return body;
}
function decodeImage(value) {
  const match =
    typeof value === "string" &&
    value.match(
      /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/,
    );
  fail(!match, 400, "请上传 PNG、JPG 或 WebP 桁架设计图");
  const buffer = Buffer.from(match[2], "base64");
  fail(
    !buffer.length || buffer.length > 3 * 1024 * 1024,
    400,
    "设计图最大支持 3 MB",
  );
  const valid =
    match[1] === "image/png"
      ? buffer
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : match[1] === "image/jpeg"
        ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
        : buffer.toString("ascii", 0, 4) === "RIFF" &&
          buffer.toString("ascii", 8, 12) === "WEBP";
  fail(!valid, 400, "图片内容与文件格式不匹配");
  return { buffer, type: match[1] };
}
function bookingRow(b) {
  const { image_type, user_id, reviewer, ...rest } = b;
  return { ...rest, hasImage: true };
}

export async function createApp(options = {}) {
  const db = openStore(
    options.dbPath || process.env.DB_PATH || path.join(ROOT, "data/app.sqlite"),
  );
  const secure = options.secureCookies ?? process.env.COOKIE_SECURE === "true";
  const configuredOrigins = (
    options.allowedOrigins ||
    process.env.PUBLIC_ORIGIN ||
    ""
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const dummyHash = await hashPassword(randomToken());
  const audit = (actor, action, target) =>
    db
      .prepare("INSERT INTO audit(actor,action,target,created) VALUES(?,?,?,?)")
      .run(actor, action, target, now());
  async function createAdmin(email, password, company = "大学生活动中心") {
    fail(
      password.includes("REPLACE_"),
      400,
      "请先将 ADMIN_PASSWORD 占位符替换为独立的管理员密码",
    );
    email = emailValue(email);
    fail(
      !emailValid(email) || !passwordValid(password),
      400,
      "管理员邮箱或密码格式不正确，密码至少 10 位并包含字母和数字",
    );
    const existing = db.prepare("SELECT * FROM users WHERE email=?").get(email);
    fail(
      existing && existing.role !== "admin",
      409,
      "该邮箱已注册为企业账号，不能通过配置自动提升权限",
    );
    if (existing) return;
    const id = randomUUID();
    db.prepare(
      "INSERT INTO users(id,email,password_hash,role,company,contact,phone,created) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      id,
      email,
      await hashPassword(password),
      "admin",
      company,
      "管理员",
      "",
      now(),
    );
    audit(id, "account.admin_created", id);
  }
  const admin =
    options.admin ||
    (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD
      ? { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }
      : null);
  if (admin) await createAdmin(admin.email, admin.password);
  function limit(key, max, windowMs) {
    const t = Date.now();
    db.prepare("DELETE FROM rate_limits WHERE reset<?").run(t);
    const existing = db
      .prepare("SELECT * FROM rate_limits WHERE key=?")
      .get(key);
    fail(existing && existing.attempts >= max, 429, "尝试次数过多，请稍后再试");
    db.prepare(
      "INSERT INTO rate_limits(key,attempts,reset) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1",
    ).run(key, t + windowMs);
  }
  function session(req) {
    const raw = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("hust_session="))
      ?.slice(13);
    if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
    const row = db
      .prepare(
        "SELECT s.token_hash,s.csrf,s.expires,u.* FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires>? AND u.disabled=0",
      )
      .get(hashToken(raw), Date.now());
    return row || null;
  }
  function cookie(res, token, expire = false) {
    res.setHeader(
      "Set-Cookie",
      `hust_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expire ? 0 : SESSION_AGE / 1000}${secure ? "; Secure" : ""}`,
    );
  }
  function newSession(res, user) {
    db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    const token = randomToken(),
      csrf = randomToken();
    db.prepare(
      "INSERT INTO sessions(token_hash,user_id,csrf,expires) VALUES(?,?,?,?)",
    ).run(hashToken(token), user.id, csrf, Date.now() + SESSION_AGE);
    cookie(res, token);
    return { user: publicUser(user), csrf };
  }
  function current(req, role) {
    const user = req.user;
    fail(!user, 401, "请先登录");
    fail(role && user.role !== role, 403, "当前账号没有此操作权限");
    if (
      !["/api/auth/password", "/api/auth/logout"].includes(
        req.url.split("?")[0],
      )
    )
      fail(user.must_change, 403, "请先在账号设置中修改临时密码");
    return user;
  }
  function conflict(slot, start, end, except = "") {
    return (
      db
        .prepare(
          "SELECT id FROM bookings WHERE slot=? AND status='已通过' AND start<=? AND end>=? AND id<>?",
        )
        .get(slot, end, start, except) ||
      db
        .prepare("SELECT id FROM closures WHERE slot=? AND start<=? AND end>=?")
        .get(slot, end, start)
    );
  }
  const send = (res, data, status = 200) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(data));
  };
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    const url = new URL(req.url, "http://localhost"),
      p = url.pathname;
    try {
      if (p.startsWith("/api/")) {
        res.setHeader("Cache-Control", "no-store");
        const origin = req.headers.origin;
        const sameOrigins = [
          `http://${req.headers.host}`,
          `https://${req.headers.host}`,
          ...configuredOrigins,
        ];
        fail(origin && !sameOrigins.includes(origin), 403, "请求来源不被允许");
        if (origin && configuredOrigins.includes(origin)) {
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Access-Control-Allow-Credentials", "true");
          res.setHeader("Vary", "Origin");
        }
        if (req.method === "OPTIONS") {
          res.setHeader(
            "Access-Control-Allow-Headers",
            "Content-Type, X-CSRF-Token",
          );
          res.setHeader(
            "Access-Control-Allow-Methods",
            "GET, POST, PATCH, DELETE, OPTIONS",
          );
          res.writeHead(204).end();
          return;
        }
        req.user = session(req);
        if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
          fail(!origin, 403, "缺少请求来源");
          if (req.user)
            fail(
              req.headers["x-csrf-token"] !== req.user.csrf,
              403,
              "安全校验失败，请刷新页面后重试",
            );
        }
        if (p === "/api/health" && req.method === "GET")
          return send(res, { ok: true });
        if (p === "/api/auth/session" && req.method === "GET")
          return send(res, {
            user: publicUser(req.user),
            csrf: req.user?.csrf || null,
          });
        if (p === "/api/auth/register" && req.method === "POST") {
          limit(`register:${req.socket.remoteAddress}`, 10, 3600000);
          const b = await jsonBody(req),
            email = emailValue(b.email),
            fields = contactFields(b);
          fail(!emailValid(email), 400, "请填写有效的邮箱地址");
          fail(
            !passwordValid(b.password),
            400,
            "密码需为 10–128 位，并包含字母和数字",
          );
          fail(
            db.prepare("SELECT id FROM users WHERE email=?").get(email),
            409,
            "该邮箱已注册，请直接登录",
          );
          const hashed = await hashPassword(b.password),
            id = randomUUID();
          try {
            db.prepare(
              "INSERT INTO users(id,email,password_hash,role,company,contact,phone,created) VALUES(?,?,?,?,?,?,?,?)",
            ).run(
              id,
              email,
              hashed,
              "enterprise",
              fields.company,
              fields.contact,
              fields.phone,
              now(),
            );
          } catch (e) {
            if (String(e).includes("UNIQUE"))
              throw new HttpError(409, "该邮箱已注册");
            throw e;
          }
          audit(id, "account.registered", id);
          return send(
            res,
            newSession(
              res,
              db.prepare("SELECT * FROM users WHERE id=?").get(id),
            ),
            201,
          );
        }
        if (p === "/api/auth/login" && req.method === "POST") {
          const b = await jsonBody(req),
            email = emailValue(b.email);
          limit(`login-ip:${req.socket.remoteAddress}`, 60, 900000);
          limit(`login-account:${email}`, 10, 900000);
          fail(
            typeof b.password !== "string" || b.password.length > 128,
            400,
            "邮箱或密码错误",
          );
          const user = db
            .prepare("SELECT * FROM users WHERE email=?")
            .get(email);
          const valid = await verifyPassword(
            b.password,
            user?.password_hash || dummyHash,
          );
          fail(!user || !valid, 401, "邮箱或密码错误");
          fail(user.disabled, 403, "账号已停用，请联系管理员");
          db.prepare("DELETE FROM rate_limits WHERE key=?").run(
            `login-account:${email}`,
          );
          if (req.user)
            db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
              req.user.token_hash,
            );
          audit(user.id, "account.login", user.id);
          return send(res, newSession(res, user));
        }
        if (p === "/api/auth/logout" && req.method === "POST") {
          if (req.user)
            db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
              req.user.token_hash,
            );
          cookie(res, "", true);
          return send(res, { ok: true });
        }
        if (p === "/api/auth/password" && req.method === "POST") {
          const u = current(req),
            b = await jsonBody(req);
          limit(`password:${u.id}`, 10, 900000);
          fail(
            typeof b.currentPassword !== "string" ||
              b.currentPassword.length > 128,
            400,
            "当前密码错误",
          );
          fail(
            !(await verifyPassword(b.currentPassword, u.password_hash)),
            400,
            "当前密码错误",
          );
          fail(
            !passwordValid(b.newPassword),
            400,
            "新密码需为 10–128 位，并包含字母和数字",
          );
          fail(
            b.currentPassword === b.newPassword,
            400,
            "新密码不能与当前密码相同",
          );
          db.prepare(
            "UPDATE users SET password_hash=?,must_change=0 WHERE id=?",
          ).run(await hashPassword(b.newPassword), u.id);
          db.prepare("DELETE FROM sessions WHERE user_id=?").run(u.id);
          cookie(res, "", true);
          audit(u.id, "account.password_changed", u.id);
          return send(res, { ok: true });
        }
        if (p === "/api/profile" && req.method === "PATCH") {
          const u = current(req),
            b = contactFields(await jsonBody(req));
          db.prepare(
            "UPDATE users SET company=?,contact=?,phone=? WHERE id=?",
          ).run(b.company, b.contact, b.phone, u.id);
          audit(u.id, "account.profile_updated", u.id);
          return send(res, {
            user: publicUser(
              db.prepare("SELECT * FROM users WHERE id=?").get(u.id),
            ),
          });
        }
        if (p === "/api/venue" && req.method === "GET") {
          const date = url.searchParams.get("date") || today();
          fail(!dateValid(date), 400, "日期无效");
          const occupied = db
            .prepare(
              "SELECT slot,start,end FROM bookings WHERE status='已通过' AND start<=? AND end>=?",
            )
            .all(date, date);
          const closed = db
            .prepare(
              "SELECT id,slot,start,end,reason FROM closures WHERE start<=? AND end>=?",
            )
            .all(date, date);
          return send(res, { date, total: 29, occupied, closed });
        }
        if (p === "/api/summary" && req.method === "GET") {
          const u = current(req),
            where = u.role === "admin" ? "" : " WHERE user_id=?",
            args = u.role === "admin" ? [] : [u.id];
          const rows = db
            .prepare(
              `SELECT status,COUNT(*) AS count FROM bookings${where} GROUP BY status`,
            )
            .all(...args);
          return send(res, {
            counts: Object.fromEntries(rows.map((r) => [r.status, r.count])),
          });
        }
        if (p === "/api/bookings" && req.method === "GET") {
          const u = current(req),
            conditions = [],
            args = [];
          if (u.role !== "admin") {
            conditions.push("user_id=?");
            args.push(u.id);
          }
          const status = url.searchParams.get("status"),
            q = clean(url.searchParams.get("q"), 80);
          if (status) {
            conditions.push("status=?");
            args.push(status);
          }
          if (q) {
            conditions.push("(company LIKE ? OR contact LIKE ? OR id LIKE ?)");
            args.push(...Array(3).fill(`%${q}%`));
          }
          const where = conditions.length
            ? " WHERE " + conditions.join(" AND ")
            : "";
          const total = db
            .prepare("SELECT COUNT(*) AS total FROM bookings" + where)
            .get(...args).total;
          const page = Math.max(1, parseInt(url.searchParams.get("page")) || 1),
            limit = 15;
          const items = db
            .prepare(
              "SELECT id,company,contact,phone,start,end,slot,status,reason,created,reviewed FROM bookings" +
                where +
                " ORDER BY created DESC LIMIT ? OFFSET ?",
            )
            .all(...args, limit, (page - 1) * limit)
            .map(bookingRow);
          return send(res, {
            items,
            total,
            page,
            pages: Math.max(1, Math.ceil(total / limit)),
          });
        }
        if (p === "/api/bookings" && req.method === "POST") {
          const u = current(req, "enterprise");
          limit(`booking:${u.id}`, 30, 3600000);
          const b = await jsonBody(req),
            fields = contactFields(b),
            slot = Number(b.slot);
          dateRange(b.start, b.end, true);
          fail(
            !Number.isInteger(slot) || slot < 1 || slot > 29,
            400,
            "桁架位无效",
          );
          const image = decodeImage(b.image);
          fail(
            conflict(slot, b.start, b.end),
            409,
            "该位置在所选时间内已占用或暂停开放",
          );
          fail(
            db
              .prepare(
                "SELECT id FROM bookings WHERE user_id=? AND slot=? AND start<=? AND end>=? AND status='待审核'",
              )
              .get(u.id, slot, b.end, b.start),
            409,
            "您已提交该时段的申请，请勿重复申报",
          );
          const id = `HUST-${Date.now()}-${randomBytes(3).toString("hex")}`;
          db.prepare(
            "INSERT INTO bookings(id,user_id,company,contact,phone,start,end,slot,status,image,image_type,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          ).run(
            id,
            u.id,
            fields.company,
            fields.contact,
            fields.phone,
            b.start,
            b.end,
            slot,
            "待审核",
            image.buffer,
            image.type,
            now(),
          );
          audit(u.id, "booking.submitted", id);
          return send(res, { id }, 201);
        }
        const imageMatch = p.match(/^\/api\/bookings\/([^/]+)\/image$/);
        if (imageMatch && req.method === "GET") {
          const u = current(req),
            b = db
              .prepare(
                "SELECT user_id,image,image_type FROM bookings WHERE id=?",
              )
              .get(imageMatch[1]);
          fail(!b, 404, "申请不存在");
          fail(
            u.role !== "admin" && u.id !== b.user_id,
            403,
            "无权查看此设计图",
          );
          res.writeHead(200, {
            "Content-Type": b.image_type,
            "Content-Security-Policy": "default-src 'none'",
            "Content-Disposition": "inline",
          });
          res.end(Buffer.from(b.image));
          return;
        }
        const bookingMatch = p.match(
          /^\/api\/bookings\/([^/]+)(?:\/(review|withdraw))?$/,
        );
        if (bookingMatch) {
          const u = current(req),
            b = db
              .prepare(
                "SELECT id,user_id,company,contact,phone,start,end,slot,status,reason,created,reviewed FROM bookings WHERE id=?",
              )
              .get(bookingMatch[1]);
          fail(!b, 404, "申请不存在");
          fail(u.role !== "admin" && u.id !== b.user_id, 403, "无权访问此申请");
          if (req.method === "GET" && !bookingMatch[2])
            return send(res, { booking: bookingRow(b) });
          if (req.method === "POST" && bookingMatch[2] === "withdraw") {
            fail(b.user_id !== u.id, 403, "只能撤回本企业的申请");
            fail(b.status !== "待审核", 409, "只有待审核申请可以撤回");
            db.prepare(
              "UPDATE bookings SET status='已撤回',reviewed=? WHERE id=?",
            ).run(now(), b.id);
            audit(u.id, "booking.withdrawn", b.id);
            return send(res, { ok: true });
          }
          if (req.method === "POST" && bookingMatch[2] === "review") {
            fail(u.role !== "admin", 403, "仅管理员可以审核");
            const body = await jsonBody(req),
              reason = clean(body.reason, 500);
            fail(
              !["已通过", "未通过"].includes(body.status),
              400,
              "审核结果无效",
            );
            fail(
              body.status === "未通过" && !reason,
              400,
              "未通过时必须填写原因",
            );
            // A synchronous write transaction makes concurrent approval and closure creation atomic.
            db.exec("BEGIN IMMEDIATE");
            try {
              const fresh = db
                .prepare("SELECT status FROM bookings WHERE id=?")
                .get(b.id);
              fail(fresh.status !== "待审核", 409, "该申请已处理，请刷新");
              fail(
                body.status === "已通过" && b.start < today(),
                409,
                "申请日期已过期，请退回企业重新申报",
              );
              fail(
                body.status === "已通过" &&
                  conflict(b.slot, b.start, b.end, b.id),
                409,
                "该位置已有时间冲突的预约或暂停开放安排",
              );
              db.prepare(
                "UPDATE bookings SET status=?,reason=?,reviewed=?,reviewer=? WHERE id=?",
              ).run(body.status, reason, now(), u.id, b.id);
              audit(
                u.id,
                body.status === "已通过"
                  ? "booking.approved"
                  : "booking.rejected",
                b.id,
              );
              db.exec("COMMIT");
            } catch (e) {
              db.exec("ROLLBACK");
              throw e;
            }
            return send(res, { ok: true });
          }
        }
        if (p === "/api/notices" && req.method === "GET")
          return send(res, {
            items: db
              .prepare(
                "SELECT id,title,content,pinned,created,updated FROM notices ORDER BY pinned DESC,created DESC",
              )
              .all(),
          });
        const noticeMatch = p.match(/^\/api\/notices(?:\/([^/]+))?$/);
        if (noticeMatch && ["POST", "PATCH", "DELETE"].includes(req.method)) {
          const u = current(req, "admin"),
            id = noticeMatch[1];
          fail(
            id && !db.prepare("SELECT id FROM notices WHERE id=?").get(id),
            404,
            "公告不存在",
          );
          if (req.method === "DELETE") {
            fail(!id, 400, "缺少公告编号");
            db.prepare("DELETE FROM notices WHERE id=?").run(id);
            audit(u.id, "notice.deleted", id);
            return send(res, { ok: true });
          }
          fail(req.method === "PATCH" && !id, 400, "缺少公告编号");
          const b = await jsonBody(req),
            title = clean(b.title, 80),
            content = clean(b.content, 5000);
          fail(!title || !content, 400, "请填写公告标题和正文");
          const target = id || randomUUID();
          if (id)
            db.prepare(
              "UPDATE notices SET title=?,content=?,pinned=?,updated=? WHERE id=?",
            ).run(title, content, b.pinned ? 1 : 0, now(), id);
          else
            db.prepare(
              "INSERT INTO notices(id,title,content,pinned,created,updated,author) VALUES(?,?,?,?,?,?,?)",
            ).run(target, title, content, b.pinned ? 1 : 0, now(), now(), u.id);
          audit(u.id, "notice.saved", target);
          return send(res, { id: target });
        }
        if (p === "/api/closures" && req.method === "GET") {
          current(req, "admin");
          return send(res, {
            items: db
              .prepare(
                "SELECT * FROM closures WHERE end>=? ORDER BY start,slot",
              )
              .all(today()),
          });
        }
        if (p === "/api/closures" && req.method === "POST") {
          const u = current(req, "admin"),
            b = await jsonBody(req),
            slot = Number(b.slot),
            reason = clean(b.reason, 200);
          dateRange(b.start, b.end);
          fail(
            !Number.isInteger(slot) || slot < 1 || slot > 29 || !reason,
            400,
            "请选择桁架位并填写暂停原因",
          );
          db.exec("BEGIN IMMEDIATE");
          try {
            fail(
              conflict(slot, b.start, b.end),
              409,
              "该时段已有预约或暂停安排",
            );
            const id = randomUUID();
            db.prepare(
              "INSERT INTO closures(id,slot,start,end,reason,created) VALUES(?,?,?,?,?,?)",
            ).run(id, slot, b.start, b.end, reason, now());
            audit(u.id, "venue.closed", id);
            db.exec("COMMIT");
          } catch (e) {
            db.exec("ROLLBACK");
            throw e;
          }
          return send(res, { ok: true }, 201);
        }
        const closureMatch = p.match(/^\/api\/closures\/([^/]+)$/);
        if (closureMatch && req.method === "DELETE") {
          const u = current(req, "admin");
          fail(
            !db.prepare("DELETE FROM closures WHERE id=?").run(closureMatch[1])
              .changes,
            404,
            "暂停安排不存在",
          );
          audit(u.id, "venue.reopened", closureMatch[1]);
          return send(res, { ok: true });
        }
        if (p === "/api/users" && req.method === "GET") {
          current(req, "admin");
          return send(res, {
            items: db
              .prepare(
                "SELECT id,email,role,company,contact,phone,disabled,must_change,created FROM users ORDER BY created DESC LIMIT 1000",
              )
              .all()
              .map(publicUser),
          });
        }
        const userMatch = p.match(
          /^\/api\/users\/([^/]+)\/(status|reset-password)$/,
        );
        if (userMatch && req.method === "POST") {
          const u = current(req, "admin"),
            target = db
              .prepare("SELECT * FROM users WHERE id=?")
              .get(userMatch[1]);
          fail(!target, 404, "账号不存在");
          fail(target.role === "admin", 403, "管理员账号需由系统运维管理");
          if (userMatch[2] === "status") {
            const b = await jsonBody(req);
            fail(typeof b.disabled !== "boolean", 400, "账号状态无效");
            db.prepare("UPDATE users SET disabled=? WHERE id=?").run(
              b.disabled ? 1 : 0,
              target.id,
            );
            if (b.disabled)
              db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
            audit(
              u.id,
              b.disabled ? "account.disabled" : "account.enabled",
              target.id,
            );
            return send(res, { ok: true });
          }
          limit(`reset:${u.id}`, 20, 3600000);
          const password = `Hust${randomBytes(12).toString("base64url")}9`;
          db.prepare(
            "UPDATE users SET password_hash=?,must_change=1 WHERE id=?",
          ).run(await hashPassword(password), target.id);
          db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
          audit(u.id, "account.password_reset", target.id);
          return send(res, { temporaryPassword: password });
        }
        if (p === "/api/audit" && req.method === "GET") {
          current(req, "admin");
          return send(res, {
            items: db
              .prepare(
                "SELECT a.*,u.email FROM audit a LEFT JOIN users u ON a.actor=u.id ORDER BY a.id DESC LIMIT 100",
              )
              .all(),
          });
        }
        throw new HttpError(404, "接口不存在");
      }
      fail(!["GET", "HEAD"].includes(req.method), 405, "不支持的请求方法");
      const staticDir = options.staticDir || path.join(ROOT, "dist");
      let pathname;
      try {
        pathname = decodeURIComponent(p);
      } catch {
        throw new HttpError(400, "路径无效");
      }
      const relative =
          pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""),
        filename = path.resolve(staticDir, relative);
      fail(
        !filename.startsWith(path.resolve(staticDir) + path.sep),
        403,
        "无权访问",
      );
      const ext = path.extname(filename),
        types = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".ico": "image/x-icon",
        };
      fail(!types[ext], 404, "文件不存在");
      let content;
      try {
        fail(!(await stat(filename)).isFile(), 404, "文件不存在");
        content = await readFile(filename);
      } catch {
        throw new HttpError(404, "文件不存在，请先运行 npm run build");
      }
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
      );
      res.writeHead(200, {
        "Content-Type": types[ext],
        "Cache-Control":
          ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
      });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch (error) {
      if (!error.status) console.error("Request failed:", error);
      if (!res.headersSent)
        send(
          res,
          {
            error: error.status ? error.message : "服务暂时不可用，请稍后重试",
          },
          error.status || 500,
        );
      else res.end();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return {
    server,
    db,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      db.close();
    },
  };
}
