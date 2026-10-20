import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const source = path.resolve(process.env.DB_PATH || "data/app.sqlite");
const destination = path.resolve(
  process.argv[2] ||
    `data/backups/app-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
);
if (source === destination) throw new Error("备份目标不能与数据库源文件相同");
mkdirSync(path.dirname(destination), { recursive: true });
const db = new DatabaseSync(source, { readOnly: true });
try {
  db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
  const key = process.env.APP_ENCRYPTION_KEY
    ? Buffer.from(process.env.APP_ENCRYPTION_KEY, "hex")
    : readFileSync(path.join(path.dirname(source), ".mfa-key"));
  writeFileSync(destination + ".mfa-key", key, { flag: "wx", mode: 0o600 });
  console.log(`一致性备份已保存：${destination}`);
} finally {
  db.close();
}
