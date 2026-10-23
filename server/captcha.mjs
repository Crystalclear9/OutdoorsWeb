import { randomInt, randomBytes } from "node:crypto";
import sharp from "sharp";
import { fail, tx } from "./core.mjs";
import { hashToken } from "./security.mjs";

// Fixed vector outlines render consistently without depending on host fonts.
// The browser receives only the rasterized PNG, never the answer or SVG paths.
const DIGITS = {
  2: "M2 7 C3 -1 18 -1 18 7 C18 12 6 18 2 26 L19 26",
  3: "M2 3 C9 -2 19 0 18 7 C18 11 13 13 8 13 C14 12 20 16 18 22 C16 28 7 29 2 24",
  4: "M15 27 L15 0 L1 19 L21 19",
  5: "M19 1 L3 1 L2 13 C8 9 19 11 19 19 C19 28 7 29 2 25",
  6: "M17 2 C4 -4 -1 13 3 23 C6 31 20 28 19 19 C18 10 6 10 2 17",
  7: "M1 1 L20 1 L7 27",
  8: "M10 13 C-3 10 0 0 10 0 C21 0 24 10 10 13 C-4 16 -1 28 10 28 C22 28 25 16 10 13",
  9: "M18 11 C14 18 1 16 1 8 C1 -1 15 -3 18 6 C22 17 16 31 4 26",
};
export async function captchaPng(code) {
  // Render at 2× display size so strokes remain smooth on high-density screens.
  const strokes = [...code]
    .map((digit, i) => {
      const x = 12 + i * 27,
        y = randomInt(13, 20),
        angle = randomInt(-9, 10);
      return `<path d="${DIGITS[digit]}" transform="translate(${x} ${y}) rotate(${angle} 10 14)" stroke="rgb(${randomInt(35, 70)},${randomInt(40, 75)},${randomInt(45, 80)})"/>`;
    })
    .join("");
  const noise = Array.from(
    { length: 65 },
    () =>
      `<circle cx="${randomInt(188)}" cy="${randomInt(64)}" r="0.6" fill="#bec8cd"/>`,
  ).join("");
  const curves = Array.from(
    { length: 3 },
    () =>
      `<path d="M0 ${randomInt(8, 56)} Q94 ${randomInt(64)} 188 ${randomInt(8, 56)}"/>`,
  ).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="376" height="128" viewBox="0 0 188 64"><rect width="188" height="64" fill="#f7f8f6"/>${noise}<g fill="none" stroke="#bac6c8" stroke-width="0.8">${curves}</g><g fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${strokes}</g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
export function createCaptcha(db, { secure = false, testAnswer } = {}) {
  const binding = (req) =>
    (req.headers.cookie || "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("hust_captcha="))
      ?.slice(13);
  return {
    async issue(req, res) {
      let token = binding(req);
      if (!/^[a-f0-9]{64}$/.test(token || ""))
        token = randomBytes(32).toString("hex");
      const alphabet = "23456789",
        code =
          testAnswer ||
          Array.from(
            { length: 6 },
            () => alphabet[randomInt(alphabet.length)],
          ).join(""),
        id = randomBytes(24).toString("hex"),
        expires = Date.now() + 5 * 60000;
      const image = await captchaPng(code);
      db.prepare(
        "INSERT INTO captchas(id,binding,answer,expires) VALUES(?,?,?,?)",
      ).run(id, hashToken(token), hashToken(id + code), expires);
      res.setHeader(
        "Set-Cookie",
        `hust_captcha=${token}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=1800${secure ? "; Secure" : ""}`,
      );
      return {
        id,
        expires,
        image: "data:image/png;base64," + image.toString("base64"),
      };
    },
    verify(req, b) {
      const token = binding(req),
        id = typeof b.captchaId === "string" ? b.captchaId : "",
        answer =
          typeof b.captcha === "string" ? b.captcha.trim().toUpperCase() : "";
      const valid = tx(db, () => {
        const row = db
          .prepare("SELECT * FROM captchas WHERE id=? AND binding=?")
          .get(id, hashToken(token || ""));
        if (!row) return false;
        db.prepare("DELETE FROM captchas WHERE id=?").run(id);
        return (
          row.expires > Date.now() && row.answer === hashToken(id + answer)
        );
      });
      fail(!valid, 400, "验证码错误或已过期，请刷新后重试");
    },
  };
}
