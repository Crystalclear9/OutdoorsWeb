import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.mjs";
import { hashPassword } from "../server/security.mjs";

const dir = await mkdtemp(path.join(os.tmpdir(), "outdoor-browser-tests-"));
const app = await createApp({
  dbPath: path.join(dir, "app.sqlite"),
  admin: { email: "admin@test.local", password: "BrowserAdmin123!" },
  captchaTestAnswer: "246789",
  maintenance: { scheduled: false },
});
app.db
  .prepare(
    "INSERT INTO users(id,email,password_hash,role,company,contact,phone,created) VALUES('completion-ui','completion@test.local',?,'enterprise','改期界面测试企业','李老师','13900139000',?)",
  )
  .run(await hashPassword("CompletionAccount123!"), new Date().toISOString());
app.server.listen(3101, "127.0.0.1", () =>
  console.log("Isolated browser test server ready on 3101"),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
    process.exit(0);
  });
