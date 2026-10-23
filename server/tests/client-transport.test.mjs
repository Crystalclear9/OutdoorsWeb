import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { readResponse } from "../../src/request.js";

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

for (const kind of ["json", "blob"]) {
  test(`client deadline interrupts a stalled ${kind} body after headers`, async () => {
    let headersSent = false;
    await withServer(
      (req, res) => {
        res.writeHead(200, {
          "Content-Type": kind === "json" ? "application/json" : "image/png",
        });
        res.flushHeaders();
        res.write(kind === "json" ? '{"partial":' : "partial image");
        headersSent = true;
      },
      async (url) => {
        await assert.rejects(
          readResponse(url, {}, (response) => response[kind](), 2000),
          (error) => error.name === "AbortError",
        );
        assert.equal(headersSent, true);
      },
    );
  });
}

test("client preserves HTTP status and parsed bodies for business error handling", async () => {
  await withServer(
    (req, res) => {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "版本已更新" }));
    },
    async (url) => {
      const { response, body } = await readResponse(url, {}, (res) =>
        res.json(),
      );
      assert.equal(response.status, 409);
      assert.deepEqual(body, { error: "版本已更新" });
    },
  );
});

test("caller cancellation interrupts an in-progress body", async () => {
  const controller = new AbortController();
  await withServer(
    (req, res) => {
      res.writeHead(200);
      res.write("partial");
    },
    async (url) => {
      await assert.rejects(
        readResponse(url, { signal: controller.signal }, (response) => {
          controller.abort();
          return response.text();
        }),
        (error) => error.name === "AbortError",
      );
    },
  );
});
