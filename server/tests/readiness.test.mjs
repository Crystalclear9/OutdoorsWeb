import test from "node:test";
import assert from "node:assert/strict";
import { integrationReadiness } from "../readiness.mjs";
test("配置检查区分缺失与无效，禁止非HTTPS公网回调，不返回任何凭据", () => {
  assert.ok(integrationReadiness({}).every((r) => r.state === "未配置"));
  const raw = {
    QQ_CLIENT_ID: "test-id",
    QQ_CLIENT_SECRET: "private-secret-value",
    PUBLIC_URL: "http://public.example.com",
    S3_BACKUP_BUCKET: "private",
    BACKUP_ENCRYPTION_KEY: "bad-key",
  };
  const status = integrationReadiness(raw);
  assert.equal(status.find((r) => r.key === "qq").configured, false);
  assert.equal(status.find((r) => r.key === "s3").configured, false);
  assert.equal(JSON.stringify(status).includes(raw.QQ_CLIENT_SECRET), false);
  const valid = integrationReadiness({
    ...raw,
    PUBLIC_URL: "https://venue.example.com",
    BACKUP_ENCRYPTION_KEY: "ab".repeat(32),
  });
  assert.equal(valid.find((r) => r.key === "qq").configured, true);
  assert.equal(valid.find((r) => r.key === "s3").configured, true);
  assert.equal(
    integrationReadiness({
      ...raw,
      PUBLIC_URL: "https://venue.example.com/other",
    }).find((r) => r.key === "qq").configured,
    false,
  );
});
