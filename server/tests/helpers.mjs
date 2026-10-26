import { createApp } from "../app.mjs";
import { listenHttp } from "./http-listen.mjs";
import { randomUUID } from "node:crypto";
export const PASSWORD = "ConcurrentAccount123!";
export const ADMIN = { email: "root@test.local", password: PASSWORD };
export const TODAY = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=";
export const booking = (extra = {}) => ({
  company: "并发测试企业",
  contact: "张老师",
  phone: "13800138000",
  builder_contact: "搭建负责人",
  builder_phone: "13900139000",
  slot: 1,
  start: TODAY(),
  end: TODAY(),
  image: IMAGE,
  ...extra,
});
export function client(origin) {
  const cookies = new Map();
  let csrf = "";
  return {
    origin,
    get headers() {
      return {
        Origin: origin,
        Cookie: [...cookies].map(([k, v]) => k + "=" + v).join("; "),
        "X-CSRF-Token": csrf,
      };
    },
    async request(route, method = "GET", body, headers = {}) {
      if (
        ["/auth/login", "/auth/register"].includes(route) &&
        body &&
        !Object.hasOwn(body, "captchaId")
      ) {
        const challenge = await this.request("/auth/captcha");
        body = { ...body, captchaId: challenge.data.id, captcha: "246789" };
      }
      const res = await fetch(origin + "/api" + route, {
        method,
        headers: {
          ...this.headers,
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      for (const cookie of res.headers.getSetCookie()) {
        const part = cookie.split(";")[0],
          i = part.indexOf("=");
        cookies.set(part.slice(0, i), part.slice(i + 1));
      }
      const data = await res.json();
      if (data.csrf) csrf = data.csrf;
      return { status: res.status, data };
    },
  };
}
export async function fixture(t, dbPath = ":memory:", options = {}) {
  const app = await createApp({
    dbPath,
    admin: ADMIN,
    captchaTestAnswer: "246789",
    maintenance: { scheduled: false },
    ...options,
  });
  t.after(() => app.close());
  await listenHttp(app.server);
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  return { ...app, origin, client: () => client(origin) };
}
export async function register(c, email = "enterprise@test.local") {
  const r = await c.request("/auth/register", "POST", {
    email,
    password: PASSWORD,
    company: "并发测试企业",
    contact: "张老师",
    phone: "13800138000",
  });
  if (r.status !== 201) throw new Error(JSON.stringify(r));
  return r.data.user;
}
// Explicit persisted pre-content-review fixture. Production requests always use
// content_only=1; legacy finance/phone workflows are exercised on historical rows.
export async function seedLegacyBooking(f, owner, extra = {}) {
  const user = (await owner.request("/auth/session")).data.user;
  const row = booking(extra),
    id = `LEGACY-${randomUUID()}`;
  f.db
    .prepare(
      "INSERT INTO bookings(id,user_id,company,contact,phone,builder_contact,builder_phone,start,end,slot,status,image,image_type,created) VALUES(?,?,?,?,?,?,?,?,?,?,'待审核',?,'image/png',?)",
    )
    .run(
      id,
      user.id,
      row.company,
      row.contact,
      row.phone,
      row.builder_contact,
      row.builder_phone,
      row.start,
      row.end,
      row.slot,
      Buffer.from(IMAGE.split(",")[1], "base64"),
      new Date().toISOString(),
    );
  return { status: 201, data: { id } };
}
export async function manager(c) {
  const r = await c.request("/auth/login", "POST", ADMIN);
  if (r.status !== 200) throw new Error(JSON.stringify(r));
  return r.data.user;
}
export async function staff(root, c, permissions, email = "staff@test.local") {
  const made = await root.request("/access/staff", "POST", {
    email,
    contact: "工作人员",
    permissions,
    currentPassword: PASSWORD,
  });
  if (made.status !== 201) throw new Error(JSON.stringify(made));
  await c.request("/auth/login", "POST", {
    email,
    password: made.data.temporaryPassword,
  });
  const changed = await c.request("/auth/password", "POST", {
    currentPassword: made.data.temporaryPassword,
    newPassword: PASSWORD,
  });
  if (changed.status !== 200) throw new Error(JSON.stringify(changed));
  await c.request("/auth/login", "POST", { email, password: PASSWORD });
  return (await c.request("/auth/session")).data.user;
}
