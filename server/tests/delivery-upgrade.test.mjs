import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openStore } from "../store.mjs";

test("版本七升级隔离旧通信不确定重试，保留明确拒绝、人工结论和历史且重复启动幂等", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "outdoors-delivery-upgrade-"),
  );
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(
      path.basename(directory).startsWith("outdoors-delivery-upgrade-"),
    );
    await rm(directory, { recursive: true, force: true });
  });
  const filename = path.join(directory, "app.sqlite");
  const errors = [500, 503, 408].map(
    (status) =>
      `通信服务拒绝请求（HTTP ${status}），请管理员检查配置与发送区域`,
  );
  errors.push("通信服务未确认受理");
  const rows = [];
  for (const state of ["pending", "failed"])
    for (const [i, error] of errors.entries())
      rows.push({ id: `${state}-${i}`, state, error, migrate: true });
  rows.push(
    {
      id: "rate-limit",
      state: "pending",
      error: "通信服务拒绝请求（HTTP 429），请管理员检查配置与发送区域",
    },
    {
      id: "credentials",
      state: "failed",
      error: "通信服务拒绝请求（HTTP 401），请管理员检查配置与发送区域",
    },
    {
      id: "human",
      state: "pending",
      error: "人工核实：HTTP 500 后服务商未受理，允许重试",
    },
    { id: "accepted", state: "accepted", error: errors[0] },
    { id: "cancelled", state: "cancelled", error: errors[3] },
    { id: "uncertain", state: "uncertain", error: errors[3] },
  );
  let db = openStore(filename);
  const before = new Map();
  try {
    for (const row of rows) {
      db.prepare(
        "INSERT INTO delivery_jobs(id,kind,payload,state,attempts,next_at,last_error,created,version) VALUES(?,'voice','{}',?,2,12345,?,'2026-10-23T00:00:00.000Z',4)",
      ).run(row.id, row.state, row.error);
      before.set(
        row.id,
        db.prepare("SELECT * FROM delivery_jobs WHERE id=?").get(row.id),
      );
    }
  } finally {
    db.close();
  }
  for (let round = 0; round < 2; round++) {
    db = openStore(filename);
    try {
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 7);
      for (const row of rows) {
        const saved = db
          .prepare("SELECT * FROM delivery_jobs WHERE id=?")
          .get(row.id);
        const original = before.get(row.id);
        if (row.migrate) {
          assert.equal(saved.state, "uncertain", row.id);
          assert.equal(saved.version, original.version + 1, row.id);
          assert.ok(saved.last_error.includes(original.last_error));
          assert.deepEqual(
            {
              ...saved,
              state: original.state,
              version: original.version,
              last_error: original.last_error,
            },
            { ...original },
          );
        } else assert.deepEqual(saved, original);
      }
      const audits = db
        .prepare("SELECT * FROM audit WHERE action='delivery.legacy_uncertain'")
        .all();
      assert.equal(audits.length, 8, "重复启动不重复转换或写入审计");
      for (const audit of audits) {
        const original = before.get(audit.target);
        assert.deepEqual(JSON.parse(audit.details), {
          previousState: original.state,
          reason: original.last_error,
        });
      }
    } finally {
      db.close();
    }
  }
});
