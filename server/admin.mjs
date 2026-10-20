import { openStore } from "./store.mjs";
import { hashPassword, passwordValid } from "./security.mjs";
import { randomUUID } from "node:crypto";

// Explicit recovery command. Startup never silently changes an existing password.
const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase(),
  password = process.env.ADMIN_PASSWORD || "";
if (
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
  !passwordValid(password) ||
  password.includes("REPLACE_")
)
  throw new Error("请设置 ADMIN_EMAIL 和强度合格的 ADMIN_PASSWORD");
const db = openStore(process.env.DB_PATH || "data/app.sqlite");
try {
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if (user && user.role !== "admin")
    throw new Error("该邮箱为企业账号，请使用独立的管理员邮箱");
  const id = user?.id || randomUUID(),
    hashed = await hashPassword(password),
    time = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (user)
      db.prepare(
        "UPDATE users SET password_hash=?,disabled=0,must_change=0,is_super=1,version=version+1 WHERE id=?",
      ).run(hashed, id);
    else
      db.prepare(
        "INSERT INTO users(id,email,password_hash,role,company,contact,phone,created,is_super) VALUES(?,?,?,?,?,?,?,?,1)",
      ).run(id, email, hashed, "admin", "大学生活动中心", "管理员", "", time);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
    db.prepare(
      "INSERT INTO audit(actor,action,target,created) VALUES(?,?,?,?)",
    ).run(id, "account.admin_recovered", id, time);
    db.exec("COMMIT");
    console.log("管理员账号已更新，原有登录会话已失效。");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
} finally {
  db.close();
}
