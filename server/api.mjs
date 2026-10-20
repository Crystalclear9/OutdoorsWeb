import { randomUUID, randomBytes } from "node:crypto";
import {
  hashPassword,
  verifyPassword,
  passwordValid,
  hashToken,
  randomToken,
} from "./security.mjs";
import { PERMISSION_KEYS, can } from "../shared/permissions.js";
import {
  createSecurity,
  HttpError,
  fail,
  clean,
  now,
  today,
  dateValid,
  dates,
  fields,
  body,
  tx,
  versionCheck,
  decodeImage,
} from "./core.mjs";

export async function createApi(db, options = {}) {
  const sec = createSecurity(db, options.secureCookies),
    { session, current, present, start, cookie, audit, write, limit } = sec;
  const dummy = await hashPassword(randomToken());
  const email = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
  const validEmail = (v) =>
    v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const userById = (id) => db.prepare("SELECT * FROM users WHERE id=?").get(id);
  const bookingColumns =
    "id,user_id,company,contact,phone,start,end,slot,status,reason,created,reviewed,version";
  const bookingById = (id) =>
    db.prepare(`SELECT ${bookingColumns} FROM bookings WHERE id=?`).get(id);
  const visibleBooking = (b) => {
    const { user_id, ...result } = b;
    return { ...result, hasImage: true };
  };
  const permittedBooking = (u, b) => {
    fail(!b, 404, "申请不存在");
    fail(
      u.id !== b.user_id && !can(present(u), "bookings.review"),
      403,
      "无权查看此申请或设计图",
    );
  };
  const validatePermissions = (permissions) => {
    fail(
      !Array.isArray(permissions) ||
        permissions.some((p) => !PERMISSION_KEYS.includes(p)) ||
        new Set(permissions).size !== permissions.length,
      400,
      "授权列表无效",
    );
    return permissions;
  };
  const savePermissions = (id, permissions) => {
    db.prepare("DELETE FROM user_permissions WHERE user_id=?").run(id);
    for (const p of permissions)
      db.prepare(
        "INSERT INTO user_permissions(user_id,permission) VALUES(?,?)",
      ).run(id, p);
  };
  const send = (res, data, status = 200) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(data));
  };
  async function stepUp(req, data) {
    const u = current(req, "super");
    limit(`access:${u.id}`, 10, 900000);
    fail(
      typeof data.currentPassword !== "string" ||
        data.currentPassword.length > 128 ||
        !(await verifyPassword(data.currentPassword, u.password_hash)),
      403,
      "请填写正确的当前管理员密码以确认授权",
    );
    return u;
  }
  return async function api(req, res, url) {
    const p = url.pathname,
      m = req.method;
    if (p === "/api/health" && m === "GET") return send(res, { ok: true });
    if (p === "/api/auth/session" && m === "GET") {
      const u = session(req);
      return send(res, { user: present(u), csrf: u?.csrf || null });
    }
    if (p === "/api/auth/register" && m === "POST") {
      limit(`register:${req.socket.remoteAddress}`, 10, 3600000);
      const b = await body(req),
        e = email(b.email),
        f = fields(b);
      fail(!validEmail(e), 400, "请填写有效的邮箱地址");
      fail(
        !passwordValid(b.password),
        400,
        "密码需为 10–128 位，并包含字母和数字",
      );
      const hashed = await hashPassword(b.password),
        id = randomUUID();
      const result = tx(db, () => {
        fail(
          db.prepare("SELECT id FROM users WHERE email=?").get(e),
          409,
          "该邮箱已注册，请直接登录",
        );
        db.prepare(
          "INSERT INTO users(id,email,password_hash,role,company,contact,phone,created) VALUES(?,?,?,?,?,?,?,?)",
        ).run(
          id,
          e,
          hashed,
          "enterprise",
          f.company,
          f.contact,
          f.phone,
          now(),
        );
        audit(id, "account.registered", id);
        return start(req, res, userById(id));
      });
      return send(res, result, 201);
    }
    if (p === "/api/auth/login" && m === "POST") {
      const b = await body(req),
        e = email(b.email);
      limit(`login-ip:${req.socket.remoteAddress}`, 60, 900000);
      fail(!validEmail(e), 401, "邮箱或密码错误");
      limit(`login-account:${e}`, 10, 900000);
      fail(
        typeof b.password !== "string" || b.password.length > 128,
        400,
        "邮箱或密码错误",
      );
      const before = db.prepare("SELECT * FROM users WHERE email=?").get(e),
        valid = await verifyPassword(
          b.password,
          before?.password_hash || dummy,
        );
      fail(!before || !valid, 401, "邮箱或密码错误");
      const result = tx(db, () => {
        const fresh = userById(before.id);
        fail(
          !fresh || fresh.password_hash !== before.password_hash,
          401,
          "账号凭据已变化，请重新登录",
        );
        fail(fresh.disabled, 403, "账号已停用，请联系管理员");
        db.prepare("DELETE FROM rate_limits WHERE key=?").run(
          `login-account:${e}`,
        );
        const old = session(req);
        if (old)
          db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
            old.token_hash,
          );
        audit(fresh.id, "account.login", fresh.id);
        return start(req, res, fresh);
      });
      return send(res, result);
    }
    if (p === "/api/auth/logout" && m === "POST") {
      tx(db, () => {
        const u = session(req);
        if (u) {
          current(req);
          db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
            u.token_hash,
          );
        }
      });
      cookie(res, "", true);
      return send(res, { ok: true });
    }
    if (p === "/api/auth/password" && m === "POST") {
      const old = current(req),
        b = await body(req);
      limit(`password:${old.id}`, 10, 900000);
      fail(
        typeof b.currentPassword !== "string" ||
          b.currentPassword.length > 128 ||
          !(await verifyPassword(b.currentPassword, old.password_hash)),
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
      const hashed = await hashPassword(b.newPassword);
      write(req, null, (u) => {
        fail(
          u.password_hash !== old.password_hash,
          409,
          "密码已变化，请重新登录",
        );
        db.prepare(
          "UPDATE users SET password_hash=?,must_change=0,version=version+1 WHERE id=?",
        ).run(hashed, u.id);
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(u.id);
        audit(u.id, "account.password_changed", u.id);
      });
      cookie(res, "", true);
      return send(res, { ok: true });
    }
    if (p === "/api/auth/sessions" && m === "GET") {
      const u = current(req);
      return send(res, {
        items: db
          .prepare(
            "SELECT id,created,expires,agent,token_hash FROM sessions WHERE user_id=? AND expires>? ORDER BY created DESC",
          )
          .all(u.id, Date.now())
          .map(({ token_hash, ...s }) => ({
            ...s,
            current: token_hash === u.token_hash,
          })),
      });
    }
    if (p === "/api/auth/logout-others" && m === "POST") {
      write(req, null, (u) => {
        db.prepare(
          "DELETE FROM sessions WHERE user_id=? AND token_hash<>?",
        ).run(u.id, u.token_hash);
        audit(u.id, "account.other_sessions_revoked", u.id);
      });
      return send(res, { ok: true });
    }
    const sessionMatch = p.match(/^\/api\/auth\/sessions\/([^/]+)$/);
    if (sessionMatch && m === "DELETE") {
      let self = false;
      write(req, null, (u) => {
        const s = db
          .prepare("SELECT token_hash FROM sessions WHERE id=? AND user_id=?")
          .get(sessionMatch[1], u.id);
        fail(!s, 404, "登录会话不存在");
        db.prepare("DELETE FROM sessions WHERE id=? AND user_id=?").run(
          sessionMatch[1],
          u.id,
        );
        self = s.token_hash === u.token_hash;
        audit(u.id, "account.session_revoked", sessionMatch[1]);
      });
      if (self) cookie(res, "", true);
      return send(res, { ok: true, current: self });
    }
    if (p === "/api/profile" && m === "PATCH") {
      current(req);
      const f = fields(await body(req));
      const result = write(req, null, (u) => {
        db.prepare(
          "UPDATE users SET company=?,contact=?,phone=?,version=version+1 WHERE id=?",
        ).run(f.company, f.contact, f.phone, u.id);
        audit(u.id, "account.profile_updated", u.id);
        return present(userById(u.id));
      });
      return send(res, { user: result });
    }
    if (p === "/api/venue" && m === "GET") {
      const date = url.searchParams.get("date") || today();
      fail(!dateValid(date), 400, "日期无效");
      return send(res, {
        date,
        total: 29,
        occupied: db
          .prepare(
            "SELECT slot,start,end FROM bookings WHERE status='已通过' AND start<=? AND end>=?",
          )
          .all(date, date),
        closed: db
          .prepare(
            "SELECT id,slot,start,end,reason FROM closures WHERE start<=? AND end>=?",
          )
          .all(date, date),
      });
    }
    if (p === "/api/summary" && m === "GET") {
      const u = current(req),
        all = can(present(u), "bookings.review");
      fail(u.role !== "enterprise" && !all, 403, "当前账号没有申请查看权限");
      const rows = db
        .prepare(
          `SELECT status,COUNT(*) AS count FROM bookings${all ? "" : " WHERE user_id=?"} GROUP BY status`,
        )
        .all(...(all ? [] : [u.id]));
      return send(res, {
        counts: Object.fromEntries(rows.map((r) => [r.status, r.count])),
      });
    }
    if (p === "/api/bookings" && m === "GET") {
      const u = current(req),
        conditions = [],
        args = [];
      fail(
        u.role !== "enterprise" && !can(present(u), "bookings.review"),
        403,
        "当前账号没有申请查看权限",
      );
      if (!can(present(u), "bookings.review")) {
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
          : "",
        page = Math.max(
          1,
          Math.min(100000, parseInt(url.searchParams.get("page")) || 1),
        ),
        limit = 15;
      const total = db
        .prepare("SELECT COUNT(*) AS total FROM bookings" + where)
        .get(...args).total;
      return send(res, {
        items: db
          .prepare(
            `SELECT ${bookingColumns} FROM bookings${where} ORDER BY created DESC,id DESC LIMIT ? OFFSET ?`,
          )
          .all(...args, limit, (page - 1) * limit)
          .map(visibleBooking),
        total,
        page,
        pages: Math.max(1, Math.ceil(total / limit)),
      });
    }
    if (p === "/api/bookings" && m === "POST") {
      const u = current(req, "enterprise");
      const b = await body(req),
        f = fields(b),
        slot = Number(b.slot);
      dates(b.start, b.end, true);
      fail(!Number.isInteger(slot) || slot < 1 || slot > 29, 400, "桁架位无效");
      const image = decodeImage(b.image);
      const key = req.headers["idempotency-key"];
      fail(
        key !== undefined &&
          (typeof key !== "string" || !/^[\w-]{16,128}$/.test(key)),
        400,
        "重复请求标识无效",
      );
      const fingerprint = hashToken(
        JSON.stringify({
          ...f,
          slot,
          start: b.start,
          end: b.end,
          image: hashToken(image.image),
        }),
      );
      const result = write(req, "enterprise", (fresh) => {
        if (key) {
          const old = db
            .prepare("SELECT * FROM idempotency WHERE user_id=? AND key=?")
            .get(fresh.id, key);
          if (old) {
            fail(
              old.request_hash !== fingerprint,
              409,
              "同一请求标识不能用于不同申请",
            );
            return JSON.parse(old.response);
          }
        }
        limit(`booking:${fresh.id}`, 30, 3600000);
        fail(
          db
            .prepare(
              "SELECT id FROM bookings WHERE slot=? AND status='已通过' AND start<=? AND end>=?",
            )
            .get(slot, b.end, b.start) ||
            db
              .prepare(
                "SELECT id FROM closures WHERE slot=? AND start<=? AND end>=?",
              )
              .get(slot, b.end, b.start),
          409,
          "该位置在所选时间内已占用或暂停开放",
        );
        const id = `HUST-${Date.now()}-${randomBytes(6).toString("hex")}`;
        db.prepare(
          "INSERT INTO bookings(id,user_id,company,contact,phone,start,end,slot,status,image,image_type,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          id,
          fresh.id,
          f.company,
          f.contact,
          f.phone,
          b.start,
          b.end,
          slot,
          "待审核",
          image.image,
          image.type,
          now(),
        );
        audit(fresh.id, "booking.submitted", id);
        if (key)
          db.prepare(
            "INSERT INTO idempotency(user_id,key,request_hash,response,created) VALUES(?,?,?,?,?)",
          ).run(fresh.id, key, fingerprint, JSON.stringify({ id }), Date.now());
        return { id };
      });
      return send(res, result, 201);
    }
    const imageMatch = p.match(/^\/api\/bookings\/([^/]+)\/image$/);
    if (imageMatch && m === "GET") {
      const u = current(req),
        b = db
          .prepare("SELECT user_id,image,image_type FROM bookings WHERE id=?")
          .get(imageMatch[1]);
      permittedBooking(u, b);
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
        id = bookingMatch[1],
        initial = bookingById(id);
      permittedBooking(u, initial);
      if (m === "GET" && !bookingMatch[2]) {
        res.setHeader("ETag", `"${initial.version}"`);
        return send(res, { booking: visibleBooking(initial) });
      }
      if (m === "POST" && bookingMatch[2] === "withdraw") {
        write(req, "enterprise", (fresh) => {
          const b = bookingById(id);
          permittedBooking(fresh, b);
          fail(b.user_id !== fresh.id, 403, "只能撤回本企业的申请");
          versionCheck(req, b);
          fail(b.status !== "待审核", 409, "只有待审核申请可以撤回");
          db.prepare(
            "UPDATE bookings SET status='已撤回',reviewed=?,version=version+1 WHERE id=? AND status='待审核'",
          ).run(now(), id);
          audit(fresh.id, "booking.withdrawn", id);
        });
        return send(res, { ok: true });
      }
      if (m === "POST" && bookingMatch[2] === "review") {
        current(req, "bookings.review");
        const b = await body(req),
          reason = clean(b.reason, 500);
        fail(!["已通过", "未通过"].includes(b.status), 400, "审核结果无效");
        fail(b.status === "未通过" && !reason, 400, "未通过时必须填写原因");
        write(req, "bookings.review", (fresh) => {
          const row = bookingById(id);
          fail(!row, 404, "申请不存在");
          fail(row.user_id === fresh.id, 403, "不能审核自己提交的申请");
          versionCheck(req, row);
          fail(row.status !== "待审核", 409, "该申请已处理，请刷新");
          fail(
            b.status === "已通过" && row.start < today(),
            409,
            "申请日期已过期，请退回企业重新申报",
          );
          db.prepare(
            "UPDATE bookings SET status=?,reason=?,reviewed=?,reviewer=?,version=version+1 WHERE id=?",
          ).run(b.status, reason, now(), fresh.id, id);
          audit(
            fresh.id,
            b.status === "已通过" ? "booking.approved" : "booking.rejected",
            id,
          );
        });
        return send(res, { ok: true });
      }
    }
    if (p === "/api/notices" && m === "GET")
      return send(res, {
        items: db
          .prepare(
            "SELECT id,title,content,pinned,created,updated,version FROM notices ORDER BY pinned DESC,created DESC,id DESC",
          )
          .all(),
      });
    const noticeMatch = p.match(/^\/api\/notices(?:\/([^/]+))?$/);
    if (noticeMatch && ["POST", "PATCH", "DELETE"].includes(m)) {
      current(req, "notices.manage");
      const id = noticeMatch[1];
      fail(m !== "POST" && !id, 400, "缺少公告编号");
      fail(m === "POST" && !!id, 405, "请求方法无效");
      if (m === "DELETE") {
        write(req, "notices.manage", (u) => {
          const old = db.prepare("SELECT * FROM notices WHERE id=?").get(id);
          fail(!old, 404, "公告不存在");
          versionCheck(req, old, true);
          db.prepare("DELETE FROM notices WHERE id=?").run(id);
          audit(u.id, "notice.deleted", id);
        });
        return send(res, { ok: true });
      }
      const b = await body(req),
        title = clean(b.title, 80),
        content = clean(b.content, 5000);
      fail(!title || !content, 400, "请填写公告标题和正文");
      const target = id || randomUUID();
      write(req, "notices.manage", (u) => {
        if (id) {
          const old = db.prepare("SELECT * FROM notices WHERE id=?").get(id);
          fail(!old, 404, "公告不存在");
          versionCheck(req, old, true);
          db.prepare(
            "UPDATE notices SET title=?,content=?,pinned=?,updated=?,version=version+1 WHERE id=?",
          ).run(title, content, b.pinned ? 1 : 0, now(), id);
        } else
          db.prepare(
            "INSERT INTO notices(id,title,content,pinned,created,updated,author) VALUES(?,?,?,?,?,?,?)",
          ).run(target, title, content, b.pinned ? 1 : 0, now(), now(), u.id);
        audit(u.id, "notice.saved", target);
      });
      return send(res, { id: target });
    }
    if (p === "/api/closures" && m === "GET") {
      current(req, "venue.manage");
      return send(res, {
        items: db
          .prepare("SELECT * FROM closures WHERE end>=? ORDER BY start,slot")
          .all(today()),
      });
    }
    if (p === "/api/closures" && m === "POST") {
      current(req, "venue.manage");
      const b = await body(req),
        slot = Number(b.slot),
        reason = clean(b.reason, 200);
      dates(b.start, b.end);
      fail(
        !Number.isInteger(slot) || slot < 1 || slot > 29 || !reason,
        400,
        "请选择桁架位并填写暂停原因",
      );
      write(req, "venue.manage", (u) => {
        const id = randomUUID();
        db.prepare(
          "INSERT INTO closures(id,slot,start,end,reason,created) VALUES(?,?,?,?,?,?)",
        ).run(id, slot, b.start, b.end, reason, now());
        audit(u.id, "venue.closed", id);
      });
      return send(res, { ok: true }, 201);
    }
    const closureMatch = p.match(/^\/api\/closures\/([^/]+)$/);
    if (closureMatch && m === "DELETE") {
      write(req, "venue.manage", (u) => {
        fail(
          !db.prepare("DELETE FROM closures WHERE id=?").run(closureMatch[1])
            .changes,
          404,
          "暂停安排不存在",
        );
        audit(u.id, "venue.reopened", closureMatch[1]);
      });
      return send(res, { ok: true });
    }
    if (p === "/api/users" && m === "GET") {
      const u = current(req, "accounts.manage");
      return send(res, {
        items: db
          .prepare(
            `SELECT * FROM users${u.is_super ? "" : " WHERE role='enterprise'"} ORDER BY created DESC LIMIT 1000`,
          )
          .all()
          .map(present),
      });
    }
    const userMatch = p.match(
      /^\/api\/users\/([^/]+)\/(status|reset-password)$/,
    );
    if (userMatch && m === "POST") {
      const actor = current(req, "accounts.manage"),
        id = userMatch[1],
        target = userById(id);
      fail(!target, 404, "账号不存在");
      fail(
        target.is_super ||
          target.id === actor.id ||
          (target.role === "admin" && !actor.is_super),
        403,
        "无权管理此管理员账号",
      );
      if (userMatch[2] === "status") {
        const b = await body(req);
        fail(typeof b.disabled !== "boolean", 400, "账号状态无效");
        write(req, "accounts.manage", (u) => {
          const fresh = userById(id);
          fail(!fresh, 404, "账号不存在");
          fail(
            fresh.is_super || (fresh.role === "admin" && !u.is_super),
            403,
            "无权管理此账号",
          );
          versionCheck(req, fresh);
          db.prepare(
            "UPDATE users SET disabled=?,version=version+1 WHERE id=?",
          ).run(b.disabled ? 1 : 0, id);
          if (b.disabled)
            db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
          audit(u.id, b.disabled ? "account.disabled" : "account.enabled", id);
        });
        return send(res, { ok: true });
      }
      limit(`reset:${actor.id}`, 20, 3600000);
      const temporaryPassword = `Hust${randomBytes(12).toString("base64url")}9`,
        hashed = await hashPassword(temporaryPassword);
      write(req, "accounts.manage", (u) => {
        const fresh = userById(id);
        fail(!fresh, 404, "账号不存在");
        fail(
          fresh.is_super || (fresh.role === "admin" && !u.is_super),
          403,
          "无权管理此账号",
        );
        versionCheck(req, fresh);
        db.prepare(
          "UPDATE users SET password_hash=?,must_change=1,version=version+1 WHERE id=?",
        ).run(hashed, id);
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
        audit(u.id, "account.password_reset", id);
      });
      return send(res, { temporaryPassword });
    }
    if (p === "/api/access" && m === "GET") {
      current(req, "super");
      return send(res, {
        items: db
          .prepare("SELECT * FROM users WHERE role='admin' ORDER BY created")
          .all()
          .map(present),
      });
    }
    if (p === "/api/access/staff" && m === "POST") {
      current(req, "super");
      const b = await body(req);
      await stepUp(req, b);
      const e = email(b.email),
        contact = clean(b.contact, 30),
        permissions = validatePermissions(b.permissions);
      fail(!validEmail(e) || !contact, 400, "请填写有效的邮箱和管理员姓名");
      const temporaryPassword = `Hust${randomBytes(12).toString("base64url")}9`,
        hashed = await hashPassword(temporaryPassword),
        id = randomUUID();
      write(req, "super", (u) => {
        fail(
          db.prepare("SELECT id FROM users WHERE email=?").get(e),
          409,
          "该邮箱已存在，请使用独立的管理员邮箱",
        );
        db.prepare(
          "INSERT INTO users(id,email,password_hash,role,company,contact,phone,must_change,created) VALUES(?,?,?,'admin','大学生活动中心',?,'',1,?)",
        ).run(id, e, hashed, contact, now());
        savePermissions(id, permissions);
        audit(u.id, "access.staff_created", id, { permissions });
      });
      return send(res, { user: present(userById(id)), temporaryPassword }, 201);
    }
    const accessMatch = p.match(/^\/api\/access\/([^/]+)$/);
    if (accessMatch && m === "PATCH") {
      current(req, "super");
      const b = await body(req);
      await stepUp(req, b);
      const permissions = validatePermissions(b.permissions);
      write(req, "super", (u) => {
        const target = userById(accessMatch[1]);
        fail(!target || target.role !== "admin", 404, "管理员账号不存在");
        fail(
          target.is_super || target.id === u.id,
          403,
          "超级管理员权限不可通过页面修改",
        );
        versionCheck(req, target, true);
        const previous = present(target).permissions;
        savePermissions(target.id, permissions);
        db.prepare("UPDATE users SET version=version+1 WHERE id=?").run(
          target.id,
        );
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
        audit(u.id, "access.permissions_changed", target.id, {
          before: previous,
          after: permissions,
        });
      });
      return send(res, { ok: true });
    }
    if (p === "/api/audit" && m === "GET") {
      current(req, "audit.read");
      return send(res, {
        items: db
          .prepare(
            "SELECT a.*,u.email FROM audit a LEFT JOIN users u ON a.actor=u.id ORDER BY a.id DESC LIMIT 100",
          )
          .all(),
      });
    }
    throw new HttpError(404, "接口不存在");
  };
}
