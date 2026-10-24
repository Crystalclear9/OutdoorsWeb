import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { captchaPng } from "../captcha.mjs";

test("验证码突发渲染限制运行和等待总量，超限后仍能生成真实PNG", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 24 }, () => captchaPng("246789")),
  );
  const accepted = results.filter((r) => r.status === "fulfilled"),
    rejected = results.filter((r) => r.status === "rejected");
  assert.equal(accepted.length, 18);
  assert.equal(rejected.length, 6);
  assert.ok(rejected.every((r) => r.reason.status === 503));
  for (const { value } of accepted) {
    const metadata = await sharp(value).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, 376);
    assert.equal(metadata.height, 128);
  }
  assert.equal(
    (await sharp(await captchaPng("987654")).metadata()).format,
    "png",
  );
});

test("验证码渲染异常释放容量，后续有效请求可以完成", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 18 }, () => captchaPng(null)),
  );
  assert.ok(results.every((r) => r.status === "rejected"));
  const recovered = await Promise.allSettled(
    Array.from({ length: 18 }, () => captchaPng("246789")),
  );
  assert.ok(recovered.every((r) => r.status === "fulfilled"));
});
