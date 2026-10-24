import {
  randomBytes,
  createHmac,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { body, fail, tx } from "./core.mjs";
import { hashToken, randomToken, verifyPassword } from "./security.mjs";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(bytes) {
  let bits = 0,
    value = 0,
    result = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
export function totp(secret, counter = Math.floor(Date.now() / 30000)) {
  let bits = 0,
    value = 0;
  const bytes = [];
  for (const c of secret) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const time = Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(time).digest(),
    offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}
export function createMfa(db, dbPath, sec, send, options = {}) {
  let key;
  if (process.env.APP_ENCRYPTION_KEY) {
    fail(
      !/^[a-fA-F0-9]{64}$/.test(process.env.APP_ENCRYPTION_KEY),
      500,
      "APP_ENCRYPTION_KEY 须为 64 位十六进制密钥",
    );
    key = Buffer.from(process.env.APP_ENCRYPTION_KEY, "hex");
  } else if (dbPath === ":memory:") key = randomBytes(32);
  else {
    const file = path.join(path.dirname(path.resolve(dbPath)), ".mfa-key");
    try {
      writeFileSync(file, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    key = readFileSync(file);
    fail(key.length !== 32, 500, "MFA 密钥文件损坏");
  }
  const encrypt = (secret) => {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, iv);
    return Buffer.concat([
      iv,
      cipher.update(secret),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("base64");
  };
  const decrypt = (value) => {
    const data = Buffer.from(value, "base64"),
      cipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(-16));
    return Buffer.concat([
      cipher.update(data.subarray(12, -16)),
      cipher.final(),
    ]).toString();
  };
  const get = (id) => db.prepare("SELECT * FROM mfa WHERE user_id=?").get(id);
  const check = (row, code, allowRecovery = true) => {
    if (typeof code !== "string") return false;
    if (/^\d{6}$/.test(code)) {
      const counter = Math.floor(Date.now() / 30000),
        secret = decrypt(row.secret);
      for (const c of [counter - 1, counter, counter + 1])
        if (
          c > row.last_counter &&
          timingSafeEqual(Buffer.from(totp(secret, c)), Buffer.from(code))
        ) {
          db.prepare("UPDATE mfa SET last_counter=? WHERE user_id=?").run(
            c,
            row.user_id,
          );
          return true;
        }
    }
    if (allowRecovery) {
      const codes = JSON.parse(row.recovery),
        index = codes.indexOf(hashToken(code.trim()));
      if (index >= 0) {
        codes.splice(index, 1);
        db.prepare("UPDATE mfa SET recovery=? WHERE user_id=?").run(
          JSON.stringify(codes),
          row.user_id,
        );
        return true;
      }
    }
    return false;
  };
  const binding = (req) =>
    (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("hust_mfa="))
      ?.slice(9) || "";
  function challenge(req, res, user) {
    const id = randomToken(),
      token = randomToken();
    db.prepare(
      "INSERT INTO auth_challenges(id,user_id,kind,payload,expires) VALUES(?,?,'mfa',?,?)",
    ).run(
      hashToken(id),
      user.id,
      JSON.stringify({
        binding: hashToken(token),
        password: hashToken(user.password_hash),
      }),
      Date.now() + 300000,
    );
    res.setHeader(
      "Set-Cookie",
      `hust_mfa=${token}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=300${options.secure ? "; Secure" : ""}`,
    );
    return { mfaRequired: true, challenge: id };
  }
  return {
    enabled: (id) => !!get(id)?.enabled,
    challenge,
    async route(req, res, url) {
      const p = url.pathname,
        m = req.method;
      if (p === "/api/auth/mfa/login" && m === "POST") {
        const b = await body(req);
        sec.limit(`mfa-ip:${req.clientIp}`, 30, 900000);
        fail(
          typeof b.challenge !== "string" ||
            !/^[a-f0-9]{64}$/.test(b.challenge),
          400,
          "验证请求无效",
        );
        const id = hashToken(b.challenge),
          row = tx(db, () => {
            const proof = db
              .prepare(
                "SELECT * FROM auth_challenges WHERE id=? AND kind='mfa'",
              )
              .get(id);
            fail(
              !proof ||
                proof.expires <= Date.now() ||
                proof.attempts >= 5 ||
                JSON.parse(proof.payload).binding !== hashToken(binding(req)),
              401,
              "验证已过期，请重新登录",
            );
            const user = db
                .prepare("SELECT password_hash,disabled FROM users WHERE id=?")
                .get(proof.user_id),
              config = get(proof.user_id);
            fail(
              !user ||
                user.disabled ||
                hashToken(user.password_hash) !==
                  JSON.parse(proof.payload).password ||
                !config?.enabled,
              401,
              "登录凭据已变化，请重新登录",
            );
            // Commit the account-wide attempt before checking the second factor.
            // Wrong codes must not roll it back or gain a new budget via another
            // source IP or freshly issued challenge. Invalid/revoked challenges
            // cannot consume another account's budget.
            sec.limit(`mfa-account:${proof.user_id}`, 10, 900000);
            db.prepare(
              "UPDATE auth_challenges SET attempts=attempts+1 WHERE id=?",
            ).run(id);
            return proof;
          });
        const result = tx(db, () => {
          const fresh = db
              .prepare("SELECT * FROM auth_challenges WHERE id=?")
              .get(id),
            user = db
              .prepare("SELECT * FROM users WHERE id=?")
              .get(row.user_id),
            config = get(row.user_id);
          fail(
            !fresh ||
              fresh.expires <= Date.now() ||
              fresh.attempts > 5 ||
              fresh.kind !== "mfa" ||
              fresh.user_id !== row.user_id ||
              fresh.payload !== row.payload ||
              !user ||
              user.disabled ||
              hashToken(user.password_hash) !==
                JSON.parse(row.payload).password ||
              !config?.enabled,
            401,
            "登录凭据已变化，请重新登录",
          );
          fail(
            !check(config, b.code),
            401,
            "动态验证码或恢复码无效（验证码不可重复使用）",
          );
          db.prepare("DELETE FROM auth_challenges WHERE id=?").run(id);
          db.prepare("DELETE FROM rate_limits WHERE key=?").run(
            `mfa-account:${user.id}`,
          );
          sec.audit(user.id, "account.mfa_login", user.id);
          return sec.start(req, res, user);
        });
        send(res, result);
        return true;
      }
      if (!p.startsWith("/api/auth/mfa")) return false;
      const user = sec.current(req);
      if (p === "/api/auth/mfa" && m === "GET") {
        const row = get(user.id);
        send(res, {
          enabled: !!row?.enabled,
          recoveryRemaining: row?.enabled ? JSON.parse(row.recovery).length : 0,
        });
        return true;
      }
      if (m !== "POST") return false;
      const b = await body(req);
      sec.limit(`mfa-change:${user.id}`, 10, 900000);
      if (p === "/api/auth/mfa/setup") {
        fail(
          typeof b.currentPassword !== "string" ||
            b.currentPassword.length > 128 ||
            !(await verifyPassword(b.currentPassword, user.password_hash)),
          403,
          "当前密码错误",
        );
        const secret = base32(randomBytes(20)),
          uri = `otpauth://totp/${encodeURIComponent(`HUST场地:${user.email}`)}?secret=${secret}&issuer=HUST&algorithm=SHA1&digits=6&period=30`;
        sec.write(req, null, (fresh) => {
          fail(fresh.password_hash !== user.password_hash, 409, "密码已变化");
          fail(get(user.id)?.enabled, 409, "请先关闭现有两步验证");
          db.prepare(
            "INSERT INTO mfa(user_id,secret) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret,last_counter=-1",
          ).run(user.id, encrypt(secret));
        });
        send(res, { secret, qr: await QRCode.toDataURL(uri) });
        return true;
      }
      if (p === "/api/auth/mfa/enable") {
        const codes = Array.from({ length: 10 }, () =>
          randomBytes(8).toString("hex"),
        );
        sec.write(req, null, (fresh) => {
          const row = get(fresh.id);
          fail(!row || row.enabled, 409, "请重新开始设置");
          fail(!check(row, b.code, false), 400, "动态验证码无效");
          db.prepare("UPDATE mfa SET enabled=1,recovery=? WHERE user_id=?").run(
            JSON.stringify(codes.map(hashToken)),
            fresh.id,
          );
          db.prepare(
            "DELETE FROM sessions WHERE user_id=? AND token_hash<>?",
          ).run(fresh.id, fresh.token_hash);
          sec.audit(fresh.id, "account.mfa_enabled", fresh.id);
        });
        send(res, { codes });
        return true;
      }
      if (p === "/api/auth/mfa/disable") {
        fail(
          typeof b.currentPassword !== "string" ||
            b.currentPassword.length > 128 ||
            !(await verifyPassword(b.currentPassword, user.password_hash)),
          403,
          "当前密码错误",
        );
        sec.write(req, null, (fresh) => {
          fail(fresh.password_hash !== user.password_hash, 409, "密码已变化");
          const row = get(fresh.id);
          fail(
            !row?.enabled || !check(row, b.code),
            400,
            "动态验证码或恢复码无效",
          );
          db.prepare("DELETE FROM mfa WHERE user_id=?").run(fresh.id);
          db.prepare("DELETE FROM auth_challenges WHERE user_id=?").run(
            fresh.id,
          );
          db.prepare(
            "DELETE FROM sessions WHERE user_id=? AND token_hash<>?",
          ).run(fresh.id, fresh.token_hash);
          sec.audit(fresh.id, "account.mfa_disabled", fresh.id);
        });
        send(res, { ok: true });
        return true;
      }
      return false;
    },
  };
}
