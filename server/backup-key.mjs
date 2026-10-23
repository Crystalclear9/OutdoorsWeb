import { readFileSync } from "node:fs";
import path from "node:path";
import { createDecipheriv } from "node:crypto";

// File length alone cannot prove that a sidecar can recover this database.
// Authenticate every stored MFA secret without returning its plaintext.
export function verifyMfaKey(db, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32)
    throw new Error("MFA 备份密钥无效");
  if (
    !db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mfa'")
      .get()
  )
    return;
  try {
    for (const row of db.prepare("SELECT secret FROM mfa").iterate()) {
      const data = Buffer.from(row.secret, "base64");
      if (data.length < 29) throw new Error("Invalid ciphertext");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        data.subarray(0, 12),
      );
      decipher.setAuthTag(data.subarray(-16));
      decipher.update(data.subarray(12, -16));
      decipher.final();
    }
  } catch {
    throw new Error("备份 MFA 密钥与数据库不匹配或密文损坏");
  }
}

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
