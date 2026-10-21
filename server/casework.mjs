import {
  body,
  clean,
  dateValid,
  fail,
  now,
  today,
  versionCheck,
} from "./core.mjs";
import { can } from "../shared/permissions.js";

// One working day means the same Beijing time on the next working date.
// Calendar exceptions are explicitly maintained by the institution, never guessed.
export function workingDeadline(created, overrides = new Map()) {
  const source = new Date(created);
  const local = new Date(source.getTime() + 8 * 3600000);
  for (let n = 0; n < 3660; n++) {
    local.setUTCDate(local.getUTCDate() + 1);
    const date = local.toISOString().slice(0, 10);
    const working = overrides.has(date)
      ? !!overrides.get(date)
      : ![0, 6].includes(local.getUTCDay());
    if (working) return new Date(local.getTime() - 8 * 3600000).toISOString();
  }
  throw new Error("工作日历没有可用的办理日期");
}
export const calendarMap = (db) =>
  new Map(
    db
      .prepare("SELECT * FROM work_calendar")
      .all()
      .map((r) => [r.date, r.working]),
  );
export function overdueCases(db, at = Date.now()) {
  const calendar = calendarMap(db);
  return db
    .prepare(
      "SELECT b.id,b.created FROM bookings b JOIN case_contacts c ON c.booking_id=b.id WHERE b.cancelled=0 AND b.status IN ('待审核','已通过','未通过') AND c.state<>'reached'",
    )
    .all()
    .filter(
      (r) => workingDeadline(r.created, calendar) <= new Date(at).toISOString(),
    ).length;
}

export function caseworkRoutes(db, sec, send, notify) {
  const { current, write, present, audit } = sec;
  const allowed = (u) =>
    u.role === "enterprise" ||
    can(present(u), "bookings.review") ||
    can(present(u), "payments.manage");
  const financeOnly = (u) =>
    u.role !== "enterprise" &&
    !can(present(u), "bookings.review") &&
    can(present(u), "payments.manage");
  // Financial staff need approved bookings and every existing fee record,
  // including cancelled/refunded history, but no unrelated application data.
  const financialScope = (alias) =>
    `(${alias}.status='已通过' OR EXISTS(SELECT 1 FROM booking_fees scoped_fee WHERE scoped_fee.booking_id=${alias}.id))`;
  const getBooking = (id, u) => {
    const b = db
      .prepare(
        "SELECT id,user_id,company,contact,phone,slot,start,end,status,cancelled,created FROM bookings WHERE id=?",
      )
      .get(id);
    fail(
      !b || (u.role === "enterprise" && b.user_id !== u.id),
      404,
      "申请不存在",
    );
    fail(!allowed(u), 403, "当前账号没有办理权限");
    fail(
      financeOnly(u) &&
        !db
          .prepare(
            `SELECT 1 FROM bookings b WHERE b.id=? AND ${financialScope("b")}`,
          )
          .get(id),
      403,
      "当前账号没有此申请的办理权限",
    );
    return b;
  };
  const decorate = (b, u, calendar) => {
    const reviewer = can(present(u), "bookings.review");
    const c = db
      .prepare("SELECT * FROM case_contacts WHERE booking_id=?")
      .get(b.id);
    const due = workingDeadline(b.created, calendar);
    return {
      ...b,
      due,
      overdue:
        !b.cancelled &&
        ["待审核", "已通过", "未通过"].includes(b.status) &&
        c.state !== "reached" &&
        due < now(),
      contactResult: reviewer
        ? c
        : { state: c.state, reached_at: c.reached_at },
      fee:
        u.role === "enterprise" || can(present(u), "payments.manage")
          ? db
              .prepare("SELECT * FROM booking_fees WHERE booking_id=?")
              .get(b.id) || null
          : undefined,
    };
  };
  return async (req, res, url) => {
    const p = url.pathname,
      m = req.method;
    if (p === "/api/casework/calendar" && m === "GET") {
      const u = current(req);
      fail(!allowed(u), 403, "当前账号没有办理权限");
      send(res, {
        ...db.prepare("SELECT version FROM calendar_version WHERE id=1").get(),
        items: db.prepare("SELECT * FROM work_calendar ORDER BY date").all(),
      });
      return true;
    }
    const cal = p.match(/^\/api\/casework\/calendar\/(\d{4}-\d{2}-\d{2})$/);
    if (cal && m === "PUT") {
      current(req, "super");
      const data = await body(req),
        date = cal[1];
      fail(
        !dateValid(date) ||
          Math.abs(Date.parse(date) - Date.parse(today())) >
            3 * 366 * 86400000 ||
          ![true, false, null].includes(data.working),
        400,
        "请选择前后三年内的有效日期及工作日状态",
      );
      write(req, "super", (u) => {
        versionCheck(
          req,
          db.prepare("SELECT version FROM calendar_version WHERE id=1").get(),
          true,
        );
        if (data.working === null)
          db.prepare("DELETE FROM work_calendar WHERE date=?").run(date);
        else
          db.prepare(
            "INSERT INTO work_calendar VALUES(?,?) ON CONFLICT(date) DO UPDATE SET working=excluded.working",
          ).run(date, +data.working);
        db.prepare(
          "UPDATE calendar_version SET version=version+1 WHERE id=1",
        ).run();
        audit(u.id, "case.calendar_updated", date, { working: data.working });
      });
      send(res, { ok: true });
      return true;
    }
    if (p === "/api/casework" && m === "GET") {
      const u = current(req);
      fail(!allowed(u), 403, "当前账号没有办理权限");
      const page = Math.max(
        1,
        Math.min(100000, parseInt(url.searchParams.get("page"), 10) || 1),
      );
      const q = clean(url.searchParams.get("q"), 80),
        scope = url.searchParams.get("scope") || "open";
      fail(!["open", "all"].includes(scope), 400, "筛选条件无效");
      const conditions = [],
        params = [];
      if (u.role === "enterprise") {
        conditions.push("b.user_id=?");
        params.push(u.id);
      }
      if (financeOnly(u)) conditions.push(financialScope("b"));
      if (q) {
        conditions.push("(instr(b.company,?)>0 OR instr(b.id,?)>0)");
        params.push(q, q);
      }
      if (scope === "open") {
        const tasks = [];
        if (u.role === "enterprise" || can(present(u), "bookings.review"))
          tasks.push(
            "(b.cancelled=0 AND b.status IN ('待审核','已通过','未通过') AND c.state<>'reached')",
          );
        if (u.role === "enterprise" || can(present(u), "payments.manage"))
          tasks.push(
            "((b.cancelled=0 AND b.status='已通过' AND (f.state IS NULL OR f.state IN ('due','submitted'))) OR (b.cancelled=1 AND f.state IN ('paid','reconcile')))",
          );
        conditions.push("(" + tasks.join(" OR ") + ")");
      }
      const from =
        " FROM bookings b JOIN case_contacts c ON c.booking_id=b.id LEFT JOIN booking_fees f ON f.booking_id=b.id";
      const where = conditions.length
        ? " WHERE " + conditions.join(" AND ")
        : "";
      const total = db
        .prepare("SELECT COUNT(*) n" + from + where)
        .get(...params).n;
      const calendar = calendarMap(db);
      const rows = db
        .prepare(
          "SELECT b.id,b.user_id,b.company,b.contact,b.phone,b.slot,b.start,b.end,b.status,b.cancelled,b.created" +
            from +
            where +
            " ORDER BY b.created ASC,b.id ASC LIMIT 15 OFFSET ?",
        )
        .all(...params, (page - 1) * 15);
      send(res, {
        items: rows.map((b) => decorate(b, u, calendar)),
        total,
        page,
        pages: Math.max(1, Math.ceil(total / 15)),
      });
      return true;
    }
    const match = p.match(/^\/api\/casework\/([^/]+)(?:\/(contact|fee))?$/);
    if (!match) return false;
    const id = match[1],
      action = match[2];
    if (m === "GET" && !action) {
      const u = current(req),
        b = getBooking(id, u);
      send(res, { item: decorate(b, u, calendarMap(db)) });
      return true;
    }
    if (m !== "POST" || !action) return false;
    current(req, action === "contact" ? "bookings.review" : undefined);
    const data = await body(req);
    write(req, action === "contact" ? "bookings.review" : undefined, (u) => {
      const b = getBooking(id, u);
      if (action === "contact") {
        fail(
          b.cancelled || !["已通过", "未通过"].includes(b.status),
          409,
          "请先完成审批，再登记结果电话通知",
        );
        if (data.action === "reopen") {
          const c = db
            .prepare("SELECT * FROM case_contacts WHERE booking_id=?")
            .get(id);
          versionCheck(req, c, true);
          fail(c.state !== "reached", 409, "仅已完成的电话登记可以重新跟进");
          const reason = clean(data.note, 500);
          fail(!reason, 400, "请填写重新跟进原因");
          db.prepare(
            "UPDATE case_contacts SET state='unreachable',note=?,updated=?,reached_at=NULL,version=version+1 WHERE booking_id=?",
          ).run(reason, now(), id);
          audit(u.id, "case.contact_reopened", id, {
            previous: {
              state: c.state,
              note: c.note,
              reached_at: c.reached_at,
            },
            reason,
          });
          notify(
            b.user_id,
            "审核结果电话需重新跟进",
            "管理员纠正了原电话告知登记，将继续核对联系结果；审核结论不变。",
            id,
          );
          return;
        }
        fail(data.action !== undefined, 400, "电话操作无效");
        fail(
          !["reached", "unreachable"].includes(data.state) ||
            !clean(data.note, 500),
          400,
          "请填写联系结果及核对说明",
        );
        const c = db
          .prepare("SELECT * FROM case_contacts WHERE booking_id=?")
          .get(id);
        versionCheck(req, c, true);
        fail(c.state === "reached", 409, "结果电话已登记完成，不能重复覆盖");
        db.prepare(
          "UPDATE case_contacts SET state=?,attempts=attempts+1,note=?,updated=?,reached_at=?,version=version+1 WHERE booking_id=?",
        ).run(
          data.state,
          clean(data.note, 500),
          now(),
          data.state === "reached" ? now() : null,
          id,
        );
        audit(u.id, "case.contact", id, {
          state: data.state,
          note: clean(data.note, 500),
        });
        if (data.state === "reached")
          notify(
            b.user_id,
            "审核结果电话已登记",
            "管理员已登记审核结果电话告知；审核结论及费用仍以申请记录为准。",
            id,
          );
        return;
      }
      const owner = u.role === "enterprise" && u.id === b.user_id;
      fail(
        !owner && !can(present(u), "payments.manage"),
        403,
        "当前账号没有缴费核对权限",
      );
      const old = db
        .prepare("SELECT * FROM booking_fees WHERE booking_id=?")
        .get(id);
      const active = b.status === "已通过" && !b.cancelled;
      const note = clean(data.note, 500);
      if (data.action === "issue" || data.action === "waive") {
        fail(owner, 403, "仅财务人员可以发出缴费或免缴通知");
        fail(
          !active || (old && old.state !== "void"),
          409,
          "仅可为生效预约创建费用单；修改金额前请先作废未收款费用单",
        );
        if (old) versionCheck(req, old, true);
        fail(!note, 400, "请填写收费依据或免缴说明");
        const amount = data.action === "waive" ? 0 : data.amountFen,
          instructions = clean(data.instructions, 1500);
        fail(
          !Number.isSafeInteger(amount) ||
            amount < 0 ||
            amount > 100000000 ||
            (data.action === "issue" && (!amount || !instructions)),
          400,
          "请填写有效费用（以分为单位，上限一百万元）和收款说明",
        );
        db.prepare(
          "INSERT INTO booking_fees(booking_id,amount_fen,state,instructions,note,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(booking_id) DO UPDATE SET amount_fen=excluded.amount_fen,state=excluded.state,instructions=excluded.instructions,reference='',note=excluded.note,updated=excluded.updated,version=booking_fees.version+1",
        ).run(
          id,
          amount,
          data.action === "waive" ? "waived" : "due",
          instructions,
          note,
          now(),
        );
      } else {
        fail(!old, 404, "尚未发出费用通知");
        versionCheck(req, old, true);
        let state,
          reference = old.reference;
        if (data.action === "submit") {
          fail(!owner, 403, "仅申请企业可以提交付款流水");
          fail(
            !active || old.state !== "due",
            409,
            "当前费用单不可提交付款流水",
          );
          reference = clean(data.reference, 200);
          fail(!reference, 400, "请填写线下付款时间及流水号");
          state = "submitted";
        } else {
          fail(owner, 403, "仅财务人员可以核对费用");
          fail(!note, 400, "请填写核对依据或处理原因");
          if (data.action === "late_confirm") {
            fail(
              !b.cancelled || old.state !== "void",
              409,
              "仅已取消预约的作废费用单可登记迟到到账",
            );
            reference = clean(data.reference, 200);
            fail(!reference, 400, "请填写取消后到账流水");
            state = "paid";
          } else if (data.action === "confirm") {
            fail(
              (!active && old.state !== "reconcile") ||
                !["due", "submitted", "reconcile"].includes(old.state),
              409,
              "当前费用单不可确认收款",
            );
            state = "paid";
          } else if (data.action === "return") {
            fail(
              !active || old.state !== "submitted",
              409,
              "当前费用单不可退回",
            );
            state = "due";
          } else if (data.action === "void") {
            fail(
              !["due", "submitted", "reconcile"].includes(old.state),
              409,
              "已核清的费用不能作废",
            );
            state = "void";
          } else if (data.action === "refund") {
            fail(old.state !== "paid", 409, "仅已收款费用可以登记全额退款");
            state = "refunded";
          } else fail(true, 400, "费用操作无效");
        }
        db.prepare(
          "UPDATE booking_fees SET state=?,reference=?,note=?,updated=?,version=version+1 WHERE booking_id=?",
        ).run(
          state,
          reference,
          data.action === "submit" ? old.note : note,
          now(),
          id,
        );
      }
      const savedFee = db
        .prepare(
          "SELECT amount_fen,state,instructions,reference,note,version FROM booking_fees WHERE booking_id=?",
        )
        .get(id);
      audit(u.id, "case.fee_" + data.action, id, savedFee);
      if (!owner)
        notify(
          b.user_id,
          "布展费用办理状态更新",
          "请打开申请的办理与缴费记录，核对金额、收款说明及最新处理结果。",
          id,
        );
      else {
        for (const r of db
          .prepare(
            "SELECT id FROM users WHERE disabled=0 AND role='admin' AND (is_super=1 OR EXISTS(SELECT 1 FROM user_permissions p WHERE p.user_id=users.id AND p.permission='payments.manage'))",
          )
          .all())
          notify(
            r.id,
            "企业提交了付款流水",
            `${b.company} 的线下付款需要核对，不能仅凭流水提交认定到账。`,
            id,
          );
      }
    });
    send(res, { ok: true });
    return true;
  };
}
