import { randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  body,
  fail,
  dates,
  dateValid,
  today,
  now,
  clean,
  versionCheck,
  tx,
} from "./core.mjs";
import { hashToken } from "./security.mjs";

export function archiveHistory(db, days = 365) {
  fail(
    !Number.isInteger(days) || days < 30 || days > 3650,
    500,
    "归档保留期应为 30–3650 天",
  );
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  let images = 0,
    audits = 0;
  // Small independent transactions keep approvals responsive. Archives remain in the
  // same SQLite snapshot, so restoring a backup also restores archived materials.
  const rows = db
    .prepare(
      "SELECT id FROM bookings WHERE end<? AND status<>'待审核' AND length(image)>0 LIMIT 20",
    )
    .all(cutoff.slice(0, 10));
  for (const { id } of rows)
    tx(db, () => {
      const row = db
        .prepare("SELECT image FROM bookings WHERE id=? AND length(image)>0")
        .get(id);
      if (!row) return;
      const bytes = Buffer.from(row.image),
        content = gzipSync(bytes);
      db.prepare("INSERT OR IGNORE INTO archives VALUES(?,?,?,?,?,?,?,?)").run(
        `image-${id}`,
        "image",
        now(),
        cutoff,
        1,
        bytes.length,
        hashToken(bytes),
        content,
      );
      db.prepare("UPDATE bookings SET image=X'' WHERE id=?").run(id);
      images++;
    });
  tx(db, () => {
    const rows = db
      .prepare(
        "SELECT a.*,u.email FROM audit a LEFT JOIN users u ON a.actor=u.id WHERE a.created<? ORDER BY a.id LIMIT 2000",
      )
      .all(cutoff);
    if (!rows.length) return;
    const bytes = Buffer.from(rows.map((r) => JSON.stringify(r)).join("\n")),
      content = gzipSync(bytes);
    db.prepare("INSERT INTO archives VALUES(?,?,?,?,?,?,?,?)").run(
      randomUUID(),
      "audit",
      now(),
      cutoff,
      rows.length,
      bytes.length,
      hashToken(bytes),
      content,
    );
    db.prepare("DELETE FROM audit WHERE id<=? AND created<?").run(
      rows.at(-1).id,
      cutoff,
    );
    audits = rows.length;
  });
  return { images, audits, cutoff };
}

export function archivedImage(db, id) {
  const row = db
    .prepare("SELECT content,sha256 FROM archives WHERE id=? AND kind='image'")
    .get(`image-${id}`);
  fail(!row, 404, "归档设计图不存在");
  const bytes = gunzipSync(row.content, { maxOutputLength: 6 * 1024 * 1024 });
  fail(
    hashToken(bytes) !== row.sha256,
    503,
    "归档完整性校验失败，请联系管理员",
  );
  return bytes;
}

export function businessRoutes(db, sec, send, notifyReviewers, maintenance) {
  const { current, write, audit } = sec;
  return async (req, res, url) => {
    const p = url.pathname,
      m = req.method;
    if (p === "/api/operations/deliveries" && m === "GET") {
      current(req, "super");
      send(res, {
        items: db
          .prepare(
            "SELECT id,kind,state,attempts,last_error,created,delivered,payload,version FROM delivery_jobs ORDER BY created DESC LIMIT 50",
          )
          .all()
          .map(({ payload, ...r }) => {
            const p = JSON.parse(payload);
            return {
              ...r,
              bookingId: p.bookingId,
              phone: p.phone.slice(0, 3) + "****" + p.phone.slice(-4),
            };
          }),
      });
      return true;
    }
    const reconcile = p.match(/^\/api\/operations\/deliveries\/([^/]+)$/);
    if (reconcile && m === "POST") {
      const b = await body(req);
      fail(
        !["accepted", "failed", "retry"].includes(b.action) ||
          !clean(b.reason, 300) ||
          !Number.isInteger(b.version),
        400,
        "请填写核实结果、原因和最新版本",
      );
      write(req, "super", (u) => {
        const job = db
          .prepare("SELECT * FROM delivery_jobs WHERE id=?")
          .get(reconcile[1]);
        fail(!job, 404, "任务不存在");
        fail(
          !["uncertain", "failed"].includes(job.state) ||
            job.version !== b.version,
          409,
          "任务已变化，请刷新",
        );
        fail(
          job.state === "uncertain" && b.action === "retry",
          400,
          "请先核实服务商未受理并标记失败，再决定是否重试",
        );
        db.prepare(
          "UPDATE delivery_jobs SET version=version+1,state=?,next_at=?,last_error=?,delivered=? WHERE id=?",
        ).run(
          b.action === "retry" ? "pending" : b.action,
          Date.now(),
          `人工核实：${clean(b.reason, 300)}`,
          b.action === "accepted" ? now() : null,
          job.id,
        );
        audit(u.id, "delivery.reconciled", job.id, {
          action: b.action,
          reason: clean(b.reason, 300),
        });
      });
      send(res, { ok: true });
      return true;
    }
    if (p === "/api/onsite" && m === "GET") {
      current(req, "venue.manage");
      const date = url.searchParams.get("date") || today();
      fail(!dateValid(date), 400, "日期无效");
      send(res, {
        date,
        items: db
          .prepare("SELECT * FROM onsite WHERE date=? ORDER BY slot")
          .all(date),
        approved: db
          .prepare(
            "SELECT id,company,slot FROM bookings WHERE status='已通过' AND cancelled=0 AND start<=? AND end>=?",
          )
          .all(date, date),
      });
      return true;
    }
    if (p === "/api/onsite" && m === "POST") {
      current(req, "venue.manage");
      const b = await body(req);
      fail(
        b.date !== today(),
        400,
        "只能登记今天的现场状态，历史记录保留供查询",
      );
      fail(
        !Array.isArray(b.items) ||
          !b.items.length ||
          b.items.length > 29 ||
          b.items.some(
            (i) => !i || typeof i !== "object" || Array.isArray(i),
          ) ||
          new Set(b.items.map((i) => i.slot)).size !== b.items.length,
        400,
        "登记列表无效",
      );
      write(req, "venue.manage", (u) => {
        fail(
          b.date !== today(),
          400,
          "只能登记今天的现场状态，历史记录保留供查询",
        );
        for (const i of b.items) {
          fail(
            !Number.isInteger(i.slot) ||
              i.slot < 1 ||
              i.slot > 29 ||
              typeof i.present !== "boolean" ||
              !Number.isInteger(i.version),
            400,
            "位置或版本无效",
          );
          const old = db
            .prepare("SELECT * FROM onsite WHERE date=? AND slot=?")
            .get(b.date, i.slot);
          fail(
            (old?.version || 0) !== i.version,
            409,
            `${i.slot} 号位置已被他人更新，请刷新后重试`,
          );
          db.prepare(
            "INSERT INTO onsite VALUES(?,?,?,?,?,?,?) ON CONFLICT(date,slot) DO UPDATE SET present=excluded.present,note=excluded.note,actor=excluded.actor,updated=excluded.updated,version=excluded.version",
          ).run(
            b.date,
            i.slot,
            +i.present,
            clean(i.note, 300),
            u.id,
            now(),
            i.version + 1,
          );
          audit(u.id, "venue.onsite_updated", `${b.date}/${i.slot}`, {
            present: i.present,
            note: clean(i.note, 300),
          });
        }
      });
      send(res, { ok: true });
      return true;
    }
    const match = p.match(/^\/api\/bookings\/([^/]+)\/reschedule$/);
    if (match && m === "POST") {
      current(req, "enterprise");
      const b = await body(req),
        slot = Number(b.slot);
      dates(b.start, b.end, true);
      fail(!Number.isInteger(slot) || slot < 1 || slot > 29, 400, "位置无效");
      const result = write(req, "enterprise", (u) => {
        dates(b.start, b.end, true);
        sec.limit(`reschedule:${u.id}`, 20, 3600000);
        const old = db
          .prepare("SELECT * FROM bookings WHERE id=? AND user_id=?")
          .get(match[1], u.id);
        fail(!old, 404, "预约不存在");
        versionCheck(req, old, true);
        fail(
          old.status !== "已通过" || old.cancelled || old.start < today(),
          409,
          "仅未开始的生效预约可以改期",
        );
        fail(
          old.slot === slot && old.start === b.start && old.end === b.end,
          400,
          "请选择新的日期或位置",
        );
        fail(
          db
            .prepare(
              "SELECT id FROM bookings WHERE reschedule_of=? AND status='待审核'",
            )
            .get(old.id),
          409,
          "已有待审核改期，请先撤回该改期申请",
        );
        fail(
          db
            .prepare(
              "SELECT id FROM bookings WHERE id<>? AND slot=? AND status='已通过' AND cancelled=0 AND start<=? AND end>=?",
            )
            .get(old.id, slot, b.end, b.start) ||
            db
              .prepare(
                "SELECT id FROM closures WHERE slot=? AND start<=? AND end>=?",
              )
              .get(slot, b.end, b.start),
          409,
          "新时段已占用或暂停开放",
        );
        const id = `HUST-${Date.now()}-${randomUUID().slice(0, 12)}`;
        fail(
          !maintenance.health(false).ok,
          503,
          "存储服务异常或空间不足，请联系管理员",
        );
        // A copy keeps both applications independently reviewable and auditable.
        const image = old.image.length ? old.image : archivedImage(db, old.id);
        fail(
          db
            .prepare(
              "SELECT COALESCE(SUM(length(image)),0) n FROM bookings WHERE user_id=?",
            )
            .get(u.id).n +
            image.length >
            200 * 1024 * 1024,
          413,
          "账号设计图存储已达上限，请联系管理员归档历史资料",
        );
        db.prepare(
          "INSERT INTO bookings(id,user_id,company,contact,phone,start,end,slot,status,image,image_type,created,reschedule_of) VALUES(?,?,?,?,?,?,?,?,'待审核',?,?,?,?)",
        ).run(
          id,
          u.id,
          old.company,
          old.contact,
          old.phone,
          b.start,
          b.end,
          slot,
          image,
          old.image_type,
          now(),
          old.id,
        );
        audit(u.id, "booking.reschedule_requested", id, { original: old.id });
        notifyReviewers(
          "预约改期待审核",
          `${old.company} 申请改期，原预约在审批通过前继续保留。`,
          id,
        );
        return { id };
      });
      send(res, result, 201);
      return true;
    }
    if (p === "/api/archives" && m === "GET") {
      current(req, "audit.read");
      const page = Math.max(
        1,
        Math.min(100000, parseInt(url.searchParams.get("page")) || 1),
      );
      const total = db
        .prepare("SELECT COUNT(*) n FROM archives WHERE kind='audit'")
        .get().n;
      send(res, {
        items: db
          .prepare(
            "SELECT id,kind,created,cutoff,records,bytes,sha256 FROM archives WHERE kind='audit' ORDER BY created DESC LIMIT 20 OFFSET ?",
          )
          .all((page - 1) * 20),
        page,
        pages: Math.max(1, Math.ceil(total / 20)),
        total,
      });
      return true;
    }
    const download = p.match(/^\/api\/archives\/([^/]+)$/);
    if (download && m === "GET") {
      current(req, "audit.read");
      const row = db
        .prepare("SELECT * FROM archives WHERE id=? AND kind='audit'")
        .get(download[1]);
      fail(!row, 404, "归档不存在");
      const bytes = gunzipSync(row.content);
      fail(hashToken(bytes) !== row.sha256, 503, "归档完整性校验失败");
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        "Content-Disposition": `attachment; filename="audit-${row.id}.jsonl"`,
      });
      res.end(bytes);
      return true;
    }
    return false;
  };
}
