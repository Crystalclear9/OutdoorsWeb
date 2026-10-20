import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { createWorkQueue } from "./work-queue.mjs";

const scryptAsync = promisify(scrypt);
const passwordWork = createWorkQueue({
  concurrency: 2,
  maxWaiting: 16,
  message: "账号验证繁忙，请稍后重试",
});
const derive = (...args) => passwordWork(() => scryptAsync(...args));
export const hashToken = (token) =>
  createHash("sha256").update(token).digest("hex");
export const randomToken = () => randomBytes(32).toString("hex");
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt, 64);
  return `scrypt:${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password, stored) {
  const [, salt, hex] = stored.split(":");
  const key = await derive(password, salt, 64);
  return timingSafeEqual(Buffer.from(hex, "hex"), key);
}
export function passwordValid(password) {
  return (
    typeof password === "string" &&
    password.length >= 10 &&
    password.length <= 128 &&
    /[a-zA-Z]/.test(password) &&
    /[0-9]/.test(password)
  );
}
export const publicUser = (user) =>
  user
    ? {
        id: user.id,
        email: user.email,
        role: user.role,
        company: user.company,
        contact: user.contact,
        phone: user.phone,
        disabled: !!user.disabled,
        mustChangePassword: !!user.must_change,
        created: user.created,
        version: user.version,
        isSuperAdmin: user.role === "admin" && !!user.is_super,
        mfaRequired:
          user.role === "admin" &&
          process.env.REQUIRE_ADMIN_MFA === "true" &&
          !user.mfa_enabled,
        permissions: user.role === "admin" ? user.permissions || [] : [],
      }
    : null;
