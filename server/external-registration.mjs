import { randomUUID } from "node:crypto";
import { body, fail, fields, tx, now } from "./core.mjs";
import {
  hashToken,
  randomToken,
  hashPassword,
  passwordValid,
} from "./security.mjs";

export function externalRegistration(db, sec, send, binding) {
  function inspect(req, proof) {
    fail(
      typeof proof !== "string" || !/^[a-f0-9]{64}$/.test(proof),
      400,
      "注册凭据无效，请重新验证登录方式",
    );
    const row = db
      .prepare("SELECT * FROM signup_proofs WHERE id=?")
      .get(hashToken(proof));
    fail(
      !row ||
        row.expires <= Date.now() ||
        row.binding !== hashToken(binding(req)),
      400,
      "注册凭据已失效或不属于当前浏览器，请重新验证",
    );
    return row;
  }
  return {
    issue(req, provider, subject) {
      const proof = randomToken();
      db.prepare("INSERT INTO signup_proofs VALUES(?,?,?,?,?)").run(
        hashToken(proof),
        provider,
        subject,
        hashToken(binding(req)),
        Date.now() + 600000,
      );
      return { registrationRequired: true, proof };
    },
    async route(req, res, url) {
      if (
        !["/api/auth/signup/inspect", "/api/auth/signup/complete"].includes(
          url.pathname,
        ) ||
        req.method !== "POST"
      )
        return false;
      sec.limit(`external-register-ip:${req.clientIp}`, 30, 3600000);
      const b = await body(req),
        old = inspect(req, b.proof);
      if (url.pathname.endsWith("/inspect")) {
        send(res, {
          provider: old.provider,
          phone: old.provider === "sms" ? old.subject : "",
          expires: old.expires,
          validForMs: Math.max(0, old.expires - Date.now()),
        });
        return true;
      }
      const profile = fields(b),
        email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
      fail(
        email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
        400,
        "请填写有效的登录邮箱",
      );
      fail(
        !passwordValid(b.password),
        400,
        "密码需为 10–128 位，并包含字母和数字",
      );
      fail(b.confirmed !== true, 400, "请确认企业资料真实并同意账号创建");
      fail(
        old.provider === "sms" && profile.phone !== old.subject,
        400,
        "联系电话须与刚验证的手机号一致",
      );
      const hashed = await hashPassword(b.password);
      const result = tx(db, () => {
        const fresh = inspect(req, b.proof);
        fail(
          db.prepare("SELECT id FROM users WHERE email=?").get(email),
          409,
          "该邮箱已有账号，请登录原账号后绑定，系统不会自动合并账号",
        );
        if (fresh.provider === "sms")
          fail(
            db
              .prepare("SELECT user_id FROM verified_phones WHERE phone=?")
              .get(fresh.subject),
            409,
            "该号码已绑定账号，请重新使用手机号登录",
          );
        else
          fail(
            db
              .prepare(
                "SELECT user_id FROM external_identities WHERE provider=? AND subject=?",
              )
              .get(fresh.provider, fresh.subject),
            409,
            "第三方身份已绑定账号，请重新发起登录",
          );
        const id = randomUUID();
        db.prepare(
          "INSERT INTO users(id,email,password_hash,role,company,contact,phone,created) VALUES(?,?,?,'enterprise',?,?,?,?)",
        ).run(
          id,
          email,
          hashed,
          profile.company,
          profile.contact,
          profile.phone,
          now(),
        );
        if (fresh.provider === "sms")
          db.prepare("INSERT INTO verified_phones VALUES(?,?)").run(
            fresh.subject,
            id,
          );
        else
          db.prepare("INSERT INTO external_identities VALUES(?,?,?)").run(
            fresh.provider,
            fresh.subject,
            id,
          );
        db.prepare("DELETE FROM signup_proofs WHERE id=?").run(fresh.id);
        // Concurrent challenges for the same verified identity cannot create duplicates.
        db.prepare(
          "DELETE FROM signup_proofs WHERE provider=? AND subject=?",
        ).run(fresh.provider, fresh.subject);
        const previous = sec.session(req);
        if (previous)
          db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
            previous.token_hash,
          );
        sec.audit(id, "account.external_registered", id, {
          provider: fresh.provider,
        });
        return sec.start(
          req,
          res,
          db.prepare("SELECT * FROM users WHERE id=?").get(id),
        );
      });
      send(res, result, 201);
      return true;
    },
  };
}
