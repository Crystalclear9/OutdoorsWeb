import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.mjs";
import { hashPassword, hashToken } from "../server/security.mjs";

const dir = await mkdtemp(path.join(os.tmpdir(), "outdoor-browser-tests-"));
const app = await createApp({
  dbPath: path.join(dir, "app.sqlite"),
  admin: { email: "admin@test.local", password: "BrowserAdmin123!" },
  captchaTestAnswer: "246789",
  trustedProxies: "127.0.0.1",
  maintenance: { scheduled: false },
});
app.db
  .prepare(
    "INSERT INTO users(id,email,password_hash,role,company,contact,phone,created) VALUES('completion-ui','completion@test.local',?,'enterprise','改期界面测试企业','李老师','13900139000',?)",
  )
  .run(await hashPassword("CompletionAccount123!"), new Date().toISOString());
// A past pending application verifies role-specific expiry without forging an approval.
app.db
  .prepare(
    `INSERT INTO bookings(id,user_id,company,contact,phone,builder_contact,builder_phone,content_only,start,end,slot,status,image,image_type,created)
VALUES('EXPIRED-CONTENT-UI','completion-ui','过期待审界面固定企业','李老师','13900139000','搭建陈师傅','13800138000',1,'2000-01-01','2000-01-01',1,'待审核',?,'image/png','1999-12-30T00:00:00.000Z')`,
  )
  .run(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=",
      "base64",
    ),
  );
// Verified-provider proofs are seeded only in this isolated test entry point.
app.db
  .prepare(
    "INSERT INTO users(id,email,password_hash,role,company,contact,phone,created) SELECT 'finance-ui','finance-ui@test.local',password_hash,'admin','活动中心','财务老师','13900139000',created FROM users WHERE is_super=1",
  )
  .run();
app.db
  .prepare(
    "INSERT INTO user_permissions(user_id,permission) VALUES('finance-ui','payments.manage')",
  )
  .run();
for (const [proof, provider, subject] of [
  ["c".repeat(64), "wechat", "browser-new-company"],
  ["d".repeat(64), "sms", "13600136000"],
  ["e".repeat(64), "qq", "browser-slow-session"],
  ["f".repeat(64), "qq", "browser-expiring-proof"],
])
  app.db
    .prepare("INSERT INTO signup_proofs VALUES(?,?,?,?,?)")
    .run(
      hashToken(proof),
      provider,
      subject,
      hashToken("signup-browser-binding"),
      Date.now() + 600000,
    );
app.server.listen(3101, "127.0.0.1", () =>
  console.log("Isolated browser test server ready on 3101"),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
    process.exit(0);
  });
