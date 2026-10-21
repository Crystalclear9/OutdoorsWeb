import { readFileSync } from "node:fs";
import path from "node:path";

export function backupMfaKey(dbPath) {
  const configured = process.env.APP_ENCRYPTION_KEY;
  if (configured) {
    if (!/^[a-fA-F0-9]{64}$/.test(configured))
      throw new Error("APP_ENCRYPTION_KEY 须为 64 位十六进制密钥");
    return Buffer.from(configured, "hex");
  }
  return backupKeyFile(
    path.join(path.dirname(path.resolve(dbPath)), ".mfa-key"),
  );
}

export function backupKeyFile(file) {
  const key = readFileSync(file);
  if (key.length !== 32) throw new Error("MFA 密钥文件损坏，未创建备份");
  return key;
}
