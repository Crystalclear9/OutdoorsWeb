import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  writeFileSync,
  lstatSync,
  linkSync,
  unlinkSync,
  chmodSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { backupMfaKey, verifyMfaKey } from "./backup-key.mjs";

const source = path.resolve(process.env.DB_PATH || "data/app.sqlite");
const destination = path.resolve(
  process.argv[2] ||
    `data/backups/app-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
);
if (source === destination) throw new Error("备份目标不能与数据库源文件相同");
const key = backupMfaKey(source);
for (const file of [destination, destination + ".mfa-key"]) {
  try {
    lstatSync(file);
    throw new Error("备份目标已存在，请选择新的文件路径");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
mkdirSync(path.dirname(destination), { recursive: true });
const db = new DatabaseSync(source, { readOnly: true });
const partial = destination + `.${randomUUID()}.part`;
let publishedKey = false;
try {
  db.exec(`VACUUM INTO '${partial.replaceAll("'", "''")}'`);
  chmodSync(partial, 0o600);
  const verify = new DatabaseSync(partial, { readOnly: true });
  try {
    if (verify.prepare("PRAGMA quick_check").get().quick_check !== "ok")
      throw new Error("备份完整性检查失败");
    verifyMfaKey(verify, key);
  } finally {
    verify.close();
  }
  writeFileSync(partial + ".mfa-key", key, { flag: "wx", mode: 0o600 });
  // Publish without overwriting targets created by another process during VACUUM.
  linkSync(partial + ".mfa-key", destination + ".mfa-key");
  publishedKey = true;
  linkSync(partial, destination);
  console.log(`一致性备份已保存：${destination}`);
} catch (error) {
  if (publishedKey) unlinkSync(destination + ".mfa-key");
  throw error;
} finally {
  db.close();
  for (const file of [partial, partial + ".mfa-key"]) {
    try {
      unlinkSync(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
