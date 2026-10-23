import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "./store.mjs";
import { hashPassword, passwordValid } from "./security.mjs";
import { createApi } from "./api.mjs";
import { createMaintenance } from "./maintenance.mjs";
import { clientAddress } from "./proxy.mjs";
import { createDelivery } from "./delivery.mjs";
import {
  createSecurity,
  fail,
  HttpError,
  tx,
  databaseError,
  now,
} from "./core.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export async function createApp(options = {}) {
  const dbPath =
    options.dbPath || process.env.DB_PATH || path.join(ROOT, "data/app.sqlite");
  const db = openStore(dbPath);
  try {
    const maintenance = createMaintenance(db, dbPath, options.maintenance);
    const trusted = (
      options.trustedProxies ??
      process.env.TRUSTED_PROXY_IPS ??
      ""
    )
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    const secure =
      options.secureCookies ?? process.env.COOKIE_SECURE === "true";
    const origins = (options.allowedOrigins || process.env.PUBLIC_ORIGIN || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    const admin =
      options.admin ||
      (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD
        ? {
            email: process.env.ADMIN_EMAIL,
            password: process.env.ADMIN_PASSWORD,
          }
        : null);
    if (admin) {
      const email = admin.email.trim().toLowerCase();
      fail(
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          !passwordValid(admin.password) ||
          admin.password.includes("REPLACE_"),
        400,
        "请配置有效的管理员邮箱和独立强密码",
      );
      const hashed = await hashPassword(admin.password);
      tx(db, () => {
        const old = db.prepare("SELECT * FROM users WHERE email=?").get(email);
        fail(
          old && old.role !== "admin",
          409,
          "该邮箱已注册为企业账号，不能通过配置自动提升权限",
        );
        if (!old) {
          const id = randomUUID();
          db.prepare(
            "INSERT INTO users(id,email,password_hash,role,company,contact,phone,created,is_super) VALUES(?,?,?,'admin','大学生活动中心','管理员','',?,1)",
          ).run(id, email, hashed, now());
          db.prepare(
            "INSERT INTO audit(actor,action,target,created) VALUES(?,?,?,?)",
          ).run(id, "account.admin_created", id, now());
        }
      });
    }
    const api = await createApi(db, {
        secureCookies: secure,
        captchaTestAnswer: options.captchaTestAnswer,
        maintenance,
        dbPath,
        integrations: options.integrations,
      }),
      security = createSecurity(db, secure);
    const handlers = new Set();
    const server = createServer(async (req, res) => {
      let finish;
      const finished = new Promise((resolve) => (finish = resolve));
      handlers.add(finished);
      const requestId = randomUUID();
      let requestPath = "<invalid>";
      try {
        res.setHeader("X-Request-ID", requestId);
        req.clientIp = clientAddress(req, trusted);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "same-origin");
        res.setHeader("X-Frame-Options", "DENY");
        let url;
        try {
          url = new URL(req.url, "http://localhost");
        } catch {
          throw new HttpError(400, "请求地址无效");
        }
        const p = (requestPath = url.pathname);
        if (p.startsWith("/api/")) {
          res.setHeader("Cache-Control", "no-store");
          const origin = req.headers.origin,
            allowed = [
              `http://${req.headers.host}`,
              `https://${req.headers.host}`,
              ...origins,
            ];
          fail(origin && !allowed.includes(origin), 403, "请求来源不被允许");
          if (origin && origins.includes(origin)) {
            res.setHeader("Access-Control-Allow-Origin", origin);
            res.setHeader("Access-Control-Allow-Credentials", "true");
            res.setHeader("Vary", "Origin");
          }
          if (req.method === "OPTIONS") {
            res.setHeader(
              "Access-Control-Allow-Headers",
              "Content-Type, X-CSRF-Token, Idempotency-Key, If-Match",
            );
            res.setHeader(
              "Access-Control-Allow-Methods",
              "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            );
            res.writeHead(204).end();
            return;
          }
          if (!["GET", "HEAD"].includes(req.method)) {
            fail(!origin, 403, "缺少请求来源");
            const u = security.session(req);
            if (u)
              fail(
                req.headers["x-csrf-token"] !== u.csrf,
                403,
                "安全校验失败，请刷新后重试",
              );
            security.limit(
              u ? `writes-user:${u.id}` : `writes-ip:${req.clientIp}`,
              120,
              60000,
            );
          }
          await api(req, res, url);
          return;
        }
        fail(!["GET", "HEAD"].includes(req.method), 405, "不支持的请求方法");
        const staticDir = options.staticDir || path.join(ROOT, "dist");
        let pathname;
        try {
          pathname = decodeURIComponent(p);
        } catch {
          throw new HttpError(400, "路径无效");
        }
        const file = path.resolve(
          staticDir,
          pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""),
        );
        fail(
          !file.startsWith(path.resolve(staticDir) + path.sep),
          403,
          "无权访问",
        );
        const ext = path.extname(file),
          types = {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".png": "image/png",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
            ".woff2": "font/woff2",
            ".txt": "text/plain; charset=utf-8",
          };
        fail(!types[ext], 404, "文件不存在");
        let bytes;
        try {
          fail(!(await stat(file)).isFile(), 404, "文件不存在");
          bytes = await readFile(file);
        } catch {
          throw new HttpError(404, "文件不存在，请先运行 npm run build");
        }
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
        );
        res.writeHead(200, {
          "Content-Type": types[ext],
          "Cache-Control":
            ext === ".html"
              ? "no-cache"
              : "public, max-age=31536000, immutable",
        });
        res.end(req.method === "HEAD" ? undefined : bytes);
      } catch (original) {
        const error = databaseError(original);
        if (error.status === 403 && requestPath.startsWith("/api/")) {
          try {
            const actor = security.session(req);
            if (actor) {
              security.limit(`denied-audit:${actor.id}`, 10, 60000);
              security.audit(actor.id, "access.denied", requestPath);
            }
          } catch {
            /* Preserve the original authorization failure. */
          }
        }
        if (!error.status)
          console.error(
            JSON.stringify({
              event: "request.failed",
              requestId,
              method: req.method,
              path: requestPath,
              error: String(error.message),
            }),
          );
        if (error.status === 503) res.setHeader("Retry-After", "1");
        if (!res.headersSent) {
          res.writeHead(error.status || 500, {
            "Content-Type": "application/json; charset=utf-8",
          });
          res.end(
            JSON.stringify({
              error: error.status
                ? error.message
                : "服务暂时不可用，请稍后重试",
            }),
          );
        } else res.end();
      } finally {
        handlers.delete(finished);
        finish();
      }
    });
    server.requestTimeout = 30000;
    server.headersTimeout = 15000;
    const delivery = createDelivery(db, maintenance, {
      ...options.integrations,
      scheduled: options.maintenance?.scheduled,
    });
    maintenance.start();
    delivery.start();
    let closing;
    return {
      server,
      db,
      maintenance,
      delivery,
      close: () => {
        if (!closing) {
          // Stop accepting connections immediately. Active requests may still
          // use the database or enqueue work, so drain them before the workers.
          const httpClosed = new Promise((resolve, reject) => {
            server.close((error) => {
              if (error && error.code !== "ERR_SERVER_NOT_RUNNING")
                reject(error);
              else resolve();
            });
          });
          closing = (async () => {
            await httpClosed;
            // A disconnected client can leave its async handler running after
            // server.close resolves. Its database work must finish as well.
            await Promise.all(handlers);
            await delivery.close();
            await maintenance.close();
            db.close();
          })();
        }
        return closing;
      },
    };
  } catch (e) {
    db.close();
    throw e;
  }
}
