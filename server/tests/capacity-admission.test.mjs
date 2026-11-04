import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fixture, register, manager, booking } from "./helpers.mjs";
import { createMaintenance } from "../maintenance.mjs";

test("达到数据库写入门槛后申报/草稿保存拒绝，查询、审批和备份仍可使用", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "outdoors-capacity-api-"),
  );
  const dbPath = path.join(directory, "app.sqlite");
  const f = await fixture(t, dbPath, {
    maintenance: { scheduled: false, minFreeMb: 0, databaseMaxMb: 8 },
  });
  t.after(async () => {
    await f.close();
    await rm(directory, { recursive: true, force: true });
  });
  const owner = f.client(),
    root = f.client();
  await register(owner);
  await manager(root);
  const made = await owner.request("/bookings", "POST", booking());
  assert.equal(made.status, 201, JSON.stringify(made));
  const draft = await owner.request("/drafts", "POST", {
    payload: booking(),
    image: booking().image,
  });
  assert.equal(draft.status, 201, JSON.stringify(draft));
  f.db.exec(
    "CREATE TABLE capacity_fixture(bytes BLOB); INSERT INTO capacity_fixture VALUES(zeroblob(16777216));",
  );
  const status = f.maintenance.health(false);
  assert.equal(status.databaseLimitReached, true);
  assert.equal(status.ok, false);
  assert.ok(status.databaseBytes >= 8 * 1048576);
  assert.equal((await owner.request("/bookings")).status, 200);
  assert.equal(
    (await owner.request(`/drafts/${draft.data.draft.id}`)).status,
    200,
  );
  assert.equal(
    (
      await owner.request("/bookings", "POST", booking(), {
        "Idempotency-Key": "capacity-limit-reject",
      })
    ).status,
    503,
  );
  assert.equal(
    (await owner.request("/drafts", "POST", { payload: booking() })).status,
    503,
  );
  assert.equal(
    (
      await owner.request(
        `/drafts/${draft.data.draft.id}`,
        "PATCH",
        { payload: booking() },
        { "If-Match": '"1"' },
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await root.request(
        `/bookings/${made.data.id}/review`,
        "POST",
        { status: "已通过", reason: "" },
        { "If-Match": '"1"' },
      )
    ).status,
    200,
  );
  const backup = await f.maintenance.run(true);
  assert.equal(backup.ok, true, JSON.stringify(backup));
  assert.ok(backup.backup.file.endsWith(".sqlite"));
  const sourceKey = await readFile(path.join(directory, ".mfa-key"));
  assert.deepEqual(
    await readFile(
      path.join(directory, "backups", backup.backup.file + ".mfa-key"),
    ),
    sourceKey,
  );
});

test("备份目录门槛拒绝新复制但不删除唯一已有恢复点", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "outdoors-capacity-backup-"),
  );
  const dbPath = path.join(directory, "app.sqlite");
  const f = await fixture(t, dbPath, {
    maintenance: { scheduled: false, minFreeMb: 0 },
  });
  t.after(async () => {
    await f.close();
    await rm(directory, { recursive: true, force: true });
  });
  const first = await f.maintenance.run(true);
  assert.equal(first.ok, true, JSON.stringify(first));
  const folder = path.join(directory, "backups"),
    files = (await readdir(folder)).sort();
  const before = await readFile(path.join(folder, first.backup.file));
  const limited = createMaintenance(f.db, dbPath, {
    scheduled: false,
    minFreeMb: 0,
    backupMaxMb: 1,
  });
  const refused = await limited.run(true);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /备份目录上限/);
  assert.deepEqual((await readdir(folder)).sort(), files);
  assert.deepEqual(
    await readFile(path.join(folder, first.backup.file)),
    before,
  );
  await limited.close();
});
