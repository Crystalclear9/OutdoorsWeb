import { createApp } from "../server/app.mjs";
import { listenHttp } from "../server/tests/http-listen.mjs";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  client,
  manager,
  register,
  booking,
  ADMIN,
} from "../server/tests/helpers.mjs";

// This command creates its own isolated database and never accepts a production URL.
const dir = await mkdtemp(path.join(os.tmpdir(), "outdoors-load-"));
const app = await createApp({
  dbPath: path.join(dir, "load.sqlite"),
  admin: ADMIN,
  captchaTestAnswer: "246789",
  maintenance: { scheduled: false },
});
await listenHttp(app.server);
const origin = `http://127.0.0.1:${app.server.address().port}`;
try {
  const root = client(origin),
    owner = client(origin);
  await manager(root);
  const user = await register(owner);
  const first = (await owner.request("/bookings", "POST", booking())).data.id;
  const insertUser = app.db.prepare(
    "INSERT INTO users(id,email,password_hash,role,company,contact,phone,created) SELECT ?,?,password_hash,role,company,contact,phone,created FROM users WHERE id=?",
  );
  const ids = [first];
  for (let i = 1; i < 32; i++) {
    const id = randomUUID(),
      bid = `load-${i}`;
    insertUser.run(id, `${i}@load.local`, user.id);
    app.db
      .prepare(
        "INSERT INTO bookings(id,user_id,company,contact,phone,start,end,slot,status,image,image_type,created) SELECT ?,?,company,contact,phone,start,end,slot,status,image,image_type,created FROM bookings WHERE id=?",
      )
      .run(bid, id, first);
    ids.push(bid);
  }
  const latencies = [],
    count = 1000,
    concurrency = 32;
  let cursor = 0,
    errors = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor++ < count) {
        const at = performance.now(),
          r = await fetch(
            origin + (cursor % 2 ? "/api/venue" : "/api/notices"),
          );
        await r.arrayBuffer();
        latencies.push(performance.now() - at);
        if (!r.ok) errors++;
      }
    }),
  );
  const elapsed = performance.now() - started;
  latencies.sort((a, b) => a - b);
  const reviewStart = performance.now();
  const approvals = await Promise.all(
    ids.map((id) =>
      root.request(
        `/bookings/${id}/review`,
        "POST",
        { status: "已通过", reason: "" },
        { "If-Match": '"1"' },
      ),
    ),
  );
  const winners = approvals.filter((r) => r.status === 200).length,
    conflicts = approvals.filter((r) => r.status === 409).length;
  const report = {
    at: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    database: "temporary SQLite WAL",
    concurrentClients: concurrency,
    publicReads: count,
    readErrors: errors,
    readDurationMs: Math.round(elapsed),
    readRequestsPerSecond: Math.round((count / elapsed) * 1000),
    p50Ms: Math.round(latencies[Math.floor(count * 0.5)]),
    p95Ms: Math.round(latencies[Math.floor(count * 0.95)]),
    p99Ms: Math.round(latencies[Math.floor(count * 0.99)]),
    competingApprovals: ids.length,
    approved: winners,
    conflictResponses: conflicts,
    approvalDurationMs: Math.round(performance.now() - reviewStart),
    note: "同机合成压测，不代表部署机器容量承诺；登录固定验证码仅存在于此隔离测试服务。",
  };
  await mkdir("tmp", { recursive: true });
  await writeFile("tmp/load-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (
    errors ||
    winners !== 1 ||
    conflicts !== 31 ||
    report.p95Ms > Number(process.env.LOAD_MAX_P95_MS || 2000)
  )
    process.exitCode = 1;
} finally {
  await app.close();
  if (path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep))
    await rm(dir, { recursive: true, force: true });
}
