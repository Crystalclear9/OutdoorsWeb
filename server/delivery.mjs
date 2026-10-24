import { createHmac, randomUUID } from "node:crypto";
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
    leaseKey = `alertLease:${event}`,
    leaseId = randomUUID(),
    state = (name) =>
      JSON.parse(
        db.prepare("SELECT value FROM maintenance_state WHERE key=?").get(name)
          ?.value || "null",
      ),
    save = (name, value) =>
      db
        .prepare(
          "INSERT INTO maintenance_state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(name, JSON.stringify(value));
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
  // Claim before yielding to the network. All processes sharing this database
  // observe one sender; expiry lets a crashed process relinquish its claim.
  const claimed = tx(db, () => {
    const at = Date.now(),
      previous = state(key);
    if (
      (previous && at - previous.at < 1800000) ||
      state(leaseKey)?.expires > at
    )
      return false;
    save(leaseKey, { id: leaseId, expires: at + 60000 });
    return true;
  });
  if (!claimed) return { throttled: true };
  const settle = (result) =>
    tx(db, () => {
      // An expired sender must not overwrite or release a newer sender's claim.
      if (state(leaseKey)?.id !== leaseId) return;
      if (result.ok) save(key, { at: Date.now() });
      save("externalAlert", { ...result, event, at: now() });
      db.prepare("DELETE FROM maintenance_state WHERE key=?").run(leaseKey);
    });
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
    await response.body?.cancel().catch(() => {});
    if (!response.ok)
      throw new Error(`外部告警未受理（HTTP ${response.status}）`);
  } catch (e) {
    settle({
      ok: false,
      error: e.status ? e.message : "外部告警未受理或网络不可用，请检查接收方",
    });
    throw e;
  }
  settle({ ok: true });
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
