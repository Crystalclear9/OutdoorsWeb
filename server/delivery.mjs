import { createHmac } from "node:crypto";
import { tx, now } from "./core.mjs";
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
                "SELECT p.*,v.phone FROM contact_preferences p JOIN verified_phones v ON p.user_id=v.user_id WHERE p.user_id=?",
              )
              .get(p.userId);
          if (!pref || !pref[job.kind] || pref.phone !== p.phone) {
            db.prepare(
              "UPDATE delivery_jobs SET version=version+1,state='cancelled',last_error='用户已关闭通知或变更绑定号码' WHERE id=?",
            ).run(job.id);
            continue;
          }
          const providerId = await (options.sendPhone || deliverPhone)(
            job.kind,
            p.phone,
            p.message,
          );
          db.prepare(
            "UPDATE delivery_jobs SET version=version+1,state='accepted',delivered=?,last_error=? WHERE id=?",
          ).run(now(), `服务商受理编号 ${providerId}`, job.id);
        } catch (e) {
          const uncertain = !e.status || /timeout|abort|fetch/i.test(String(e));
          db.prepare(
            "UPDATE delivery_jobs SET version=version+1,state=?,next_at=?,last_error=? WHERE id=?",
          ).run(
            uncertain ? "uncertain" : job.attempts >= 4 ? "failed" : "pending",
            Date.now() + Math.min(3600000, 60000 * 2 ** job.attempts),
            uncertain
              ? "网络结果不确定，需在服务商后台核实，系统未自动重复发送"
              : e.message,
            job.id,
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
        db.prepare(
          "INSERT INTO maintenance_state VALUES('externalAlert',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        ).run(
          JSON.stringify({ ok: false, at: now(), error: String(e.message) }),
        );
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
