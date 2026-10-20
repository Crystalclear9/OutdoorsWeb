import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  createHash,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, stat, statfs, unlink, writeFile } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const MAGIC = Buffer.from("HUSTBK01");
function encryptionKey() {
  if (!/^[a-fA-F0-9]{64}$/.test(process.env.BACKUP_ENCRYPTION_KEY || ""))
    throw new Error("异机备份需要独立的 BACKUP_ENCRYPTION_KEY（64位十六进制）");
  return Buffer.from(process.env.BACKUP_ENCRYPTION_KEY, "hex");
}
export const offsiteConfigured = () => !!process.env.S3_BACKUP_BUCKET;
async function digest(stream) {
  const hash = createHash("sha256");
  for await (const part of stream) hash.update(part);
  return hash.digest("hex");
}

export async function encryptBackup(source, target, mfaKey) {
  const key = encryptionKey(),
    iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  if (mfaKey.length !== 32) throw new Error("MFA备份密钥无效");
  async function* input() {
    yield mfaKey;
    yield* createReadStream(source);
  }
  const output = createWriteStream(target, { flags: "wx", mode: 0o600 });
  output.write(Buffer.concat([MAGIC, iv]));
  await pipeline(
    Readable.from(input()),
    cipher,
    new Transform({
      transform(chunk, encoding, cb) {
        cb(null, chunk);
      },
      flush(cb) {
        this.push(cipher.getAuthTag());
        cb();
      },
    }),
    output,
  );
}

export async function uploadOffsite(source, dbPath, clientOverride) {
  const target = source + `.${randomUUID()}.encrypted.part`;
  const disk = await statfs(path.dirname(source));
  if (
    Number(disk.bavail) * Number(disk.bsize) <
    (await stat(source)).size +
      Number(process.env.MIN_FREE_DISK_MB || 256) * 1048576
  )
    throw new Error("异机备份加密临时空间不足，请扩容后重试");
  const mfaKey = process.env.APP_ENCRYPTION_KEY
    ? Buffer.from(process.env.APP_ENCRYPTION_KEY, "hex")
    : await readFile(path.join(path.dirname(dbPath), ".mfa-key"));
  try {
    await encryptBackup(source, target, mfaKey);
    const sha256 = await digest(createReadStream(target)),
      size = (await stat(target)).size;
    const endpoint = process.env.S3_BACKUP_ENDPOINT;
    if (
      endpoint &&
      new URL(endpoint).protocol !== "https:" &&
      process.env.S3_ALLOW_HTTP !== "true"
    )
      throw new Error(
        "异机备份端点必须使用 HTTPS，内网测试可显式开启 S3_ALLOW_HTTP",
      );
    const client =
      clientOverride ||
      new S3Client({
        region: process.env.S3_BACKUP_REGION || "us-east-1",
        endpoint: endpoint || undefined,
        forcePathStyle: process.env.S3_PATH_STYLE === "true",
        credentials: process.env.S3_BACKUP_ACCESS_KEY
          ? {
              accessKeyId: process.env.S3_BACKUP_ACCESS_KEY,
              secretAccessKey: process.env.S3_BACKUP_SECRET_KEY,
            }
          : undefined,
        maxAttempts: 3,
      });
    const Bucket = process.env.S3_BACKUP_BUCKET,
      Key = `${(process.env.S3_BACKUP_PREFIX || "outdoors/").replace(/\/?$/, "/")}${path.basename(source)}.enc`;
    await client.send(
      new PutObjectCommand({
        Bucket,
        Key,
        Body: createReadStream(target),
        ContentLength: size,
        ContentType: "application/octet-stream",
        Metadata: { sha256, format: "HUSTBK01" },
      }),
      { abortSignal: AbortSignal.timeout(120000) },
    );
    const head = await client.send(new HeadObjectCommand({ Bucket, Key }), {
      abortSignal: AbortSignal.timeout(15000),
    });
    if (head.ContentLength !== size || head.Metadata?.sha256 !== sha256)
      throw new Error("异机备份元数据校验失败");
    const remote = await client.send(new GetObjectCommand({ Bucket, Key }), {
      abortSignal: AbortSignal.timeout(120000),
    });
    if ((await digest(remote.Body)) !== sha256)
      throw new Error("异机备份下载校验失败");
    return {
      at: new Date().toISOString(),
      key: Key,
      bytes: size,
      sha256,
      verified: true,
    };
  } finally {
    await unlink(target).catch(() => {});
  }
}

export async function restoreEncrypted(source, target) {
  const key = encryptionKey(),
    size = (await stat(source)).size;
  const { open } = await import("node:fs/promises"),
    input = await open(source, "r");
  const header = Buffer.alloc(20),
    tag = Buffer.alloc(16);
  try {
    await input.read(header, 0, 20, 0);
    await input.read(tag, 0, 16, size - 16);
  } finally {
    await input.close();
  }
  if (!header.subarray(0, 8).equals(MAGIC) || size < 68)
    throw new Error("加密备份格式无效");
  const cipher = createDecipheriv("aes-256-gcm", key, header.subarray(8));
  cipher.setAuthTag(tag);
  const partial = target + ".restore.part";
  let mfaKey = Buffer.alloc(0);
  try {
    await pipeline(
      createReadStream(source, { start: 20, end: size - 17 }),
      cipher,
      new Transform({
        transform(chunk, encoding, cb) {
          const n = Math.min(32 - mfaKey.length, chunk.length);
          if (n) mfaKey = Buffer.concat([mfaKey, chunk.subarray(0, n)]);
          cb(null, chunk.subarray(n));
        },
      }),
      createWriteStream(partial, { flags: "wx", mode: 0o600 }),
    );
    const verify = new DatabaseSync(partial, { readOnly: true });
    try {
      if (verify.prepare("PRAGMA quick_check").get().quick_check !== "ok")
        throw new Error("恢复数据库完整性检查失败");
    } finally {
      verify.close();
    }
    // Hard-link avoids overwriting an existing database even if another process creates it.
    const { link } = await import("node:fs/promises");
    const keyPath = path.join(path.dirname(target), ".mfa-key");
    try {
      const old = await readFile(keyPath);
      if (!old.equals(mfaKey))
        throw new Error("恢复目录已有不同的MFA密钥，请选择一个空目录");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      await writeFile(keyPath, mfaKey, { flag: "wx", mode: 0o600 });
    }
    await link(partial, target);
    return { target, mfaKeyRestored: true };
  } finally {
    await unlink(partial).catch(() => {});
  }
}
