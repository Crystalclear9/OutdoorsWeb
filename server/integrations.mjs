import { randomUUID, randomInt } from "node:crypto";
import { body, fail, tx, now, HttpError } from "./core.mjs";
import { hashToken, randomToken, verifyPassword } from "./security.mjs";
import { externalRegistration } from "./external-registration.mjs";
import { integrationReadiness } from "./readiness.mjs";

export const transportConfigured = () =>
  integrationReadiness().find((r) => r.key === "sms").configured;
const xml = (s) =>
  String(s).replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
export async function deliverPhone(kind, phone, message) {
  fail(!transportConfigured(), 503, "短信或电话服务尚未配置");
  fail(
    typeof phone !== "string" || !/^1\d{10}$/.test(phone),
    400,
    "手机号无效",
  );
  const sid = process.env.TWILIO_ACCOUNT_SID;
  fail(!/^AC[a-fA-F0-9]{32}$/.test(sid), 503, "通信服务账号配置无效");
  const data = { To: `+86${phone}`, From: process.env.TWILIO_FROM };
  if (kind === "voice")
    data.Twiml = `<Response><Say voice="${xml(process.env.TWILIO_VOICE || "Polly.Zhiyu")}" language="cmn-CN">${xml(message)}</Say></Response>`;
  else data.Body = message;
  const result = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/${kind === "voice" ? "Calls" : "Messages"}.json`,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Basic ${Buffer.from(sid + ":" + process.env.TWILIO_AUTH_TOKEN).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(data),
    },
  );
  if (!result.ok) {
    // Creating a call/message is not idempotent: a server error can arrive
    // after acceptance. Only an explicit rate-limit refusal is safe to retry.
    const error = new HttpError(
      503,
      `通信服务返回 HTTP ${result.status}，请管理员核对受理记录或配置`,
    );
    error.deliveryUncertain = result.status >= 500 || result.status === 408;
    error.retryable = result.status === 429;
    if (error.retryable) {
      const value = result.headers.get("Retry-After") || "";
      const retryAt = /^\d+$/.test(value)
        ? Date.now() + Number(value) * 1000
        : Date.parse(value);
      if (Number.isSafeInteger(retryAt)) error.retryAt = retryAt;
    }
    await result.body?.cancel().catch(() => {});
    throw error;
  }
  const response = await result.json();
  if (
    typeof response?.sid !== "string" ||
    !response.sid.trim() ||
    response.sid.length > 128
  )
    throw Object.assign(
      new HttpError(503, "通信服务未确认受理，请核实服务商记录"),
      {
        deliveryUncertain: true,
      },
    );
  return response.sid;
}

export function enqueueResult(db, userId, message, bookingId) {
  const pref = db
    .prepare(
      "SELECT p.*,v.phone FROM contact_preferences p JOIN verified_phones v ON p.user_id=v.user_id WHERE p.user_id=?",
    )
    .get(userId);
  if (!pref || !transportConfigured()) return;
  for (const kind of ["sms", "voice"])
    if (pref[kind])
      db.prepare(
        "INSERT INTO delivery_jobs(id,kind,payload,next_at,created) VALUES(?,?,?,?,?)",
      ).run(
        randomUUID(),
        kind,
        JSON.stringify({ userId, phone: pref.phone, message, bookingId }),
        Date.now(),
        now(),
      );
}

export function integrationRoutes(db, sec, send, captcha, mfa, options = {}) {
  const sendPhone = options.sendPhone || deliverPhone,
    configured = () => !!options.sendPhone || transportConfigured();
  const providers = () =>
    Object.fromEntries(
      integrationReadiness()
        .filter((r) => ["qq", "wechat"].includes(r.key))
        .map((r) => [r.key, r.configured]),
    );
  const binding = (req) =>
    (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("hust_external="))
      ?.slice(14) || "";
  const setBinding = (res) => {
    const token = randomToken();
    res.setHeader(
      "Set-Cookie",
      `hust_external=${token}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=600${options.secure ? "; Secure" : ""}`,
    );
    return hashToken(token);
  };
  const redirect = (res, url) => {
    res.writeHead(303, { Location: url });
    res.end();
  };
  const renewBinding = (req, res) =>
    res.setHeader(
      "Set-Cookie",
      `hust_external=${binding(req)}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=600${options.secure ? "; Secure" : ""}`,
    );
  const registration = externalRegistration(db, sec, send, binding);
  return async (req, res, url) => {
    if (await registration.route(req, res, url)) return true;
    const p = url.pathname,
      m = req.method;
    if (p === "/api/auth/providers" && m === "GET") {
      send(res, { sms: configured(), ...providers() });
      return true;
    }
    if (p === "/api/auth/identities" && m === "GET") {
      const u = sec.current(req);
      send(res, {
        phone:
          db
            .prepare("SELECT phone FROM verified_phones WHERE user_id=?")
            .get(u.id)?.phone || "",
        providers: db
          .prepare("SELECT provider FROM external_identities WHERE user_id=?")
          .all(u.id)
          .map((r) => r.provider),
        preferences: db
          .prepare("SELECT sms,voice FROM contact_preferences WHERE user_id=?")
          .get(u.id) || { sms: 0, voice: 0 },
        configured: { sms: configured(), ...providers() },
      });
      return true;
    }
    if (p === "/api/auth/notifications" && m === "POST") {
      const b = await body(req);
      fail(
        typeof b.sms !== "boolean" || typeof b.voice !== "boolean",
        400,
        "通知设置无效",
      );
      sec.write(req, null, (u) => {
        fail(
          (b.sms || b.voice) &&
            (!configured() ||
              !db
                .prepare("SELECT phone FROM verified_phones WHERE user_id=?")
                .get(u.id)),
          400,
          "请先绑定并验证手机号，且由管理员配置通信服务",
        );
        db.prepare(
          "INSERT INTO contact_preferences VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET sms=excluded.sms,voice=excluded.voice",
        ).run(u.id, +b.sms, +b.voice);
        sec.audit(u.id, "account.notification_preferences", u.id, b);
      });
      send(res, { ok: true });
      return true;
    }
    if (p === "/api/auth/sms/send" && m === "POST") {
      fail(!configured(), 503, "短信服务尚未配置");
      const b = await body(req);
      captcha.verify(req, b);
      fail(
        typeof b.phone !== "string" ||
          !/^1\d{10}$/.test(b.phone) ||
          !["login", "link"].includes(b.purpose),
        400,
        "手机号或验证用途无效",
      );
      const owner = b.purpose === "link" ? sec.current(req) : null;
      sec.limit(`sms-ip:${req.clientIp}`, 10, 3600000);
      sec.limit(`sms-phone-minute:${b.phone}`, 1, 60000);
      sec.limit(`sms-phone-day:${b.phone}`, 10, 86400000);
      const code = String(randomInt(100000, 1000000)),
        id = randomToken(),
        bind = setBinding(res);
      await sendPhone(
        "sms",
        b.phone,
        `【华中科技大学场地服务】验证码 ${code}，5分钟内有效。请勿向他人提供。`,
      );
      if (owner)
        fail(
          sec.current(req).id !== owner.id,
          403,
          "发送期间账号已变化，请重新获取验证码",
        );
      db.prepare(
        "INSERT INTO sms_codes(id,phone,binding,answer,purpose,expires,user_id) VALUES(?,?,?,?,?,?,?)",
      ).run(
        hashToken(id),
        b.phone,
        bind,
        hashToken(id + code),
        b.purpose,
        Date.now() + 300000,
        owner?.id || null,
      );
      send(res, { id, expiresIn: 300 });
      return true;
    }
    if (p === "/api/auth/sms/verify" && m === "POST") {
      const b = await body(req);
      sec.limit(`sms-verify:${req.clientIp}`, 30, 900000);
      fail(
        typeof b.id !== "string" ||
          typeof b.code !== "string" ||
          !/^[a-f0-9]{64}$/.test(b.id) ||
          !/^\d{6}$/.test(b.code),
        400,
        "验证码格式无效",
      );
      const id = hashToken(b.id),
        row = db
          .prepare(
            "UPDATE sms_codes SET attempts=attempts+1 WHERE id=? AND binding=? AND expires>? AND attempts<5 RETURNING *",
          )
          .get(id, hashToken(binding(req)), Date.now());
      fail(!row, 400, "验证已失效，请重新获取");
      if (row.purpose === "link") {
        const user = sec.current(req);
        fail(row.user_id !== user.id, 403, "验证码不属于当前账号，请重新获取");
        fail(
          typeof b.currentPassword !== "string" ||
            b.currentPassword.length > 128 ||
            !(await verifyPassword(b.currentPassword, user.password_hash)),
          403,
          "请输入正确的当前密码以绑定手机号",
        );
        sec.write(req, null, (fresh) => {
          fail(fresh.password_hash !== user.password_hash, 409, "密码已变化");
          const proof = db
            .prepare("SELECT * FROM sms_codes WHERE id=?")
            .get(id);
          fail(
            !proof ||
              proof.expires <= Date.now() ||
              proof.attempts > 5 ||
              proof.user_id !== fresh.id ||
              proof.binding !== hashToken(binding(req)) ||
              proof.answer !== hashToken(b.id + b.code),
            400,
            "验证码错误或已使用",
          );
          fail(
            db
              .prepare(
                "SELECT user_id FROM verified_phones WHERE phone=? AND user_id<>?",
              )
              .get(row.phone, fresh.id),
            409,
            "该手机号已绑定其他账号",
          );
          db.prepare("DELETE FROM verified_phones WHERE user_id=?").run(
            fresh.id,
          );
          db.prepare("INSERT INTO verified_phones VALUES(?,?)").run(
            row.phone,
            fresh.id,
          );
          db.prepare("DELETE FROM sms_codes WHERE id=?").run(id);
          sec.audit(fresh.id, "account.phone_linked", fresh.id);
        });
        send(res, { ok: true });
        return true;
      }
      const result = tx(db, () => {
        const proof = db.prepare("SELECT * FROM sms_codes WHERE id=?").get(id);
        fail(
          !proof ||
            proof.expires <= Date.now() ||
            proof.attempts > 5 ||
            proof.binding !== hashToken(binding(req)) ||
            proof.purpose !== "login" ||
            proof.answer !== hashToken(b.id + b.code),
          400,
          "验证码错误或已使用",
        );
        const u = db
          .prepare(
            "SELECT u.* FROM users u JOIN verified_phones v ON v.user_id=u.id WHERE v.phone=? AND u.disabled=0",
          )
          .get(row.phone);
        if (!u) {
          fail(
            db
              .prepare("SELECT user_id FROM verified_phones WHERE phone=?")
              .get(row.phone),
            403,
            "账号已停用，请联系管理员",
          );
          db.prepare("DELETE FROM sms_codes WHERE id=?").run(id);
          return registration.issue(req, "sms", row.phone);
        }
        fail(
          u.role === "admin" && !mfa.enabled(u.id),
          403,
          "管理员请先使用密码登录并开启两步验证",
        );
        db.prepare("DELETE FROM sms_codes WHERE id=?").run(id);
        sec.audit(u.id, "account.sms_login", u.id);
        return mfa.enabled(u.id)
          ? mfa.challenge(req, res, u)
          : sec.start(req, res, u);
      });
      if (result.registrationRequired) renewBinding(req, res);
      send(res, result);
      return true;
    }
    const oauth = p.match(
      /^\/api\/auth\/oauth\/(qq|wechat)\/(start|callback|unlink)$/,
    );
    if (oauth) {
      const provider = oauth[1],
        action = oauth[2];
      if (action === "unlink" && m === "POST") {
        sec.write(req, null, (u) => {
          db.prepare(
            "DELETE FROM external_identities WHERE provider=? AND user_id=?",
          ).run(provider, u.id);
          sec.audit(u.id, "account.oauth_unlinked", provider);
        });
        send(res, { ok: true });
        return true;
      }
      fail(m !== "GET", 405, "请求方法无效");
      fail(!providers()[provider], 503, "此第三方登录尚未配置");
      const publicUrl = new URL(process.env.PUBLIC_URL);
      fail(
        publicUrl.protocol !== "https:" &&
          !["localhost", "127.0.0.1"].includes(publicUrl.hostname),
        503,
        "第三方登录需要 HTTPS 公共地址",
      );
      const callback = new URL(
          `/api/auth/oauth/${provider}/callback`,
          publicUrl,
        ).href,
        clientId = process.env[`${provider.toUpperCase()}_CLIENT_ID`],
        secret = process.env[`${provider.toUpperCase()}_CLIENT_SECRET`];
      if (action === "start") {
        sec.limit(`oauth-start:${req.clientIp}`, 30, 600000);
        const user =
          url.searchParams.get("intent") === "link" ? sec.current(req) : null;
        const state = randomToken();
        db.prepare("INSERT INTO oauth_states VALUES(?,?,?,?,?)").run(
          hashToken(state),
          provider,
          user?.id || null,
          setBinding(res),
          Date.now() + 600000,
        );
        const auth = new URL(
          provider === "qq"
            ? "https://graph.qq.com/oauth2.0/authorize"
            : "https://open.weixin.qq.com/connect/qrconnect",
        );
        auth.search = new URLSearchParams({
          response_type: "code",
          [provider === "qq" ? "client_id" : "appid"]: clientId,
          redirect_uri: callback,
          scope: provider === "qq" ? "get_user_info" : "snsapi_login",
          state,
        }).toString();
        if (provider === "wechat") auth.hash = "wechat_redirect";
        redirect(res, auth.href);
        return true;
      }
      const state = url.searchParams.get("state") || "",
        code = url.searchParams.get("code") || "";
      fail(
        !/^[a-f0-9]{64}$/.test(state) || !code || code.length > 1024,
        400,
        "授权回调无效",
      );
      const saved = tx(db, () => {
        const row = db
          .prepare("SELECT * FROM oauth_states WHERE id=? AND provider=?")
          .get(hashToken(state), provider);
        fail(
          !row ||
            row.expires < Date.now() ||
            row.binding !== hashToken(binding(req)),
          400,
          "授权状态已过期或不属于当前浏览器",
        );
        if (row.user_id)
          fail(
            sec.session(req)?.id !== row.user_id,
            403,
            "绑定期间账号发生变化，请重新开始",
          );
        db.prepare("DELETE FROM oauth_states WHERE id=?").run(row.id);
        return row;
      });
      const tokenUrl = new URL(
        provider === "qq"
          ? "https://graph.qq.com/oauth2.0/token"
          : "https://api.weixin.qq.com/sns/oauth2/access_token",
      );
      tokenUrl.search = new URLSearchParams(
        provider === "qq"
          ? {
              grant_type: "authorization_code",
              client_id: clientId,
              client_secret: secret,
              redirect_uri: callback,
              code,
              fmt: "json",
              need_openid: "1",
            }
          : { appid: clientId, secret, code, grant_type: "authorization_code" },
      ).toString();
      let token;
      try {
        const response = await (options.oauthFetch || fetch)(tokenUrl, {
          signal: AbortSignal.timeout(10000),
        });
        fail(!response.ok, 503, "授权服务暂不可用");
        token = await response.json();
      } catch {
        fail(true, 503, "授权服务暂不可用，请重新发起登录");
      }
      fail(
        token.error ||
          token.errcode ||
          typeof token.openid !== "string" ||
          !token.openid ||
          token.openid.length > 200 ||
          !token.access_token,
        400,
        "第三方授权失败，请重新登录",
      );
      const result = tx(db, () => {
        const identity = db
          .prepare(
            "SELECT user_id FROM external_identities WHERE provider=? AND subject=?",
          )
          .get(provider, token.openid);
        if (saved.user_id) {
          const user = sec.current(req);
          fail(!user || user.id !== saved.user_id, 403, "登录状态已变化");
          fail(
            identity && identity.user_id !== user.id,
            409,
            "该第三方账号已绑定其他用户",
          );
          fail(
            db
              .prepare(
                "SELECT subject FROM external_identities WHERE provider=? AND user_id=? AND subject<>?",
              )
              .get(provider, user.id, token.openid),
            409,
            "请先解除当前绑定",
          );
          db.prepare(
            "INSERT OR IGNORE INTO external_identities VALUES(?,?,?)",
          ).run(provider, token.openid, user.id);
          sec.audit(user.id, "account.oauth_linked", provider);
          return { linked: true };
        }
        if (!identity) return registration.issue(req, provider, token.openid);
        const user = db
          .prepare("SELECT * FROM users WHERE id=? AND disabled=0")
          .get(identity.user_id);
        fail(!user, 403, "账号不可用");
        // Admins always retain password + TOTP; external identity alone grants no admin session.
        fail(user.role === "admin", 403, "管理员请使用密码和两步验证登录");
        sec.audit(user.id, "account.oauth_login", provider);
        if (mfa.enabled(user.id))
          return { challenge: mfa.challenge(req, res, user).challenge };
        sec.start(req, res, user);
        return { linked: false };
      });
      if (result.registrationRequired) renewBinding(req, res);
      redirect(
        res,
        new URL(
          result.registrationRequired
            ? `/#signup=${result.proof}`
            : result.challenge
              ? `/#mfa=${result.challenge}`
              : result.linked
                ? "/#oauth=linked"
                : "/#oauth=login",
          publicUrl,
        ).href,
      );
      return true;
    }
    return false;
  };
}
