import { DatabaseSync } from "node:sqlite";
import { stat, statfs, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function compactDatabase(filename) {
  const source = path.resolve(filename);
  await stat(source);
  const db = new DatabaseSync(source);
  try {
    db.exec("PRAGMA busy_timeout=1000;");
    if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok")
      throw new Error("数据库完整性检查失败，未压缩");
    if (db.prepare("PRAGMA user_version").get().user_version > 6)
      throw new Error("数据库版本高于当前程序，未压缩");
    const before =
      db.prepare("PRAGMA page_count").get().page_count *
      db.prepare("PRAGMA page_size").get().page_size;
    const disk = await statfs(path.dirname(source));
    // One safety snapshot plus SQLite's potential temporary rebuild files.
    if (Number(disk.bavail) * Number(disk.bsize) < before * 3 + 268435456)
      throw new Error("压缩所需临时空间不足，请先扩容；未修改数据库");
    const directory = path.join(path.dirname(source), "backups");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const backup = path.join(directory, `precompact-${randomUUID()}.sqlite`);
    // Copy the key before touching the database. A missing key must not yield a
    // supposedly restorable safety backup with unusable encrypted MFA records.
    const key = process.env.APP_ENCRYPTION_KEY
      ? Buffer.from(process.env.APP_ENCRYPTION_KEY, "hex")
      : await readFile(path.join(path.dirname(source), ".mfa-key"));
    if (key.length !== 32) throw new Error("MFA密钥无效，未压缩");
    db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
    const verify = new DatabaseSync(backup, { readOnly: true });
    try {
      if (verify.prepare("PRAGMA quick_check").get().quick_check !== "ok")
        throw new Error("安全快照校验失败，未压缩");
    } finally {
      verify.close();
    }
    await writeFile(backup + ".mfa-key", key, { flag: "wx", mode: 0o600 });
    db.exec(
      "PRAGMA auto_vacuum=INCREMENTAL; VACUUM; PRAGMA wal_checkpoint(TRUNCATE);",
    );
    if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok")
      throw new Error(`压缩后完整性校验失败，请使用安全快照 ${backup} 恢复`);
    const after =
      db.prepare("PRAGMA page_count").get().page_count *
      db.prepare("PRAGMA page_size").get().page_size;
    return {
      before,
      after,
      reclaimed: Math.max(0, before - after),
      backup,
      incrementalVacuum: true,
    };
  } finally {
    db.close();
  }
}
