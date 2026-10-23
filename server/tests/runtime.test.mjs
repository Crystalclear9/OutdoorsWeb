import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createWorkQueue } from "../work-queue.mjs";
import { hashPassword, verifyPassword } from "../security.mjs";

test("畸形请求地址返回400，服务进程继续提供健康检查", async () => {
  // Run in a child process: a request-handler rejection previously killed Node.
  const source = `
    import assert from 'node:assert/strict';
    import net from 'node:net';
    import {createApp} from ${JSON.stringify(new URL("../app.mjs", import.meta.url).href)};
    import {listenHttp} from ${JSON.stringify(new URL("./http-listen.mjs", import.meta.url).href)};
    const app = await createApp({dbPath:':memory:',maintenance:{scheduled:false}});
    await listenHttp(app.server);
    try {
      const port = app.server.address().port;
      const response = await new Promise((resolve,reject) => {
        let data = '';
        const socket = net.connect(port,'127.0.0.1',() => socket.write('GET http://[ HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n'));
        socket.setTimeout(3000,() => socket.destroy(new Error('response timed out')));
        socket.on('data',b => data += b);
        socket.on('error',reject);
        socket.on('end',() => resolve(data));
      });
      assert.ok(response.startsWith('HTTP/1.1 400'));
      assert.equal((await fetch('http://127.0.0.1:'+port+'/api/health')).status,200);
    } finally { await app.close(); }
  `;
  await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "-e", source],
    { timeout: 10000 },
  );
});

test("受限任务队列保持并发上限和排队顺序，失败释放名额，溢出返回503", async () => {
  const run = createWorkQueue({
    concurrency: 2,
    maxWaiting: 2,
    message: "busy",
  });
  const gates = [],
    started = [];
  const tasks = Array.from({ length: 4 }, (_, i) => {
    const gate = new Promise((resolve) => {
      gates[i] = resolve;
    });
    return run(async () => {
      started.push(i);
      await gate;
      if (i === 0) throw new Error("task failed");
      return i;
    });
  });
  const settled = Promise.allSettled(tasks);
  assert.deepEqual(started, [0, 1]);
  await assert.rejects(
    run(() => 99),
    (e) => e.status === 503,
  );
  gates[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2]);
  gates.slice(1).forEach((release) => release());
  const results = await settled;
  assert.equal(results[0].status, "rejected");
  assert.deepEqual(
    results.slice(1).map((r) => r.value),
    [1, 2, 3],
  );
  assert.equal(await run(() => 42), 42);
});

test("突发密码计算只接纳有限任务，拒绝后仍可正常散列和验证", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 24 }, () => hashPassword("RuntimeAccount123!")),
  );
  const accepted = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(accepted.length, 18);
  assert.equal(rejected.length, 6);
  assert.ok(rejected.every((r) => r.reason.status === 503));
  assert.equal(
    await verifyPassword("RuntimeAccount123!", accepted[0].value),
    true,
  );
  assert.equal(await verifyPassword("wrong", accepted[0].value), false);
});
