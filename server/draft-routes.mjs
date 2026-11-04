import { randomUUID } from "node:crypto";
import {
  body,
  clean,
  decodeImage,
  fail,
  now,
  today,
  versionCheck,
} from "./core.mjs";

export function checkDraftSource(db, userId, source) {
  if (!source) return null;
  fail(
    typeof source !== "string" || source.length > 100,
    400,
    "原申请编号无效",
  );
  const row = db
    .prepare("SELECT * FROM bookings WHERE id=? AND user_id=?")
    .get(source, userId);
  fail(!row, 404, "原申请不存在");
  fail(
    !["未通过", "已撤回"].includes(row.status) &&
      !(row.status === "待审核" && row.start < today()),
    409,
    "仅退回、撤回或过期未审核的申请可复制修改",
  );
  return source;
}
export function createDraftRoutes(db, sec, send, maintenance) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS booking_drafts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),payload TEXT NOT NULL,image BLOB,image_type TEXT,version INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL,updated TEXT NOT NULL); CREATE INDEX IF NOT EXISTS booking_drafts_owner ON booking_drafts(user_id);`,
  );
  const owned = (id, userId) => {
    const row = db
      .prepare("SELECT * FROM booking_drafts WHERE id=? AND user_id=?")
      .get(id, userId);
    fail(!row, 404, "草稿不存在");
    return row;
  };
  const view = (row, full = true) => ({
    id: row.id,
    version: row.version,
    payload: JSON.parse(row.payload),
    created: row.created,
    updated: row.updated,
    ...(full
      ? {
          image: row.image
            ? `data:${row.image_type};base64,${Buffer.from(row.image).toString("base64")}`
            : null,
        }
      : {}),
  });
  return async (req, res, url) => {
    const path = url.pathname,
      match = path.match(/^\/api\/drafts\/([\w-]{1,100})$/);
    if (path !== "/api/drafts" && !match) return false;
    const u = sec.current(req, "enterprise"),
      method = req.method;
    if (method === "GET") {
      send(
        res,
        match
          ? { draft: view(owned(match[1], u.id)) }
          : {
              items: db
                .prepare(
                  "SELECT id,payload,version,created,updated FROM booking_drafts WHERE user_id=? ORDER BY updated DESC,id",
                )
                .all(u.id)
                .map((r) => view(r, false)),
            },
      );
      return true;
    }
    if (method === "DELETE" && match) {
      sec.write(req, "enterprise", (fresh) => {
        versionCheck(req, owned(match[1], fresh.id), true);
        db.prepare("DELETE FROM booking_drafts WHERE id=? AND user_id=?").run(
          match[1],
          fresh.id,
        );
      });
      send(res, { ok: true });
      return true;
    }
    fail(
      !(method === "POST" && !match) && !(method === "PATCH" && match),
      405,
      "不支持的草稿操作",
    );
    sec.limit(`draft-save:${u.id}`, 60, 3600000);
    const b = await body(req),
      payload = {};
    fail(
      !b.payload || typeof b.payload !== "object" || Array.isArray(b.payload),
      400,
      "草稿内容无效",
    );
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
      fail(
        b.payload[key] != null &&
          (typeof b.payload[key] !== "string" || b.payload[key].length > max),
        400,
        "草稿字段格式或长度无效",
      );
      payload[key] = clean(b.payload[key], max);
    }
    let image;
    if (b.image != null) {
      image = await decodeImage(b.image);
      // A restored draft is a valid upload too. Do not persist a normalized
      // image larger than the public submission upload limit.
      fail(
        image.image.length > 3 * 1024 * 1024,
        413,
        "草稿设计图解码后超过3 MB，请降低分辨率后保存",
      );
    }
    const id = match?.[1] || b.id || randomUUID();
    fail(
      typeof id !== "string" || !/^[\w-]{1,100}$/.test(id),
      400,
      "草稿编号无效",
    );
    const row = sec.write(req, "enterprise", (fresh) => {
      checkDraftSource(db, fresh.id, payload.source_booking_id);
      const old = match ? owned(id, fresh.id) : null;
      if (old) versionCheck(req, old, true);
      else {
        const existing = db
          .prepare("SELECT * FROM booking_drafts WHERE id=?")
          .get(id);
        if (existing) {
          fail(
            existing.user_id !== fresh.id ||
              existing.payload !== JSON.stringify(payload) ||
              Buffer.compare(
                Buffer.from(existing.image || []),
                image?.image || Buffer.alloc(0),
              ) !== 0,
            409,
            "草稿编号已使用，请重新读取草稿",
          );
          return existing;
        }
        fail(
          db
            .prepare("SELECT COUNT(*) n FROM booking_drafts WHERE user_id=?")
            .get(fresh.id).n >= 20,
          413,
          "最多保存20份草稿，请先删除不再使用的草稿",
        );
      }
      const bytes = b.image === undefined ? old?.image : image?.image;
      const type = b.image === undefined ? old?.image_type : image?.type;
      const used = db
        .prepare(
          "SELECT (SELECT COALESCE(SUM(length(image)),0) FROM bookings WHERE user_id=?) + (SELECT COALESCE(SUM(length(image)),0) FROM booking_drafts WHERE user_id=? AND id<>?) bytes",
        )
        .get(fresh.id, fresh.id, id).bytes;
      fail(
        used + (bytes?.length || 0) > 200 * 1024 * 1024,
        413,
        "该账号设计图存储已达到200 MB",
      );
      fail(
        !maintenance.health(false).ok,
        503,
        "存储服务异常或空间不足，请稍后重试",
      );
      if (old)
        db.prepare(
          "UPDATE booking_drafts SET payload=?,image=?,image_type=?,version=version+1,updated=? WHERE id=? AND user_id=?",
        ).run(
          JSON.stringify(payload),
          bytes || null,
          type || null,
          now(),
          id,
          fresh.id,
        );
      else
        db.prepare(
          "INSERT INTO booking_drafts(id,user_id,payload,image,image_type,created,updated) VALUES(?,?,?,?,?,?,?)",
        ).run(
          id,
          fresh.id,
          JSON.stringify(payload),
          bytes || null,
          type || null,
          now(),
          now(),
        );
      return owned(id, fresh.id);
    });
    send(res, { draft: view(row) }, method === "POST" ? 201 : 200);
    return true;
  };
}
