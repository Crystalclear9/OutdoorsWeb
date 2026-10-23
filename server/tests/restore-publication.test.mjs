import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

for (const kind of ["new", "existing", "replaced"]) {
  const existing = kind === "existing";
  test(`恢复发布失败处理${kind}密钥且不覆盖目标`, (t) => {
    const directory = mkdtempSync(
      path.join(os.tmpdir(), "outdoors-restore-publish-"),
    );
    t.after(() => {
      assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
      assert.ok(
        path.basename(directory).startsWith("outdoors-restore-publish-"),
      );
      rmSync(directory, { recursive: true, force: true });
    });
    const source = path.join(directory, "source.sqlite"),
      destination = path.join(directory, "recovered"),
      target = path.join(destination, "app.sqlite"),
      mfaKey = Buffer.alloc(32, 71);
    const db = new DatabaseSync(source);
    db.exec(
      "CREATE TABLE preserved(value TEXT); INSERT INTO preserved VALUES('original')",
    );
    db.close();
    mkdirSync(destination);
    if (existing) writeFileSync(path.join(destination, ".mfa-key"), mfaKey);
    const script = `
      import assert from 'node:assert/strict';
      import fs from 'node:fs/promises';
      import path from 'node:path';
      import {syncBuiltinESMExports} from 'node:module';
      const target=process.argv[2];
      const original=fs.link;
      fs.link=async (source,destination)=>{
        if(destination===target){
          if(${kind === "replaced"}) {
            const keyPath=path.join(path.dirname(target),'.mfa-key');
            await fs.rename(keyPath,keyPath+'.original');
            await fs.writeFile(keyPath,Buffer.alloc(32,99),{flag:'wx'});
            await fs.unlink(keyPath+'.original');
          }
          await fs.writeFile(target,'concurrent target',{flag:'wx'});
          throw Object.assign(new Error('simulated publication conflict'),{code:'EEXIST'});
        }
        return original(source,destination);
      };
      syncBuiltinESMExports();
      const {encryptBackup,restoreEncrypted}=await import(${JSON.stringify(new URL("../offsite.mjs", import.meta.url).href)});
      const encrypted=process.argv[1]+'.enc';
      await encryptBackup(process.argv[1],encrypted,Buffer.alloc(32,71));
      await assert.rejects(restoreEncrypted(encrypted,target),/simulated publication conflict/);
    `;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script, source, target],
      {
        encoding: "utf8",
        env: { ...process.env, BACKUP_ENCRYPTION_KEY: "cd".repeat(32) },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(target, "utf8"), "concurrent target");
    assert.deepEqual(
      readdirSync(destination).sort(),
      kind !== "new" ? [".mfa-key", "app.sqlite"] : ["app.sqlite"],
    );
    if (existing)
      assert.deepEqual(
        readFileSync(path.join(destination, ".mfa-key")),
        mfaKey,
      );
    if (kind === "replaced")
      assert.deepEqual(
        readFileSync(path.join(destination, ".mfa-key")),
        Buffer.alloc(32, 99),
      );
  });
}
