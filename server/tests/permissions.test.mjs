import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fixture,
  register,
  manager,
  staff,
  booking,
  PASSWORD,
} from "./helpers.mjs";

test("审核、公告、账号、日志权限各自生效，退役场地权限不可分配", async (t) => {
  const { client } = await fixture(t),
    root = client(),
    enterprise = client();
  const rootUser = await manager(root),
    owner = await register(enterprise);
  const id = (await enterprise.request("/bookings", "POST", booking())).data.id;
  const reviewer = client();
  await staff(root, reviewer, ["bookings.review"], "reviewer@test.local");
  assert.equal((await reviewer.request("/bookings")).status, 200);
  const image = await fetch(reviewer.origin + `/api/bookings/${id}/image`, {
    headers: reviewer.headers,
  });
  assert.equal(image.status, 200);
  await image.arrayBuffer();
  assert.equal(
    (
      await reviewer.request("/notices", "POST", {
        title: "越权",
        content: "正文",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await reviewer.request(
        `/bookings/${id}/review`,
        "POST",
        {
          status: "未通过",
          reason: "补充材料",
        },
        { "If-Match": '"1"' },
      )
    ).status,
    200,
  );
  const venue = client();
  await staff(root, venue, ["notices.manage"], "venue@test.local");
  assert.equal(
    (
      await venue.request("/closures", "POST", {
        slot: 2,
        start: booking().start,
        end: booking().end,
        reason: "维护",
      })
    ).status,
    403,
  );
  assert.equal((await venue.request("/bookings")).status, 403);
  assert.equal((await venue.request("/users")).status, 403);
  const accounts = client();
  await staff(root, accounts, ["accounts.manage"], "accounts@test.local");
  const users = (await accounts.request("/users")).data.items;
  assert.ok(users.length > 0 && users.every((u) => u.role === "enterprise"));
  assert.equal(
    (
      await accounts.request(
        `/users/${owner.id}/status`,
        "POST",
        {
          disabled: true,
        },
        { "If-Match": '"1"' },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await accounts.request(
        `/users/${rootUser.id}/reset-password`,
        "POST",
        undefined,
        { "If-Match": '"1"' },
      )
    ).status,
    403,
  );
  const auditor = client();
  await staff(root, auditor, ["audit.read"], "auditor@test.local");
  const audit = await auditor.request("/audit");
  assert.equal(audit.status, 200);
  assert.ok(audit.data.items.some((a) => a.action === "access.staff_created"));
  assert.ok(!JSON.stringify(audit.data).includes(PASSWORD));
  assert.equal((await auditor.request("/closures")).status, 403);
});

test("管理员不能审核自己拥有的申请，拒绝操作保留审计记录", async (t) => {
  const { client, db } = await fixture(t),
    root = client(),
    u = await manager(root),
    b = booking();
  db.prepare(
    "INSERT INTO bookings(id,user_id,company,contact,phone,start,end,slot,status,image,image_type,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "legacy-own",
    u.id,
    b.company,
    b.contact,
    b.phone,
    b.start,
    b.end,
    b.slot,
    "待审核",
    Buffer.from(b.image.split(",")[1], "base64"),
    "image/png",
    new Date().toISOString(),
  );
  assert.equal(
    (
      await root.request(
        "/bookings/legacy-own/review",
        "POST",
        {
          status: "已通过",
        },
        { "If-Match": '"1"' },
      )
    ).status,
    403,
  );
  assert.equal(
    db.prepare("SELECT status FROM bookings WHERE id='legacy-own'").get()
      .status,
    "待审核",
  );
  assert.ok(
    db
      .prepare(
        "SELECT id FROM audit WHERE action='access.denied' AND target='/api/bookings/legacy-own/review'",
      )
      .get(),
  );
});
