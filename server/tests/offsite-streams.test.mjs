import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { S3Client } from "@aws-sdk/client-s3";
import os from "node:os";
import path from "node:path";
import { uploadOffsite } from "../offsite.mjs";
import { listenHttp } from "./http-listen.mjs";

for (const outcome of [
  "rejected",
  "connection-reset",
  "before-open",
  "accepted",
  "download-reset",
]) {
  test(`异机备份真实HTTP ${outcome}后关闭文件及响应流再清理密文`, async (t) => {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "outdoors-offsite-stream-"),
      ),
      source = path.join(directory, "snapshot.sqlite"),
      key = Buffer.alloc(32, 71),
      db = new DatabaseSync(source);
    db.exec(
      "CREATE TABLE proof(value BLOB); INSERT INTO proof VALUES(zeroblob(8388608))",
    );
    db.close();
    await writeFile(path.join(directory, ".mfa-key"), key);
    const before = await readFile(source),
      names = [
        "BACKUP_ENCRYPTION_KEY",
        "APP_ENCRYPTION_KEY",
        "S3_BACKUP_BUCKET",
        "S3_BACKUP_ENDPOINT",
        "MIN_FREE_DISK_MB",
      ],
      previous = Object.fromEntries(
        names.map((name) => [name, process.env[name]]),
      ),
      streams = [],
      responses = [],
      originalRead = fs.createReadStream;
    process.env.BACKUP_ENCRYPTION_KEY = "cd".repeat(32);
    process.env.APP_ENCRYPTION_KEY = "";
    process.env.S3_BACKUP_BUCKET = "isolated-test";
    process.env.MIN_FREE_DISK_MB = "0";
    delete process.env.S3_BACKUP_ENDPOINT;
    fs.createReadStream = (...args) => {
      const stream = originalRead(...args);
      if (String(args[0]).endsWith(".encrypted.part")) streams.push(stream);
      return stream;
    };
    syncBuiltinESMExports();
    let content, sha256;
    const server = createServer(async (req, res) => {
      try {
        if (req.method === "PUT") {
          if (outcome === "rejected") {
            res
              .writeHead(403, { "Content-Type": "application/xml" })
              .end(
                "<Error><Code>AccessDenied</Code><Message>Denied</Message></Error>",
              );
            return;
          }
          if (outcome === "connection-reset") {
            req.socket.destroy();
            return;
          }
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          content = Buffer.concat(chunks);
          sha256 = req.headers["x-amz-meta-sha256"];
          res.writeHead(200).end();
        } else if (req.method === "HEAD") {
          res
            .writeHead(200, {
              "Content-Length": content.length,
              "x-amz-meta-sha256": sha256,
            })
            .end();
        } else {
          res.writeHead(200, { "Content-Length": content.length });
          if (outcome === "download-reset") {
            res.write(content.subarray(0, 1));
            setImmediate(() => res.destroy());
          } else res.end(content);
        }
      } catch {
        req.socket.destroy();
      }
    });
    await listenHttp(server);
    const client = new S3Client({
      endpoint: `http://127.0.0.1:${server.address().port}`,
      region: "us-east-1",
      forcePathStyle: true,
      maxAttempts: 1,
      requestChecksumCalculation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: "isolated-key",
        secretAccessKey: "isolated-secret",
      },
    });
    const originalSend = client.send.bind(client);
    let rejectedBeforeOpen = false;
    client.send = async (...args) => {
      if (outcome === "before-open") {
        rejectedBeforeOpen = args[0].input.Body.pending;
        throw new Error("sender rejected before opening file");
      }
      const result = await originalSend(...args);
      if (result.Body) responses.push(result.Body);
      return result;
    };
    t.after(async () => {
      for (const stream of streams) stream.destroy();
      client.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      fs.createReadStream = originalRead;
      syncBuiltinESMExports();
      for (const name of names) {
        if (previous[name] === undefined) delete process.env[name];
        else process.env[name] = previous[name];
      }
      assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
      assert.ok(
        path.basename(directory).startsWith("outdoors-offsite-stream-"),
      );
      await rm(directory, { recursive: true, force: true });
    });
    if (outcome === "accepted")
      assert.equal(
        (await uploadOffsite(source, source, client)).verified,
        true,
      );
    else if (outcome === "before-open")
      await assert.rejects(
        uploadOffsite(source, source, client),
        /sender rejected before opening file/,
      );
    else await assert.rejects(uploadOffsite(source, source, client));
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (outcome === "before-open") assert.equal(rejectedBeforeOpen, true);
    assert.equal(streams.length, 2, "摘要和PUT各打开一个真实文件流");
    assert.ok(
      streams.every((stream) => stream.closed && stream.destroyed),
      "返回前全部文件读流均应关闭",
    );
    assert.ok(
      responses.every((stream) => stream.closed || stream.readableEnded),
      "回读响应应结束或关闭",
    );
    assert.deepEqual((await readdir(directory)).sort(), [
      ".mfa-key",
      "snapshot.sqlite",
    ]);
    assert.deepEqual(await readFile(source), before);
    assert.deepEqual(await readFile(path.join(directory, ".mfa-key")), key);
  });
}
