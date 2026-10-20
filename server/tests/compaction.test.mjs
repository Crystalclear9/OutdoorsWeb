import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { compactDatabase } from "../compaction.mjs";
import { openStore } from "../store.mjs";

test("新库启用增量回收，旧库离线压缩前生成可恢复快照且保留业务记录和MFA密钥", async () => {
  const fresh = openStore(":memory:");
  assert.equal(fresh.prepare("PRAGMA auto_vacuum").get().auto_vacuum, 2);
  fresh.close();
  const dir = await mkdtemp(path.join(os.tmpdir(), "outdoors-compact-")),
    source = path.join(dir, "legacy.sqlite"),
    key = Buffer.alloc(32, 42);
  await writeFile(path.join(dir, ".mfa-key"), key);
  const old = new DatabaseSync(source);
  old.exec(
    "CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES('retain-business'); CREATE TABLE scratch(content BLOB); INSERT INTO scratch VALUES(zeroblob(8388608)); DELETE FROM scratch;",
  );
  assert.ok(old.prepare("PRAGMA freelist_count").get().freelist_count > 100);
  old.close();
  const result = await compactDatabase(source);
  assert.ok(result.reclaimed > 7000000);
  assert.ok(result.after < result.before);
  const verified = new DatabaseSync(source);
  assert.equal(
    verified.prepare("SELECT value FROM proof").get().value,
    "retain-business",
  );
  assert.equal(verified.prepare("PRAGMA auto_vacuum").get().auto_vacuum, 2);
  verified.exec(
    "INSERT INTO scratch VALUES(zeroblob(1048576)); DELETE FROM scratch;",
  );
  const pages = verified.prepare("PRAGMA freelist_count").get().freelist_count;
  verified.exec("PRAGMA incremental_vacuum(64)");
  assert.ok(
    verified.prepare("PRAGMA freelist_count").get().freelist_count < pages,
  );
  verified.close();
  const backup = new DatabaseSync(result.backup, { readOnly: true });
  assert.equal(
    backup.prepare("SELECT value FROM proof").get().value,
    "retain-business",
  );
  backup.close();
  assert.deepEqual(await readFile(result.backup + ".mfa-key"), key);
});
