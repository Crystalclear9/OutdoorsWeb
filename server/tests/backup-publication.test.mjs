import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

for (const kind of ["new", "replaced", "removed", "published"]) {
  test(`手动备份发布失败仅清理本次密钥，保留${kind}情况下的并发目标与原错误`, (t) => {
    const directory = mkdtempSync(
      path.join(os.tmpdir(), "outdoors-backup-publish-"),
    );
    t.after(() => {
      assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
      assert.ok(
        path.basename(directory).startsWith("outdoors-backup-publish-"),
      );
      rmSync(directory, { recursive: true, force: true });
    });
    const source = path.join(directory, "source.sqlite"),
      target = path.join(directory, "snapshot.sqlite"),
      key = Buffer.alloc(32, 71);
    const db = new DatabaseSync(source);
    db.exec(
      "CREATE TABLE preserved(value TEXT); INSERT INTO preserved VALUES('original')",
    );
    db.close();
    writeFileSync(path.join(directory, ".mfa-key"), key);
    const before = readFileSync(source);
    const script = `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import {syncBuiltinESMExports} from 'node:module';
      const target=process.argv[2], original=fs.linkSync;
      fs.linkSync=(source,destination)=>{
        if(destination===target){
          if(${kind === "published"}) {
            const result=original(source,destination);
            console.log=()=>{throw new Error('simulated CLI output failure')};
            return result;
          }
          const keyPath=target+'.mfa-key';
          if(${kind === "replaced"}) {
            fs.renameSync(keyPath,keyPath+'.original');
            fs.writeFileSync(keyPath,Buffer.alloc(32,99),{flag:'wx'});
            fs.unlinkSync(keyPath+'.original');
          }
          if(${kind === "removed"}) fs.unlinkSync(keyPath);
          fs.writeFileSync(target,'concurrent target',{flag:'wx'});
          throw Object.assign(new Error('simulated publication conflict'),{code:'EEXIST'});
        }
        return original(source,destination);
      };
      syncBuiltinESMExports();
      await assert.rejects(import(${JSON.stringify(new URL("../backup.mjs", import.meta.url).href)}),/${kind === "published" ? "simulated CLI output failure" : "simulated publication conflict"}/);
    `;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script, source, target],
      {
        encoding: "utf8",
        timeout: 10000,
        env: { ...process.env, DB_PATH: source, APP_ENCRYPTION_KEY: "" },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    if (kind === "published") {
      const snapshot = new DatabaseSync(target, { readOnly: true });
      try {
        assert.equal(
          snapshot.prepare("PRAGMA quick_check").get().quick_check,
          "ok",
        );
        assert.equal(
          snapshot.prepare("SELECT value FROM preserved").get().value,
          "original",
        );
      } finally {
        snapshot.close();
      }
    } else assert.equal(readFileSync(target, "utf8"), "concurrent target");
    assert.deepEqual(readFileSync(source), before);
    assert.deepEqual(readFileSync(path.join(directory, ".mfa-key")), key);
    const expected = [".mfa-key", "source.sqlite", "snapshot.sqlite"];
    if (kind === "replaced") {
      expected.push("snapshot.sqlite.mfa-key");
      assert.deepEqual(readFileSync(target + ".mfa-key"), Buffer.alloc(32, 99));
    }
    if (kind === "published") {
      expected.push("snapshot.sqlite.mfa-key");
      assert.deepEqual(readFileSync(target + ".mfa-key"), key);
    }
    // No own partial snapshot or key should remain after a failed publication.
    assert.deepEqual(readdirSync(directory).sort(), expected.sort());
  });
}
