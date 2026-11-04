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
import { createReadStream, createWriteStream, constants } from "node:fs";
import {
  readFile,
  stat,
  statfs,
  unlink,
  writeFile,
  lstat,
  mkdtemp,
  rmdir,
  chmod,
  copyFile,
  open,
  realpath,
} from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline, finished } from "node:stream/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { backupMfaKey, backupKeyFile, verifyMfaKey } from "./backup-key.mjs";
import { assertSqliteTargetAvailable } from "./sqlite-target.mjs";

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

async function closeReadable(stream) {
  // Async-generator test/adapter bodies have no native handle to destroy.
  if (typeof stream?.destroy !== "function") return;
  const closed = finished(stream, { cleanup: true }).catch(() => {});
  stream.destroy();
  await closed;
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
  let target,
    uploadBody,
    remoteBody,
    verify,
    snapshotDirectory,
    snapshot,
    failed,
    frozenPaths = [source];
  const reserve = Number(process.env.MIN_FREE_DISK_MB || 256) * 1048576;
  const requireSpace = async (bytes) => {
    const disk = await statfs(path.dirname(source));
    if (Number(disk.bavail) * Number(disk.bsize) < bytes + reserve)
      throw new Error("异机备份加密临时空间不足，请扩容后重试");
  };
  const frozenSnapshot = async () => {
    for (const file of frozenPaths) {
      for (const suffix of ["-wal", "-shm", "-journal"]) {
        try {
          await lstat(file + suffix);
          throw new Error(
            "异机备份输入存在 SQLite 辅助文件，请先创建一致性快照",
          );
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    }
  };
  const privateSnapshot = async () => {
    snapshotDirectory = await mkdtemp(
      path.join(path.dirname(path.resolve(source)), ".offsite-"),
    );
    snapshot = path.join(snapshotDirectory, "snapshot.sqlite");
    target = path.join(snapshotDirectory, "payload.encrypted.part");
  };
  try {
    const sourceInfo = await stat(source);
    let live = path.resolve(source) === path.resolve(dbPath);
    if (!live) {
      // Symlink/hard-link aliases of the current database need the same WAL
      // snapshot semantics and current-key contract as its configured path.
      const current = await stat(dbPath).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      live =
        !!current &&
        sourceInfo.dev === current.dev &&
        sourceInfo.ino === current.ino;
    }
    let input = source,
      mfaKey;
    if (live) {
      // Use the configured SQLite pathname, not a hard-link alias whose WAL
      // would otherwise be searched under a different filename.
      const current = new DatabaseSync(dbPath, { readOnly: true });
      try {
        current.exec("PRAGMA busy_timeout=5000;");
        const viewBytes =
          current.prepare("PRAGMA page_count").get().page_count *
          current.prepare("PRAGMA page_size").get().page_size;
        // The logical SQLite view includes pages committed only to WAL. Both
        // a new consistent snapshot and its ciphertext must fit concurrently.
        await requireSpace(Math.max(viewBytes, sourceInfo.size) * 2 + 68);
        mfaKey = backupMfaKey(dbPath);
        await privateSnapshot();
        current.exec(`VACUUM INTO '${snapshot.replaceAll("'", "''")}'`);
        await chmod(snapshot, 0o600);
        input = snapshot;
      } finally {
        current.close();
      }
    } else {
      // Published snapshots are immutable inputs, never raw WAL/main-file
      // exports. Reject auxiliary files instead of silently omitting them.
      frozenPaths = [...new Set([source, await realpath(source)])];
      await frozenSnapshot();
      mfaKey = backupKeyFile(source + ".mfa-key");
      const file = await open(source, "r"),
        header = Buffer.alloc(20);
      try {
        await file.read(header, 0, header.length, 0);
      } finally {
        await file.close();
      }
      if (header[18] === 2 || header[19] === 2) {
        // Opening a fully checkpointed WAL-format file read-only can itself
        // create WAL/SHM files. Verify only a private, stable byte-for-byte copy
        // so an otherwise frozen published snapshot stays untouched.
        const before = await stat(source, { bigint: true });
        if (before.nlink > 1n)
          throw new Error(
            "独立WAL快照存在硬链接，无法确认冻结状态，请创建独立的一致性副本",
          );
        await requireSpace(Number(before.size) * 2 + 68);
        const sourceHash = await digest(createReadStream(source));
        await frozenSnapshot();
        await privateSnapshot();
        await copyFile(source, snapshot, constants.COPYFILE_EXCL);
        await chmod(snapshot, 0o600);
        const copiedHash = await digest(createReadStream(snapshot)),
          afterHash = await digest(createReadStream(source)),
          after = await stat(source, { bigint: true });
        if (
          ["dev", "ino", "size", "mtimeNs", "ctimeNs"].some(
            (key) => before[key] !== after[key],
          ) ||
          sourceHash !== copiedHash ||
          sourceHash !== afterHash
        )
          throw new Error(
            "冻结快照复制期间文件发生变化，已停止上传，请创建独立的一致性副本",
          );
        await frozenSnapshot();
        input = snapshot;
      } else {
        target = source + `.${randomUUID()}.encrypted.part`;
      }
    }
    verify = new DatabaseSync(input, { readOnly: true });
    verify.exec("PRAGMA busy_timeout=5000; BEGIN;");
    if (verify.prepare("PRAGMA quick_check").get().quick_check !== "ok")
      throw new Error("备份完整性检查失败");
    verifyMfaKey(verify, mfaKey);
    await requireSpace((await stat(input)).size + 68);
    await encryptBackup(input, target, mfaKey);
    // Hold the read transaction during encryption. A DELETE-mode writer is
    // blocked; a WAL writer leaves sidecars and is rejected before any send.
    if (!live) await frozenSnapshot();
    verify.close();
    verify = null;
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
    uploadBody = createReadStream(target);
    await client.send(
      new PutObjectCommand({
        Bucket,
        Key,
        Body: uploadBody,
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
    remoteBody = remote.Body;
    if ((await digest(remote.Body)) !== sha256)
      throw new Error("异机备份下载校验失败");
    return {
      at: new Date().toISOString(),
      key: Key,
      bytes: size,
      sha256,
      verified: true,
    };
  } catch (error) {
    failed = error;
    throw error;
  } finally {
    // An early HTTP rejection/reset can leave the upload's piped file paused.
    // Close handles before unlinking so failed sends release disk space too.
    const cleanupErrors = [];
    try {
      verify?.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    for (const stream of [uploadBody, remoteBody]) {
      try {
        await closeReadable(stream);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    // Remove only paths created by this call; never scan or recursively remove
    // the source directory, published snapshots, keys, or unrelated files.
    for (const file of [
      target,
      ...(snapshot
        ? [
            snapshot,
            snapshot + "-wal",
            snapshot + "-shm",
            snapshot + "-journal",
          ]
        : []),
    ]) {
      if (!file) continue;
      try {
        await unlink(file);
      } catch (error) {
        if (error.code !== "ENOENT") cleanupErrors.push(error);
      }
    }
    if (snapshotDirectory) {
      try {
        await rmdir(snapshotDirectory);
      } catch (error) {
        if (error.code !== "ENOENT") cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length)
      throw new AggregateError(
        [...(failed ? [failed] : []), ...cleanupErrors],
        "异机备份临时资源清理失败",
      );
  }
}

export async function restoreEncrypted(source, target) {
  // A missing main file is not an empty SQLite target: an old WAL can replay
  // successfully against the restored file and silently replace snapshot data.
  assertSqliteTargetAvailable(target, "恢复");
  const key = encryptionKey(),
    size = (await stat(source)).size;
  if (size < 68) throw new Error("加密备份格式无效");
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
  if (!header.subarray(0, 8).equals(MAGIC)) throw new Error("加密备份格式无效");
  const cipher = createDecipheriv("aes-256-gcm", key, header.subarray(8));
  cipher.setAuthTag(tag);
  const partial = target + `.${randomUUID()}.restore.part`;
  const partialKey = partial + ".mfa-key";
  let mfaKey = Buffer.alloc(0);
  let publishedKey = null;
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
      verifyMfaKey(verify, mfaKey);
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
      await writeFile(partialKey, mfaKey, { flag: "wx", mode: 0o600 });
      const identity = await lstat(partialKey);
      await link(partialKey, keyPath);
      publishedKey = { file: keyPath, identity };
    }
    // Decryption/key publication can take time. Reject sidecars that appeared
    // meanwhile, preserving them for the operator rather than deleting them.
    assertSqliteTargetAvailable(target, "恢复");
    await link(partial, target);
    publishedKey = null;
    return { target, mfaKeyRestored: true };
  } catch (error) {
    if (publishedKey) {
      const current = await lstat(publishedKey.file).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
      if (
        current?.dev === publishedKey.identity.dev &&
        current.ino === publishedKey.identity.ino
      )
        await unlink(publishedKey.file);
    }
    throw error;
  } finally {
    // A read-only check of a WAL-mode snapshot can still create SQLite sidecars.
    for (const file of [
      partial,
      partialKey,
      partial + "-wal",
      partial + "-shm",
    ])
      await unlink(file).catch(() => {});
  }
}
