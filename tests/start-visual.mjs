import { createApp } from "../server/app.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
const dir = await mkdtemp(path.join(os.tmpdir(), "outdoors-visual-"));
const app = await createApp({
  dbPath: path.join(dir, "app.sqlite"),
  admin: { email: "visual@test.local", password: "VisualAccount123!" },
  captchaTestAnswer: "246789",
  maintenance: { scheduled: false },
});
const root = app.db.prepare("SELECT id FROM users").get();
app.db
  .prepare(
    "INSERT INTO users(id,email,password_hash,role,company,contact,phone,created) SELECT 'visual-enterprise','enterprise@test.local',password_hash,'enterprise','校园创新科技有限公司','张老师','13800138000','2026-01-01T00:00:00Z' FROM users WHERE id=?",
  )
  .run(root.id);
const image = await sharp(
  Buffer.from(
    '<svg width="800" height="450" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="450" fill="#f0f4ee"/><rect x="30" y="30" width="740" height="390" rx="12" fill="#1f5141"/><circle cx="600" cy="180" r="95" fill="#bfd5a9"/><path d="M80 330L230 130L370 330Z" fill="#faf7ed"/><rect x="430" y="320" width="280" height="16" fill="#faf7ed"/></svg>',
  ),
)
  .png()
  .toBuffer();
app.db
  .prepare(
    "INSERT INTO bookings(id,user_id,company,contact,phone,start,end,slot,status,image,image_type,created) VALUES('HUST-VISUAL-001','visual-enterprise','校园创新科技有限公司','张老师','13800138000','2100-01-01','2100-01-02',15,'待审核',?,'image/png','2026-10-20T00:00:00Z')",
  )
  .run(image);
app.server.listen(3102, "0.0.0.0");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
    process.exit(0);
  });
