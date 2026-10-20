import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.mjs";

const dir = await mkdtemp(path.join(os.tmpdir(), "outdoor-browser-tests-"));
const app = await createApp({
  dbPath: path.join(dir, "app.sqlite"),
  admin: { email: "admin@test.local", password: "BrowserAdmin123!" },
});
app.server.listen(3101, "127.0.0.1", () =>
  console.log("Isolated browser test server ready on 3101"),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
    process.exit(0);
  });
