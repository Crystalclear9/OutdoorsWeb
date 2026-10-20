import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { Button, ErrorBox, PasswordInput } from "./components.jsx";

export default function Mfa({ notify, onChanged }) {
  const [status, setStatus] = useState(null),
    [setup, setSetup] = useState(null),
    [codes, setCodes] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api("/auth/mfa")
      .then(setStatus)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  async function submit(e) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError("");
    try {
      const action = status.enabled ? "disable" : setup ? "enable" : "setup";
      const result = await api(`/auth/mfa/${action}`, {
        method: "POST",
        body: values,
      });
      if (action === "setup") setSetup(result);
      else {
        setSetup(null);
        setCodes(result.codes || null);
        await load();
        onChanged?.();
        notify(
          action === "enable"
            ? "两步验证已开启，其他设备已退出"
            : "两步验证已关闭",
        );
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>两步验证</h2>
          <p>使用身份验证器保护账号。管理员建议开启；恢复码只显示一次。</p>
        </div>
        <span className="subtle-tag">
          {status?.enabled ? "已开启" : "未开启"}
        </span>
      </div>
      <ErrorBox>{error}</ErrorBox>
      {codes && (
        <div className="recovery-codes">
          <strong>请立即保存恢复码</strong>
          <p>
            验证器丢失时可用，每个码只能使用一次。关闭此页面后无法再次查看。
          </p>
          <pre>{codes.join("\n")}</pre>
          <Button
            className="secondary"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([codes.join("\n")], { type: "text/plain" }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "hust-recovery-codes.txt";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            下载恢复码
          </Button>
          <Button className="secondary" onClick={() => setCodes(null)}>
            我已妥善保存
          </Button>
        </div>
      )}
      {status && !codes && (
        <form
          className="mfa-form"
          onSubmit={submit}
          key={`${status.enabled}/${!!setup}`}
        >
          {setup && (
            <div className="mfa-setup">
              <p>
                使用 Microsoft Authenticator、Google Authenticator
                等应用扫描二维码，再输入动态验证码。
              </p>
              <img
                width="180"
                height="180"
                src={setup.qr}
                alt="两步验证设置二维码"
              />
              <label>
                手动设置密钥<code>{setup.secret}</code>
              </label>
            </div>
          )}
          {(!setup || status.enabled) && (
            <PasswordInput
              label="当前密码"
              name="currentPassword"
              autoComplete="current-password"
            />
          )}
          {(setup || status.enabled) && (
            <label>
              {status.enabled ? "动态验证码或恢复码" : "动态验证码"}
              <input
                name="code"
                required
                maxLength={32}
                autoComplete="one-time-code"
              />
            </label>
          )}
          <Button
            className={status.enabled ? "danger-outline" : "primary"}
            loading={busy}
            type="submit"
          >
            {status.enabled
              ? "关闭两步验证"
              : setup
                ? "验证并开启"
                : "设置两步验证"}
          </Button>
          {setup && (
            <Button className="secondary" onClick={() => setSetup(null)}>
              取消设置
            </Button>
          )}
          {status.enabled && (
            <p className="field-note">
              剩余恢复码 {status.recoveryRemaining}{" "}
              个。动态验证码使用后不能重放。
            </p>
          )}
        </form>
      )}
    </section>
  );
}
