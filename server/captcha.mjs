import { randomInt, randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { fail, tx } from "./core.mjs";
import { hashToken } from "./security.mjs";

const FONT = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01110"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  6: ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
};
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type),
    size = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([size, name, bytes, crc]);
}
export function captchaPng(code) {
  const w = 220,
    h = 64,
    pixels = Buffer.alloc(w * h * 3, 247);
  const pixel = (x, y, color) => {
    if (x >= 0 && x < w && y >= 0 && y < h) {
      const at = (Math.floor(y) * w + Math.floor(x)) * 3;
      pixels.set(color, at);
    }
  };
  for (let i = 0; i < 550; i++)
    pixel(randomInt(w), randomInt(h), [
      randomInt(150, 230),
      randomInt(170, 240),
      randomInt(190, 245),
    ]);
  [...code].forEach((ch, i) => {
    const sx = 10 + i * 34,
      sy = randomInt(10, 20),
      color = [randomInt(25, 90), randomInt(45, 110), randomInt(65, 140)];
    FONT[ch].forEach((row, y) =>
      [...row].forEach((v, x) => {
        if (v === "1")
          for (let a = 0; a < 4; a++)
            for (let b = 0; b < 4; b++)
              pixel(
                sx + x * 4 + a + Math.round(Math.sin((y * 4 + b) / 12)),
                sy + y * 4 + b,
                color,
              );
      }),
    );
  });
  for (let n = 0; n < 3; n++) {
    const phase = randomInt(60);
    for (let x = 0; x < w; x++)
      pixel(
        x,
        Math.round(15 + n * 14 + Math.sin((x + phase) / 28) * 7),
        [145, 166, 185],
      );
  }
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++)
    pixels.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
export function createCaptcha(db, { secure = false, testAnswer } = {}) {
  const binding = (req) =>
    (req.headers.cookie || "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("hust_captcha="))
      ?.slice(13);
  return {
    issue(req, res) {
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
        image: "data:image/png;base64," + captchaPng(code).toString("base64"),
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
