import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openStore } from "../store.mjs";
import { alertExternal } from "../delivery.mjs";

function setup(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "outdoors-alert-race-"));
  const first = openStore(path.join(directory, "app.sqlite")),
    second = openStore(path.join(directory, "app.sqlite")),
    previous = process.env.ALERT_WEBHOOK_URL;
  process.env.ALERT_WEBHOOK_URL = "https://alerts.example.test/webhook";
  t.after(() => {
    first.close();
    second.close();
    if (previous === undefined) delete process.env.ALERT_WEBHOOK_URL;
    else process.env.ALERT_WEBHOOK_URL = previous;
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("outdoors-alert-race-"));
    rmSync(directory, { recursive: true, force: true });
  });
  return { first, second };
}
const get = (db, key) =>
  JSON.parse(
    db.prepare("SELECT value FROM maintenance_state WHERE key=?").get(key)
      ?.value || "null",
  );

test("两个数据库连接同类告警并发只外发一次，成功后抑制重复", async (t) => {
  const { first, second } = setup(t);
  let release,
    calls = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const sender = async () => {
    calls++;
    await gate;
    return new Response("ok");
  };
  const jobs = [
    alertExternal(first, "race", "failure", sender),
    alertExternal(second, "race", "failure", sender),
  ];
  try {
    assert.equal(calls, 1);
  } finally {
    release();
    await Promise.allSettled(jobs);
  }
  const results = await Promise.all(jobs);
  assert.deepEqual(results, [{ ok: true }, { throttled: true }]);
  assert.deepEqual(await alertExternal(second, "race", "failure", sender), {
    throttled: true,
  });
  assert.equal(calls, 1);
  assert.ok(get(first, "alert:race").at > 0);
  assert.equal(get(first, "alertLease:race"), null);
});

test("告警明确失败不写成功抑制，释放自己的租约后可重试", async (t) => {
  const { first, second } = setup(t);
  await assert.rejects(
    alertExternal(
      first,
      "retry",
      "failure",
      async () => new Response("no", { status: 503 }),
    ),
  );
  assert.equal(get(first, "alert:retry"), null);
  assert.equal(get(first, "alertLease:retry"), null);
  assert.equal(get(first, "externalAlert").ok, false);
  assert.deepEqual(
    await alertExternal(
      second,
      "retry",
      "failure",
      async () => new Response("ok"),
    ),
    { ok: true },
  );
  assert.equal(get(first, "externalAlert").ok, true);
});

for (const outcome of ["success", "failure"]) {
  test(`旧告警迟到${outcome}不会清除新租约或覆盖其结果`, async (t) => {
    const { first, second } = setup(t);
    let finishOld, finishNew;
    const oldGate = new Promise((resolve) => {
        finishOld = resolve;
      }),
      newGate = new Promise((resolve) => {
        finishNew = resolve;
      });
    const old = alertExternal(first, "late", "old", async () => {
      await oldGate;
      if (outcome === "failure") throw new Error("late failure");
      return new Response("ok");
    });
    const settledOld = Promise.allSettled([old]);
    let fresh;
    try {
      assert.ok(get(first, "alertLease:late"));
      first
        .prepare(
          "UPDATE maintenance_state SET value=? WHERE key='alertLease:late'",
        )
        .run(JSON.stringify({ id: "expired", expires: 0 }));
      fresh = alertExternal(second, "late", "new", async () => {
        await newGate;
        return new Response("ok");
      });
      const owner = get(first, "alertLease:late");
      finishOld();
      await settledOld;
      assert.deepEqual(get(first, "alertLease:late"), owner);
      assert.equal(get(first, "alert:late"), null);
      assert.equal(get(first, "externalAlert"), null);
      assert.deepEqual(
        await alertExternal(first, "late", "third", async () => {
          throw new Error("must not send");
        }),
        { throttled: true },
      );
    } finally {
      finishOld();
      finishNew();
      await settledOld;
      if (fresh) await fresh;
    }
    assert.equal(get(first, "alertLease:late"), null);
    assert.ok(get(first, "alert:late").at > 0);
    assert.equal(get(first, "externalAlert").ok, true);
  });
}
