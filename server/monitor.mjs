import { createHmac } from "node:crypto";
const target = process.env.MONITOR_URL,
  webhook = process.env.ALERT_WEBHOOK_URL;
if (!target || !webhook)
  throw new Error("独立监控需要 MONITOR_URL 与 ALERT_WEBHOOK_URL");
if (
  new URL(webhook).protocol !== "https:" &&
  !["localhost", "127.0.0.1"].includes(new URL(webhook).hostname)
)
  throw new Error("告警地址必须使用HTTPS");
let failures = 0,
  notified = false;
async function check() {
  let healthy = false;
  try {
    const r = await fetch(target, {
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    healthy = r.ok && (await r.json()).ok === true;
  } catch {}
  failures = healthy ? 0 : failures + 1;
  if (
    (failures >= 3 && !notified) ||
    (healthy && notified) ||
    (process.argv.includes("--once") && !healthy)
  ) {
    const payload = JSON.stringify({
      event: healthy ? "service.recovered" : "service.unreachable",
      service: "outdoorsweb",
      at: new Date().toISOString(),
      failures,
    });
    const response = await fetch(webhook, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        "Content-Type": "application/json",
        "X-HUST-Signature": process.env.ALERT_WEBHOOK_SECRET
          ? createHmac("sha256", process.env.ALERT_WEBHOOK_SECRET)
              .update(payload)
              .digest("hex")
          : "",
        ...(process.env.ALERT_WEBHOOK_TOKEN
          ? { Authorization: `Bearer ${process.env.ALERT_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: payload,
    });
    if (!response.ok) throw new Error(`告警接收方返回 HTTP ${response.status}`);
    notified = !healthy;
  }
  console.log(
    JSON.stringify({
      event: "monitor.check",
      healthy,
      failures,
      at: new Date().toISOString(),
    }),
  );
  if (process.argv.includes("--once") && !healthy) process.exitCode = 1;
}
await check();
if (!process.argv.includes("--once")) {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await check();
    } catch {
      console.error("独立监控告警发送失败，将在下个周期重试");
    } finally {
      running = false;
    }
  }, 30000);
}
