import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../app.mjs";
import {
  client,
  register,
  manager,
  booking,
  ADMIN,
  PASSWORD,
} from "./helpers.mjs";

test("共享数据库多进程：同日内容审核、幂等重试与审核撤回竞争", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "outdoor-concurrency-")),
    dbPath = path.join(dir, "app.sqlite"),
    children = [];
  const initial = await createApp({ dbPath, admin: ADMIN });
  initial.db.close();
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null)
        await new Promise((resolve) => {
          child.once("exit", resolve);
          child.send("close");
        });
    }
    assert.ok(
      path
        .resolve(dir)
        .startsWith(
          path.resolve(os.tmpdir()) + path.sep + "outdoor-concurrency-",
        ),
    );
    await rm(dir, { recursive: true, force: true });
  });
  async function launch() {
    const child = fork(new URL("./worker.mjs", import.meta.url), [], {
      env: {
        ...process.env,
        DB_PATH: dbPath,
        ADMIN_EMAIL: "",
        ADMIN_PASSWORD: "",
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    children.push(child);
    return new Promise((resolve, reject) => {
      child.once("message", (m) => resolve(m.origin));
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code) reject(new Error("worker exited " + code));
      });
    });
  }
  const [originA, originB] = await Promise.all([launch(), launch()]),
    a = client(originA),
    b = client(originB);
  await manager(a);
  await manager(b);
  const enterprises = [];
  for (let i = 0; i < 6; i++) {
    const c = client(i % 2 ? originA : originB);
    await register(c, `concurrent${i}@test.local`);
    enterprises.push(c);
  }
  const bookings = await Promise.all(
    enterprises.map((c) => c.request("/bookings", "POST", booking())),
  );
  assert.ok(bookings.every((r) => r.status === 201));
  const approvals = await Promise.all(
    bookings.map((r, i) =>
      (i % 2 ? a : b).request(
        `/bookings/${r.data.id}/review`,
        "POST",
        {
          status: "已通过",
        },
        { "If-Match": '"1"' },
      ),
    ),
  );
  assert.equal(approvals.filter((r) => r.status === 200).length, 6);
  assert.equal(approvals.filter((r) => r.status === 409).length, 0);
  assert.equal((await a.request("/venue")).data.occupied.length, 0);
  const c = enterprises[0],
    second = client(originB);
  await second.request("/auth/login", "POST", {
    email: "concurrent0@test.local",
    password: PASSWORD,
  });
  const duplicate = await Promise.all([
    c.request("/bookings", "POST", booking(), {
      "Idempotency-Key": "multiprocess-content-001",
    }),
    second.request("/bookings", "POST", booking(), {
      "Idempotency-Key": "multiprocess-content-001",
    }),
  ]);
  assert.deepEqual(duplicate.map((r) => r.status).sort(), [201, 201]);
  assert.equal(duplicate[0].data.id, duplicate[1].data.id);
  const pending = duplicate.find((r) => r.status === 201).data.id;
  const race = await Promise.all([
    a.request(
      `/bookings/${pending}/review`,
      "POST",
      { status: "已通过" },
      { "If-Match": '"1"' },
    ),
    second.request(`/bookings/${pending}/withdraw`, "POST", undefined, {
      "If-Match": '"1"',
    }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  const last = (await c.request("/bookings", "POST", booking({ slot: 3 }))).data
    .id;
  const closureRace = await Promise.all([
    a.request(
      `/bookings/${last}/review`,
      "POST",
      { status: "已通过" },
      { "If-Match": '"1"' },
    ),
    b.request("/closures", "POST", {
      slot: 3,
      start: booking().start,
      end: booking().end,
      reason: "维护",
    }),
  ]);
  assert.equal(
    closureRace.filter((r) => r.status === 200 || r.status === 201).length,
    1,
  );
  assert.equal(closureRace.filter((r) => r.status === 410).length, 1);
  const venue = (await a.request("/venue")).data;
  assert.equal(
    venue.occupied.filter((v) => v.slot === 3).length +
      venue.closed.filter((v) => v.slot === 3).length,
    0,
  );
});
