import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { totp } from "../server/mfa.mjs";

// Run only against resources created below. This never mounts the project's
// data directory or reads .env, and never adds a production captcha bypass.
const exec = promisify(execFile),
  image = process.argv[2] || "outdoorsweb:verify",
  suffix = randomUUID(),
  container = `outdoors-smoke-${suffix}`,
  volume = `outdoors-smoke-data-${suffix}`,
  adminEmail = "container-admin@test.local",
  password = `SmokeAccount${randomUUID()}9`,
  replacementPassword = `ChangedConfig${randomUUID()}9`;
let volumeCreated = false,
  containerCreated = false,
  failed = false,
  origin;

async function docker(args, timeout = 60000) {
  const { stdout } = await exec("docker", args, {
    timeout,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  return stdout.trim();
}
async function start(adminPassword) {
  await docker([
    "run",
    "--detach",
    "--name",
    container,
    "--label",
    `outdoorsweb.smoke=${suffix}`,
    "--init",
    "--publish",
    "127.0.0.1::3001",
    "--mount",
    `type=volume,source=${volume},target=/app/data`,
    "--health-interval=2s",
    "--health-start-period=5s",
    "--health-timeout=5s",
    "--env",
    `ADMIN_EMAIL=${adminEmail}`,
    "--env",
    `ADMIN_PASSWORD=${adminPassword}`,
    "--env",
    "REQUIRE_ADMIN_MFA=true",
    "--env",
    "BACKUP_INTERVAL_HOURS=0",
    image,
  ]);
  containerCreated = true;
  const ports = JSON.parse(
    await docker([
      "inspect",
      "--format",
      "{{json .NetworkSettings.Ports}}",
      container,
    ]),
  );
  const port = ports["3001/tcp"].find((p) => p.HostIp === "127.0.0.1").HostPort;
  origin = `http://127.0.0.1:${port}`;
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    const state = JSON.parse(
      await docker(["inspect", "--format", "{{json .State}}", container]),
    );
    assert.equal(
      state.Running,
      true,
      "Container exited before becoming healthy",
    );
    if (state.Health?.Status === "healthy") {
      const response = await fetch(origin + "/api/health", {
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).ok, true);
      assert.notEqual(
        await docker(["exec", container, "id", "-u"]),
        "0",
        "Image must run without root",
      );
      return;
    }
    await delay(500);
  }
  throw new Error("Container did not become healthy within 60 seconds");
}
function client() {
  const cookies = new Map();
  let csrf = "";
  return {
    async request(route, method = "GET", body, extraHeaders = {}) {
      const response = await fetch(origin + "/api" + route, {
        method,
        signal: AbortSignal.timeout(15000),
        headers: {
          Origin: origin,
          Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
          "X-CSRF-Token": csrf,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...extraHeaders,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      for (const value of response.headers.getSetCookie()) {
        const pair = value.split(";")[0],
          split = pair.indexOf("=");
        cookies.set(pair.slice(0, split), pair.slice(split + 1));
      }
      const data = response.headers
        .get("content-type")
        ?.includes("application/json")
        ? await response.json()
        : Buffer.from(await response.arrayBuffer());
      if (data.csrf) csrf = data.csrf;
      return { status: response.status, data, headers: response.headers };
    },
  };
}
async function authenticate(c, route, body) {
  const challenge = await c.request("/auth/captcha");
  assert.equal(challenge.status, 200);
  assert.match(challenge.data.image, /^data:image\/png;base64,iVBOR/);
  // Only the disposable container's one real challenge is given a known answer.
  // Its cookie binding, expiry and single consumption are still verified by API.
  const answer = "246789";
  await docker([
    "exec",
    container,
    "node",
    "--input-type=module",
    "-e",
    "import {DatabaseSync} from 'node:sqlite';import {createHash} from 'node:crypto';const db=new DatabaseSync('/app/data/app.sqlite');db.exec('PRAGMA busy_timeout=5000');const result=db.prepare('UPDATE captchas SET answer=? WHERE id=?').run(createHash('sha256').update(process.argv[1]+process.argv[2]).digest('hex'),process.argv[1]);if(result.changes!==1)throw Error('Missing isolated challenge');db.close();",
    challenge.data.id,
    answer,
  ]);
  return c.request(route, "POST", {
    ...body,
    captchaId: challenge.data.id,
    captcha: answer,
  });
}
async function checkPage() {
  const response = await fetch(origin, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<div id="root"><\/div>/);
  const source = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
  assert.ok(source, "Built HTML must reference a script");
  const script = await fetch(new URL(source, origin), {
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type"), /javascript/);
}

try {
  try {
    const os = await docker(["info", "--format", "{{.OSType}}"], 15000);
    assert.equal(os, "linux", "Docker smoke requires Linux containers");
  } catch {
    throw new Error(
      "Docker engine is unavailable. Start Linux containers before running test:docker; no container acceptance was performed.",
    );
  }
  await docker([
    "volume",
    "create",
    "--label",
    "outdoorsweb.purpose=smoke",
    volume,
  ]);
  volumeCreated = true;
  await start(password);
  await checkPage();

  const admin = client(),
    owner = client();
  const login = await authenticate(admin, "/auth/login", {
    email: adminEmail,
    password,
  });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.role, "admin");
  assert.equal(login.data.user.mfaRequired, true);
  assert.equal(
    (await admin.request("/operations")).status,
    403,
    "MFA enrollment gate must be active in the real image",
  );
  const setup = await admin.request("/auth/mfa/setup", "POST", {
    currentPassword: password,
  });
  assert.equal(setup.status, 200);
  assert.equal(
    (
      await admin.request("/auth/mfa/enable", "POST", {
        code: totp(setup.data.secret),
      })
    ).status,
    200,
  );
  assert.equal((await admin.request("/operations")).status, 200);

  const company = `Container acceptance ${suffix}`;
  const registered = await authenticate(owner, "/auth/register", {
    email: `container-${suffix}@test.local`,
    password,
    company,
    contact: "验收联系人",
    phone: "13800138000",
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.data.user.role, "enterprise");
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + 2 * 86400000));
  const made = await owner.request("/bookings", "POST", {
    company,
    contact: "验收联系人",
    phone: "13800138000",
    slot: 29,
    start: date,
    end: date,
    image:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNw6Uhz6UhjgFAAIP4Eydx3XHYAAAAASUVORK5CYII=",
  });
  assert.equal(made.status, 201);
  const id = made.data.id,
    pending = await admin.request(`/bookings/${id}`);
  assert.equal(pending.status, 200);
  assert.equal(
    (
      await admin.request(
        `/bookings/${id}/review`,
        "POST",
        { status: "已通过" },
        { "If-Match": `"${pending.data.booking.version}"` },
      )
    ).status,
    200,
  );
  const beforeImage = await owner.request(`/bookings/${id}/image`);
  assert.equal(beforeImage.status, 200);
  assert.match(beforeImage.headers.get("content-type"), /^image\/webp/);
  const imageDigest = createHash("sha256")
    .update(beforeImage.data)
    .digest("hex");
  assert.ok(
    (await owner.request(`/venue?date=${date}`)).data.occupied.some(
      (r) => r.slot === 29,
    ),
  );

  await docker(["stop", "--time", "20", container], 30000);
  await docker(["rm", container]);
  containerCreated = false;
  // A replacement container must retain the old password and the same MFA key.
  await start(replacementPassword);
  const restored = await owner.request(`/bookings/${id}`);
  assert.equal(
    restored.status,
    200,
    "Owner session must survive container replacement",
  );
  assert.equal(restored.data.booking.status, "已通过");
  assert.equal(restored.data.booking.company, company);
  const afterImage = await owner.request(`/bookings/${id}/image`);
  assert.equal(afterImage.status, 200);
  assert.equal(
    createHash("sha256").update(afterImage.data).digest("hex"),
    imageDigest,
  );
  const freshAdmin = client();
  const challenge = await authenticate(freshAdmin, "/auth/login", {
    email: adminEmail,
    password,
  });
  assert.equal(
    challenge.status,
    200,
    "Changing bootstrap environment must not reset existing admin password",
  );
  assert.equal(challenge.data.mfaRequired, true);
  const proof = await freshAdmin.request("/auth/mfa/login", "POST", {
    challenge: challenge.data.challenge,
    code: totp(setup.data.secret, Math.floor(Date.now() / 30000) + 1),
  });
  assert.equal(
    proof.status,
    200,
    "Persisted MFA secret must decrypt with the volume's original key",
  );
  assert.equal((await freshAdmin.request("/operations")).status, 200);
  console.log(
    "Docker acceptance passed: non-root, health, built page/API, admin MFA, enterprise application/approval, volume persistence, design image and MFA recovery.",
  );
} catch (error) {
  failed = true;
  console.error(`Docker acceptance failed: ${error.message}`);
  if (containerCreated) {
    try {
      console.error(await docker(["logs", "--tail", "100", container]));
    } catch {}
  }
} finally {
  // docker run may create a stopped container before reporting a port/startup
  // error. Discover only our labeled UUID resource before removing its volume.
  if (volumeCreated && !containerCreated) {
    try {
      const marker = await docker([
        "inspect",
        "--format",
        '{{index .Config.Labels "outdoorsweb.smoke"}}',
        container,
      ]);
      containerCreated = marker === suffix;
    } catch {}
  }
  if (containerCreated) {
    try {
      await docker(["rm", "--force", container]);
    } catch (error) {
      failed = true;
      console.error(
        `Could not remove smoke container ${container}: ${error.message}`,
      );
    }
  }
  if (volumeCreated) {
    try {
      await docker(["volume", "rm", volume]);
    } catch (error) {
      failed = true;
      console.error(
        `Could not remove smoke volume ${volume}: ${error.message}`,
      );
    }
  }
}
if (failed) process.exitCode = 1;
