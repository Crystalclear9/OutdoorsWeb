import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  fixture,
  register,
  manager,
  booking,
  PASSWORD,
  ADMIN,
  TODAY,
} from "./helpers.mjs";
import { totp } from "../mfa.mjs";
import { archiveHistory, archivedImage } from "../business.mjs";
import { encryptBackup, restoreEncrypted, uploadOffsite } from "../offsite.mjs";
import { DatabaseSync } from "node:sqlite";
import { createDelivery, alertExternal } from "../delivery.mjs";

const version = (n) => ({ "If-Match": `"${n}"` });
const future = (n) => {
  const d = new Date(TODAY() + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

test("游客场地数据区分未登记、未摆放与已摆放，且不公开现场备注或操作者", async (t) => {
  const f = await fixture(t),
    root = f.client(),
    guest = f.client();
  await manager(root);
  assert.deepEqual((await guest.request("/venue")).data.onsite, []);
  const saved = await root.request("/onsite", "POST", {
    date: TODAY(),
    items: [
      { slot: 1, present: false, version: 0, note: "内部现场记录13900139000" },
      { slot: 2, present: true, version: 0, note: "内部现场备注" },
    ],
  });
  assert.equal(saved.status, 200);
  const result = (await guest.request("/venue")).data;
  assert.equal(result.actualPlaced, 1);
  assert.equal(result.occupied.length, 0);
  assert.deepEqual(
    result.onsite.map(({ slot, present }) => ({ slot, present })),
    [
      { slot: 1, present: false },
      { slot: 2, present: true },
    ],
  );
  assert.deepEqual(Object.keys(result.onsite[0]).sort(), [
    "present",
    "slot",
    "updated",
  ]);
  assert.equal(JSON.stringify(result).includes("内部"), false);
  assert.equal(JSON.stringify(result).includes("13900139000"), false);
  assert.equal((await guest.request("/onsite")).status, 401);
  assert.deepEqual(
    (await guest.request(`/venue?date=${future(1)}`)).data.onsite,
    [],
  );
});

test("现场登记与批准数独立，权限隔离、批量原子更新和并发版本保护", async (t) => {
  const f = await fixture(t),
    root = f.client(),
    other = f.client(),
    enterprise = f.client();
  await manager(root);
  await manager(other);
  await register(enterprise);
  assert.equal((await enterprise.request("/onsite")).status, 403);
  assert.equal(
    (
      await root.request("/onsite", "POST", {
        date: future(-1),
        items: [{ slot: 1, present: true, version: 0 }],
      })
    ).status,
    400,
  );
  const results = await Promise.all(
    [root, other].map((c) =>
      c.request("/onsite", "POST", {
        date: TODAY(),
        items: [{ slot: 1, present: true, version: 0 }],
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const state = await enterprise.request(`/venue?date=${TODAY()}`);
  assert.equal(state.data.actualPlaced, 1);
  assert.equal(state.data.occupied.length, 0);
  assert.equal(JSON.stringify(state.data).includes("actor"), false);
  assert.equal(
    (
      await root.request("/onsite", "POST", {
        date: TODAY(),
        items: [
          { slot: 2, present: true, version: 0 },
          { slot: 1, present: false, version: 0 },
        ],
      })
    ).status,
    409,
  );
  assert.equal((await root.request("/onsite")).data.items.length, 1);
});

test("改期审批保留原位、退回不影响原预约，并发批准原子替换", async (t) => {
  const f = await fixture(t),
    owner = f.client(),
    root = f.client(),
    second = f.client();
  await register(owner);
  await manager(root);
  await manager(second);
  const original = (
    await owner.request(
      "/bookings",
      "POST",
      booking({ start: future(10), end: future(11) }),
    )
  ).data.id;
  assert.equal(
    (
      await root.request(
        `/bookings/${original}/review`,
        "POST",
        { status: "已通过", reason: "" },
        version(1),
      )
    ).status,
    200,
  );
  const request = () =>
    owner.request(
      `/bookings/${original}/reschedule`,
      "POST",
      { slot: 1, start: future(11), end: future(12) },
      version(2),
    );
  const queued = await Promise.all([request(), request()]);
  assert.deepEqual(queued.map((r) => r.status).sort(), [201, 409]);
  let id = queued.find((r) => r.status === 201).data.id;
  assert.equal(
    (await root.request(`/bookings/${id}`)).data.booking.reviewCheck.blockers
      .length,
    0,
  );
  assert.equal(
    (await owner.request(`/bookings/${original}`)).data.booking.status,
    "已通过",
  );
  await root.request(
    `/bookings/${id}/review`,
    "POST",
    { status: "未通过", reason: "请调整日期" },
    version(1),
  );
  assert.equal(
    (await owner.request(`/bookings/${original}`)).data.booking.status,
    "已通过",
  );
  id = (await request()).data.id;
  const approval = await Promise.all(
    [root, second].map((c) =>
      c.request(
        `/bookings/${id}/review`,
        "POST",
        { status: "已通过", reason: "" },
        version(1),
      ),
    ),
  );
  assert.deepEqual(approval.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (await owner.request(`/bookings/${original}`)).data.booking.status,
    "已取消",
  );
  assert.equal(
    (await owner.request(`/bookings/${id}`)).data.booking.status,
    "已通过",
  );
  assert.equal(
    (await owner.request(`/venue?date=${future(10)}`)).data.occupied.length,
    0,
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM audit WHERE action='booking.rescheduled'",
      )
      .get().n,
    1,
  );
  const child = (
    await owner.request(
      `/bookings/${id}/reschedule`,
      "POST",
      { start: future(12), end: future(13) },
      version(2),
    )
  ).data.id;
  await owner.request(
    `/bookings/${id}/cancel`,
    "POST",
    { reason: "活动取消" },
    version(2),
  );
  assert.equal(
    (await owner.request(`/bookings/${child}`)).data.booking.status,
    "已撤回",
  );
});

test("图片完整解码拒绝截断和超像素文件，持久化图像移除元数据", async (t) => {
  const f = await fixture(t),
    c = f.client();
  await register(c);
  const valid = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "green" },
  })
    .withMetadata()
    .png()
    .toBuffer();
  const truncated = valid.subarray(0, Math.floor(valid.length / 2));
  assert.equal(
    (
      await c.request(
        "/bookings",
        "POST",
        booking({
          image: `data:image/png;base64,${truncated.toString("base64")}`,
        }),
      )
    ).status,
    400,
  );
  const huge = await sharp({
    create: { width: 5000, height: 4100, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  assert.equal(
    (
      await c.request(
        "/bookings",
        "POST",
        booking({ image: `data:image/png;base64,${huge.toString("base64")}` }),
      )
    ).status,
    400,
  );
  const accepted = await c.request(
    "/bookings",
    "POST",
    booking({ image: `data:image/png;base64,${valid.toString("base64")}` }),
  );
  assert.equal(accepted.status, 201);
  const stored = f.db
    .prepare("SELECT image,image_type FROM bookings WHERE id=?")
    .get(accepted.data.id);
  assert.equal(stored.image_type, "image/webp");
  assert.equal((await sharp(stored.image).metadata()).exif, undefined);
});

test("TOTP符合RFC向量；两步验证挑战不授予会话、绑定浏览器、禁止重放，恢复码一次有效", async (t) => {
  assert.equal(totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1), "287082");
  const f = await fixture(t),
    root = f.client();
  await manager(root);
  const setup = await root.request("/auth/mfa/setup", "POST", {
    currentPassword: PASSWORD,
  });
  assert.equal(setup.status, 200);
  assert.match(setup.data.qr, /^data:image\/png/);
  assert.equal(
    f.db
      .prepare("SELECT secret FROM mfa")
      .get()
      .secret.includes(setup.data.secret),
    false,
  );
  const enabled = await root.request("/auth/mfa/enable", "POST", {
    code: totp(setup.data.secret),
  });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.data.codes.length, 10);
  const other = f.client(),
    intruder = f.client(),
    login = await other.request("/auth/login", "POST", ADMIN);
  assert.equal(login.data.mfaRequired, true);
  assert.equal(login.data.user, undefined);
  assert.equal((await other.request("/summary")).status, 401);
  assert.equal(
    (
      await intruder.request("/auth/mfa/login", "POST", {
        challenge: login.data.challenge,
        code: enabled.data.codes[0],
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await other.request("/auth/mfa/login", "POST", {
        challenge: login.data.challenge,
        code: totp(setup.data.secret),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await other.request("/auth/mfa/login", "POST", {
        challenge: login.data.challenge,
        code: enabled.data.codes[0],
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await other.request("/auth/mfa/login", "POST", {
        challenge: login.data.challenge,
        code: enabled.data.codes[1],
      })
    ).status,
    401,
  );
  assert.equal((await root.request("/auth/mfa")).data.recoveryRemaining, 9);
  const third = f.client(),
    challenge = (await third.request("/auth/login", "POST", ADMIN)).data
      .challenge;
  assert.equal(
    (
      await third.request("/auth/mfa/login", "POST", {
        challenge,
        code: enabled.data.codes[0],
      })
    ).status,
    401,
  );
});

test("业务图片和历史审计完整归档，原图片权限与读取继续有效", async (t) => {
  const f = await fixture(t),
    owner = f.client(),
    stranger = f.client(),
    root = f.client();
  const user = await register(owner);
  await register(stranger, "stranger@test.local");
  await manager(root);
  const live = (await owner.request("/bookings", "POST", booking())).data.id;
  f.db
    .prepare(
      "INSERT INTO bookings(id,user_id,company,contact,phone,start,end,slot,status,image,image_type,created) SELECT 'historic',user_id,company,contact,phone,'2000-01-01','2000-01-01',2,'未通过',image,image_type,'2000-01-01T00:00:00Z' FROM bookings WHERE id=?",
    )
    .run(live);
  f.db
    .prepare(
      "INSERT INTO audit(actor,action,target,created) VALUES(?,'history.test','historic','2000-01-01T00:00:00Z')",
    )
    .run(user.id);
  const original = Buffer.from(
    f.db.prepare("SELECT image FROM bookings WHERE id='historic'").get().image,
  );
  const result = archiveHistory(f.db);
  assert.equal(result.images, 1);
  assert.equal(result.audits, 1);
  assert.deepEqual(archivedImage(f.db, "historic"), original);
  assert.equal(
    f.db
      .prepare("SELECT length(image) n FROM bookings WHERE id='historic'")
      .get().n,
    0,
  );
  const response = await fetch(f.origin + "/api/bookings/historic/image", {
    headers: owner.headers,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), original);
  assert.equal(
    (
      await fetch(f.origin + "/api/bookings/historic/image", {
        headers: stranger.headers,
      })
    ).status,
    403,
  );
  assert.equal((await stranger.request("/archives")).status, 403);
  const archive = (await root.request("/archives")).data.items[0];
  const download = await fetch(f.origin + `/api/archives/${archive.id}`, {
    headers: root.headers,
  });
  assert.match(await download.text(), /history\.test/);
});

test("加密异机备份包含MFA密钥，可恢复；错误密钥或篡改备份不会产生可用数据库", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "outdoors-encrypted-")),
    source = path.join(dir, "source.sqlite");
  const db = new DatabaseSync(source);
  db.exec(
    "CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES('restored');",
  );
  db.close();
  const previous = process.env.BACKUP_ENCRYPTION_KEY;
  process.env.BACKUP_ENCRYPTION_KEY = "ab".repeat(32);
  t.after(() => {
    if (previous === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
    else process.env.BACKUP_ENCRYPTION_KEY = previous;
  });
  const encrypted = path.join(dir, "backup.enc"),
    key = Buffer.alloc(32, 42);
  await encryptBackup(source, encrypted, key);
  const targetDir = path.join(dir, "restored");
  await mkdir(targetDir);
  const target = path.join(targetDir, "app.sqlite");
  const otherRestore = target + ".restore.part";
  await writeFile(otherRestore, "another restore owns this temporary file");
  await restoreEncrypted(encrypted, target);
  assert.equal(
    await readFile(otherRestore, "utf8"),
    "another restore owns this temporary file",
  );
  const check = new DatabaseSync(target, { readOnly: true });
  assert.equal(
    check.prepare("SELECT value FROM proof").get().value,
    "restored",
  );
  check.close();
  assert.deepEqual(await readFile(path.join(targetDir, ".mfa-key")), key);
  await assert.rejects(restoreEncrypted(encrypted, target));
  assert.equal(
    await readFile(otherRestore, "utf8"),
    "another restore owns this temporary file",
  );
  const corrupted = Buffer.from(await readFile(encrypted));
  corrupted[40] ^= 1;
  await writeFile(path.join(dir, "corrupted.enc"), corrupted);
  await assert.rejects(
    restoreEncrypted(
      path.join(dir, "corrupted.enc"),
      path.join(dir, "bad.sqlite"),
    ),
  );
});

test("短信绑定需要密码与浏览器验证码，发送限流且验证码只可消费一次", async (t) => {
  const messages = [],
    f = await fixture(t, ":memory:", {
      integrations: {
        sendPhone: async (kind, phone, message) => {
          messages.push({ kind, phone, message });
          return "provider-id";
        },
      },
    });
  const owner = f.client();
  await register(owner);
  const captcha = (await owner.request("/auth/captcha")).data;
  const sent = await owner.request("/auth/sms/send", "POST", {
    phone: "13800138000",
    purpose: "link",
    captchaId: captcha.id,
    captcha: "246789",
  });
  assert.equal(sent.status, 200);
  assert.equal(messages.length, 1);
  const code = messages[0].message.match(/\d{6}/)[0];
  assert.equal(
    (
      await owner.request("/auth/sms/verify", "POST", {
        id: sent.data.id,
        code,
        currentPassword: "wrong",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await owner.request("/auth/sms/verify", "POST", {
        id: sent.data.id,
        code,
        currentPassword: PASSWORD,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await owner.request("/auth/sms/verify", "POST", {
        id: sent.data.id,
        code,
        currentPassword: PASSWORD,
      })
    ).status,
    400,
  );
  assert.equal(
    (await owner.request("/auth/identities")).data.phone,
    "13800138000",
  );
  const next = (await owner.request("/auth/captcha")).data;
  assert.equal(
    (
      await owner.request("/auth/sms/send", "POST", {
        phone: "13800138000",
        purpose: "login",
        captchaId: next.id,
        captcha: "246789",
      })
    ).status,
    429,
  );
  f.db
    .prepare(
      "UPDATE rate_limits SET reset=0 WHERE key='sms-phone-minute:13800138000'",
    )
    .run();
  const browser = f.client(),
    loginCaptcha = (await browser.request("/auth/captcha")).data;
  const loginCode = await browser.request("/auth/sms/send", "POST", {
    phone: "13800138000",
    purpose: "login",
    captchaId: loginCaptcha.id,
    captcha: "246789",
  });
  assert.equal(loginCode.status, 200);
  const proof = messages.at(-1).message.match(/\d{6}/)[0];
  const signedIn = await browser.request("/auth/sms/verify", "POST", {
    id: loginCode.data.id,
    code: proof,
  });
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.data.user.email, "enterprise@test.local");
  assert.equal(
    (
      await browser.request("/auth/sms/verify", "POST", {
        id: loginCode.data.id,
        code: proof,
      })
    ).status,
    400,
  );
});

test("QQ授权状态绑定浏览器、单次消费，只绑定本人账号且登录后重新验证权限", async (t) => {
  const names = ["PUBLIC_URL", "QQ_CLIENT_ID", "QQ_CLIENT_SECRET"],
    previous = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  t.after(() => {
    for (const n of names) {
      if (previous[n] === undefined) delete process.env[n];
      else process.env[n] = previous[n];
    }
  });
  process.env.QQ_CLIENT_ID = "test-app";
  process.env.QQ_CLIENT_SECRET = "test-secret";
  const f = await fixture(t, ":memory:", {
    integrations: {
      oauthFetch: async () =>
        new Response(
          JSON.stringify({
            openid: "verified-provider-subject",
            access_token: "server-only-token",
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    },
  });
  process.env.PUBLIC_URL = f.origin;
  const owner = f.client();
  await register(owner);
  const start = await fetch(f.origin + "/api/auth/oauth/qq/start?intent=link", {
    headers: owner.headers,
    redirect: "manual",
  });
  assert.equal(start.status, 303);
  const state = new URL(start.headers.get("location")).searchParams.get(
      "state",
    ),
    bindCookie = start.headers.getSetCookie()[0].split(";")[0],
    callback =
      f.origin +
      `/api/auth/oauth/qq/callback?state=${state}&code=provider-code`;
  assert.equal(
    (await fetch(callback, { headers: owner.headers, redirect: "manual" }))
      .status,
    400,
  );
  const bound = await fetch(callback, {
    headers: {
      ...owner.headers,
      Cookie: owner.headers.Cookie + "; " + bindCookie,
    },
    redirect: "manual",
  });
  assert.equal(bound.status, 303);
  assert.equal(
    (await owner.request("/auth/identities")).data.providers[0],
    "qq",
  );
  assert.equal(
    (
      await fetch(callback, {
        headers: {
          ...owner.headers,
          Cookie: owner.headers.Cookie + "; " + bindCookie,
        },
        redirect: "manual",
      })
    ).status,
    400,
  );
  const fresh = await fetch(f.origin + "/api/auth/oauth/qq/start", {
      redirect: "manual",
    }),
    freshState = new URL(fresh.headers.get("location")).searchParams.get(
      "state",
    ),
    freshCookie = fresh.headers.getSetCookie()[0].split(";")[0];
  const logged = await fetch(
    f.origin +
      `/api/auth/oauth/qq/callback?state=${freshState}&code=other-code`,
    { headers: { Cookie: freshCookie }, redirect: "manual" },
  );
  assert.equal(logged.status, 303);
  assert.ok(
    logged.headers.getSetCookie().some((c) => c.startsWith("hust_session=")),
  );
  const setup = (
    await owner.request("/auth/mfa/setup", "POST", {
      currentPassword: PASSWORD,
    })
  ).data;
  const recovery = (
    await owner.request("/auth/mfa/enable", "POST", {
      code: totp(setup.secret),
    })
  ).data.codes[0];
  const gatedStart = await fetch(f.origin + "/api/auth/oauth/qq/start", {
    redirect: "manual",
  });
  const gatedState = new URL(
    gatedStart.headers.get("location"),
  ).searchParams.get("state");
  const gated = await fetch(
    f.origin + `/api/auth/oauth/qq/callback?state=${gatedState}&code=mfa-code`,
    {
      headers: { Cookie: gatedStart.headers.getSetCookie()[0].split(";")[0] },
      redirect: "manual",
    },
  );
  assert.match(gated.headers.get("location"), /#mfa=[a-f0-9]{64}$/);
  assert.equal(
    gated.headers.getSetCookie().some((c) => c.startsWith("hust_session=")),
    false,
  );
  const verified = await fetch(f.origin + "/api/auth/mfa/login", {
    method: "POST",
    headers: {
      Origin: f.origin,
      Cookie: gated.headers.getSetCookie()[0].split(";")[0],
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      challenge: new URL(gated.headers.get("location")).hash.slice(5),
      code: recovery,
    }),
  });
  assert.equal(verified.status, 200);
});

test("通知队列持久化受理结果，网络不确定不重复呼叫，管理员可核实关闭任务", async (t) => {
  const f = await fixture(t),
    owner = f.client(),
    root = f.client();
  const user = await register(owner);
  await manager(root);
  const queuedBooking = (await owner.request("/bookings", "POST", booking()))
    .data.id;
  assert.equal(
    (
      await root.request(
        `/bookings/${queuedBooking}/review`,
        "POST",
        { status: "已通过", reason: "" },
        version(1),
      )
    ).status,
    200,
  );
  f.db
    .prepare("INSERT INTO verified_phones VALUES('13800138000',?)")
    .run(user.id);
  f.db.prepare("INSERT INTO contact_preferences VALUES(?,1,1)").run(user.id);
  for (const id of ["accepted-job", "uncertain-job"])
    f.db
      .prepare(
        "INSERT INTO delivery_jobs(id,kind,payload,next_at,created) VALUES(?,'voice',?,0,?)",
      )
      .run(
        id,
        JSON.stringify({
          userId: user.id,
          phone: "13800138000",
          message: "审批结果",
          bookingId: queuedBooking,
        }),
        nowString(),
      );
  let sends = 0;
  const delivery = createDelivery(f.db, f.maintenance, {
    scheduled: false,
    sendPhone: async () => {
      if (++sends === 2) throw new Error("network timeout");
      return "provider-id";
    },
  });
  await delivery.run();
  await delivery.run();
  assert.equal(sends, 2);
  assert.equal(
    f.db
      .prepare("SELECT state FROM delivery_jobs WHERE id='accepted-job'")
      .get().state,
    "accepted",
  );
  const pending = (
    await root.request("/operations/deliveries")
  ).data.items.find((i) => i.id === "uncertain-job");
  assert.equal(pending.state, "uncertain");
  assert.equal(pending.phone, "138****8000");
  assert.equal((await owner.request("/operations/deliveries")).status, 403);
  assert.equal(
    (
      await root.request("/operations/deliveries/uncertain-job", "POST", {
        action: "retry",
        version: pending.version,
        reason: "未核实",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await root.request("/operations/deliveries/uncertain-job", "POST", {
        action: "accepted",
        version: pending.version,
        reason: "服务商后台已受理",
      })
    ).status,
    200,
  );
  await delivery.close();
});
const nowString = () => new Date().toISOString();

test("S3协议上传后回读验证密文，外部告警失败可见、成功签名且抑制重复告警", async (t) => {
  const names = [
      "BACKUP_ENCRYPTION_KEY",
      "APP_ENCRYPTION_KEY",
      "S3_BACKUP_BUCKET",
      "ALERT_WEBHOOK_URL",
      "ALERT_WEBHOOK_SECRET",
    ],
    previous = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  t.after(() => {
    for (const n of names) {
      if (previous[n] === undefined) delete process.env[n];
      else process.env[n] = previous[n];
    }
  });
  process.env.BACKUP_ENCRYPTION_KEY = "cd".repeat(32);
  process.env.APP_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.S3_BACKUP_BUCKET = "private-test";
  process.env.ALERT_WEBHOOK_URL = "https://alerts.example.test/webhook";
  process.env.ALERT_WEBHOOK_SECRET = "test-signing-secret";
  const dir = await mkdtemp(path.join(os.tmpdir(), "outdoors-s3-contract-")),
    source = path.join(dir, "snapshot.sqlite");
  const snapshot = new DatabaseSync(source);
  snapshot.exec(
    "CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES('test snapshot payload')",
  );
  snapshot.close();
  let uploaded, metadata;
  const client = {
    async send(command) {
      const c = command.constructor.name;
      if (c === "PutObjectCommand") {
        const chunks = [];
        for await (const b of command.input.Body) chunks.push(b);
        uploaded = Buffer.concat(chunks);
        metadata = command.input.Metadata;
        return {};
      }
      if (c === "HeadObjectCommand")
        return { ContentLength: uploaded.length, Metadata: metadata };
      return {
        Body: (async function* () {
          yield uploaded;
        })(),
      };
    },
  };
  assert.equal((await uploadOffsite(source, source, client)).verified, true);
  assert.equal(uploaded.includes(Buffer.from("test snapshot payload")), false);
  const f = await fixture(t);
  let calls = 0;
  const sender = async (url, options) => {
    calls++;
    assert.match(options.headers["X-HUST-Signature"], /^[a-f0-9]{64}$/);
    return new Response("ok");
  };
  await alertExternal(f.db, "test.failed", "simulated failure", sender);
  await alertExternal(f.db, "test.failed", "simulated failure", sender);
  assert.equal(calls, 1);
  await assert.rejects(
    alertExternal(
      f.db,
      "other.failed",
      "failure",
      async () => new Response("no", { status: 503 }),
    ),
  );
});

test("管理员强制两步验证策略在API层拦截业务，完成验证后开放", async (t) => {
  const previous = process.env.REQUIRE_ADMIN_MFA;
  process.env.REQUIRE_ADMIN_MFA = "true";
  t.after(() => {
    if (previous === undefined) delete process.env.REQUIRE_ADMIN_MFA;
    else process.env.REQUIRE_ADMIN_MFA = previous;
  });
  const f = await fixture(t),
    root = f.client();
  const user = await manager(root);
  assert.equal(user.mfaRequired, true);
  assert.equal((await root.request("/users")).status, 403);
  const setup = (
    await root.request("/auth/mfa/setup", "POST", { currentPassword: PASSWORD })
  ).data;
  assert.equal(
    (
      await root.request("/auth/mfa/enable", "POST", {
        code: totp(setup.secret),
      })
    ).status,
    200,
  );
  assert.equal((await root.request("/users")).status, 200);
});
