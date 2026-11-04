import { body, clean, fail, now } from "./core.mjs";
import { hashToken } from "./security.mjs";
import { can } from "../shared/permissions.js";

const fingerprint = (u) =>
  hashToken(JSON.stringify([u.company, u.contact, u.phone]));
export function verificationView(
  db,
  target,
  internal = false,
  historyPage = 1,
) {
  const row = db
    .prepare("SELECT * FROM enterprise_verifications WHERE user_id=?")
    .get(target.id);
  const state =
    row && row.snapshot_hash !== fingerprint(target)
      ? "needs_review"
      : row?.state || "pending";
  return {
    state,
    version: row?.version || 0,
    reviewed: row?.reviewed || null,
    note: row?.note || "",
    profile: {
      company: target.company,
      contact: target.contact,
      phone: target.phone,
    },
    profileVersion: target.version,
    ...(internal
      ? {
          evidence: row?.evidence || "",
          reviewer: row?.reviewer || null,
          historyPage,
          historyPages: Math.max(
            1,
            Math.ceil(
              db
                .prepare(
                  "SELECT COUNT(*) n FROM enterprise_verification_history WHERE user_id=?",
                )
                .get(target.id).n / 20,
            ),
          ),
          history: db
            .prepare(
              "SELECT version,state,profile,evidence,note,reviewer,reviewed FROM enterprise_verification_history WHERE user_id=? ORDER BY version DESC LIMIT 20 OFFSET ?",
            )
            .all(target.id, (historyPage - 1) * 20)
            .map((r) => ({ ...r, profile: JSON.parse(r.profile) })),
        }
      : {}),
  };
}
export function createVerificationRoutes(db, sec, send) {
  return async (req, res, url) => {
    const match = url.pathname.match(
      /^\/api\/enterprise-verifications\/([^/]+)$/,
    );
    if (!match) return false;
    const id = decodeURIComponent(match[1]);
    const target = () => {
      const u = db
        .prepare("SELECT * FROM users WHERE id=? AND role='enterprise'")
        .get(id);
      fail(!u, 404, "企业账号不存在");
      return u;
    };
    if (req.method === "GET") {
      const user = sec.current(req);
      const internal = can(sec.present(user), "accounts.manage");
      fail(
        user.id !== id &&
          !internal &&
          !can(sec.present(user), "bookings.review"),
        403,
        "无权读取企业核验记录",
      );
      const historyPage = Number(url.searchParams.get("historyPage") || 1);
      fail(
        !Number.isSafeInteger(historyPage) ||
          historyPage < 1 ||
          historyPage > 1000000,
        400,
        "核验历史页码无效",
      );
      send(res, verificationView(db, target(), internal, historyPage));
      return true;
    }
    if (req.method === "POST") {
      sec.current(req, "accounts.manage");
      const b = await body(req),
        evidence = clean(b.evidence, 2000),
        note = clean(b.note, 500);
      fail(
        !["pending", "verified", "rejected"].includes(b.state) ||
          !Number.isSafeInteger(b.version) ||
          b.version < 0 ||
          !Number.isSafeInteger(b.profileVersion),
        400,
        "核验状态或版本无效",
      );
      fail(
        b.state !== "pending" && !evidence,
        400,
        "请填写核验依据，避免录入无关证件信息",
      );
      fail(
        b.state === "rejected" && !note,
        400,
        "退回核验需填写企业可见的说明",
      );
      const result = sec.write(req, "accounts.manage", (user) => {
        const u = target(),
          previous = verificationView(db, u, true);
        fail(
          previous.version !== b.version || u.version !== b.profileVersion,
          409,
          "企业资料或核验记录已变化，请重新读取后核对",
        );
        db.prepare(
          `INSERT INTO enterprise_verifications(user_id,state,snapshot_hash,evidence,note,reviewer,reviewed,version)
          VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(user_id) DO UPDATE SET state=excluded.state,snapshot_hash=excluded.snapshot_hash,
          evidence=excluded.evidence,note=excluded.note,reviewer=excluded.reviewer,reviewed=excluded.reviewed,version=version+1`,
        ).run(id, b.state, fingerprint(u), evidence, note, user.id, now());
        db.prepare(
          "INSERT INTO enterprise_verification_history(user_id,version,state,profile,evidence,note,reviewer,reviewed) VALUES(?,?,?,?,?,?,?,?)",
        ).run(
          id,
          previous.version + 1,
          b.state,
          JSON.stringify(previous.profile),
          evidence,
          note,
          user.id,
          now(),
        );
        sec.audit(user.id, "enterprise.verification_updated", id, {
          state: b.state,
          profileVersion: u.version,
          verificationVersion: previous.version + 1,
        });
        return verificationView(db, u, true);
      });
      send(res, result);
      return true;
    }
    fail(true, 405, "不支持的请求方法");
  };
}
