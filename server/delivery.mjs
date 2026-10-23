import { createHmac } from "node:crypto";
import { tx, now, today } from "./core.mjs";
import { deliverPhone } from "./integrations.mjs";

export async function alertExternal(db, event, detail, sender = fetch) {
  if (!process.env.ALERT_WEBHOOK_URL) return { configured: false };
  const url = new URL(process.env.ALERT_WEBHOOK_URL);
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    throw new Error("告警地址必须使用HTTPS");
  const key = `alert:${event}`,
    old = db
      .prepare("SELECT value FROM maintenance_state WHERE key=?")
      .get(key);
  if (old && Date.now() - JSON.parse(old.value).at < 1800000)
    return { throttled: true };
  const payload = JSON.stringify({
      event,
      detail,
      at: now(),
      service: "outdoorsweb",
    }),
    signature = process.env.ALERT_WEBHOOK_SECRET
      ? createHmac("sha256", process.env.ALERT_WEBHOOK_SECRET)
          .update(payload)
          .digest("hex")
      : "";
  try {
    const response = await sender(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        "Content-Type": "application/json",
        "X-HUST-Signature": signature,
        ...(process.env.ALERT_WEBHOOK_TOKEN
          ? { Authorization: `Bearer ${process.env.ALERT_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: payload,
    });
    if (!response.ok)
      throw new Error(`外部告警未受理（HTTP ${response.status}）`);
  } catch (e) {
    db.prepare(
      "INSERT INTO maintenance_state VALUES('externalAlert',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).run(
      JSON.stringify({
        ok: false,
        event,
        at: now(),
        error: e.status
          ? e.message
          : "外部告警未受理或网络不可用，请检查接收方",
      }),
    );
    throw e;
  }
  db.prepare(
    "INSERT INTO maintenance_state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(key, JSON.stringify({ at: Date.now() }));
  db.prepare(
    "INSERT INTO maintenance_state VALUES('externalAlert',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(JSON.stringify({ ok: true, event, at: now() }));
  return { ok: true };
}

export function createDelivery(db, maintenance, options = {}) {
  let timer, running;
  function settle(job, state, detail, nextAt = null, delivered = null) {
    tx(db, () => {
      const saved = db
        .prepare(
          "UPDATE delivery_jobs SET version=version+1,state=?,last_error=?,next_at=COALESCE(?,next_at),delivered=COALESCE(?,delivered) WHERE id=? AND state='sending' AND version=?",
        )
        .run(state, detail, nextAt, delivered, job.id, job.version + 1);
      if (!saved.changes)
        db.prepare(
          "INSERT INTO audit(actor,action,target,created,details) VALUES(NULL,'delivery.late_result',?,?,?)",
        ).run(
          job.id,
          now(),
          JSON.stringify({ state, detail, expectedVersion: job.version + 1 }),
        );
      else if (state === "cancelled")
        db.prepare(
          "INSERT INTO audit(actor,action,target,created,details) VALUES(NULL,'delivery.cancelled',?,?,?)",
        ).run(
          job.id,
          now(),
          JSON.stringify({
            reason: detail,
            bookingId: JSON.parse(job.payload).bookingId,
          }),
        );
    });
  }
  async function run() {
    if (running) return running;
    running = (async () => {
      // A crashed sender may have reached the provider. Do not automatically call
      // that person again: surface the ambiguous result for an operator to resolve.
      db.prepare(
        "UPDATE delivery_jobs SET version=version+1,state='uncertain',last_error='发送进程中断，需在服务商记录中核实受理情况' WHERE state='sending' AND next_at<?",
      ).run(Date.now());
      for (let i = 0; i < 10; i++) {
        const job = tx(db, () => {
          const row = db
            .prepare(
              "SELECT * FROM delivery_jobs WHERE state='pending' AND next_at<=? ORDER BY created LIMIT 1",
            )
            .get(Date.now());
          if (row)
            db.prepare(
              "UPDATE delivery_jobs SET version=version+1,state='sending',attempts=attempts+1,next_at=? WHERE id=?",
            ).run(Date.now() + 120000, row.id);
          return row;
        });
        if (!job) break;
        try {
          const p = JSON.parse(job.payload),
            pref = db
              .prepare(
                "SELECT p.*,v.phone,u.disabled FROM contact_preferences p JOIN verified_phones v ON p.user_id=v.user_id JOIN users u ON u.id=p.user_id WHERE p.user_id=?",
              )
              .get(p.userId),
            booking = db
              .prepare(
                "SELECT user_id,status,cancelled,end FROM bookings WHERE id=?",
              )
              .get(p.bookingId),
            reason =
              !pref || !pref[job.kind] || pref.phone !== p.phone
                ? "用户已关闭通知或变更绑定号码"
                : pref.disabled
                  ? "账号已停用，结果通知已停止"
                  : !booking || booking.user_id !== p.userId
                    ? "预约不存在或不属于通知接收账号"
                    : booking.cancelled ||
                        !["已通过", "未通过"].includes(booking.status)
                      ? "预约已取消、改期或审核结果已失效"
                      : booking.status === "已通过" && booking.end < today()
                        ? "预约已结束，布展指令不再发送"
                        : "";
          if (reason) {
            // A result can become obsolete while queued or awaiting a manual
            // retry. Preserve its history, without sending stale instructions.
            settle(job, "cancelled", reason);
            continue;
          }
          const providerId = await (options.sendPhone || deliverPhone)(
            job.kind,
            p.phone,
            p.message,
          );
          settle(job, "accepted", `服务商受理编号 ${providerId}`, null, now());
        } catch (e) {
          const uncertain =
            e.deliveryUncertain ||
            !e.status ||
            /timeout|abort|fetch/i.test(String(e));
          settle(
            job,
            uncertain
              ? "uncertain"
              : e.retryable === false || job.attempts >= 4
                ? "failed"
                : "pending",
            uncertain
              ? "服务商受理结果不确定，需在服务商后台核实，系统未自动重复发送"
              : e.message,
            Math.max(
              Date.now() + Math.min(3600000, 60000 * 2 ** job.attempts),
              e.retryAt || 0,
            ),
          );
        }
      }
      const h = maintenance.health();
      if (!h.ok)
        await alertExternal(db, "health.failed", "数据库或磁盘空间异常");
      const failed = db
        .prepare(
          "SELECT COUNT(*) n FROM delivery_jobs WHERE state IN ('failed','uncertain')",
        )
        .get().n;
      if (failed)
        await alertExternal(
          db,
          "delivery.failed",
          `${failed} 条通知需要人工核实`,
        );
    })()
      .catch((e) => {
        const result = { ok: false, at: now(), error: String(e.message) };
        try {
          db.prepare(
            "INSERT INTO maintenance_state VALUES('externalAlert',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          ).run(JSON.stringify(result));
        } catch {}
        console.error(JSON.stringify({ event: "delivery.failed", ...result }));
        return result;
      })
      .finally(() => {
        running = null;
      });
    return running;
  }
  return {
    run,
    start() {
      if (options.scheduled === false) return;
      timer = setInterval(run, 15000);
      timer.unref();
    },
    async close() {
      clearInterval(timer);
      if (running) await running;
    },
  };
}
