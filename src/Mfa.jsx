import React, { useEffect, useState, useRef } from "react";
import { api } from "./api.js";
import { Button, ErrorBox, PasswordInput } from "./components.jsx";

export default function Mfa({ notify, onChanged }) {
  const [status, setStatus] = useState(null),
    [setup, setSetup] = useState(null),
    [codes, setCodes] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const mounted = useRef(true),
    request = useRef(0);
  async function load() {
    if (!mounted.current) return false;
    const generation = ++request.current;
    setLoading(true);
    try {
      const latest = await api("/auth/mfa");
      if (!mounted.current || generation !== request.current) return false;
      setStatus(latest);
      if (latest.enabled) setSetup(null);
      setError("");
      return true;
    } catch (e) {
      if (mounted.current && generation === request.current) {
        // A failed read cannot confirm that MFA is disabled, nor authorize an
        // operation chosen from the status before a successful mutation.
        setStatus(null);
        setError(e.message);
      }
      return false;
    } finally {
      if (mounted.current && generation === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, []);
  async function retry() {
    if (busy || loading) return;
    setBusy(true);
    try {
      // Read and synchronize only. Never repeat the enable/disable mutation or
      // replace the one-time recovery codes after an uncertain follow-up read.
      if (await load()) await onChanged?.();
    } catch (e) {
      if (mounted.current)
        setError(`账号状态同步失败：${e.message}，请重新读取。`);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function submit(e) {
    e.preventDefault();
    if (busy || loading || !status) return;
    const values = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError("");
    let changed = false;
    try {
      const action = status.enabled ? "disable" : setup ? "enable" : "setup";
      const result = await api(`/auth/mfa/${action}`, {
        method: "POST",
        body: values,
      });
      if (action === "setup") {
        if (mounted.current) setSetup(result);
      } else {
        changed = true;
        if (mounted.current) {
          setSetup(null);
          setCodes(result.codes || null);
        }
        await load();
        // The App guards this callback by authentication generation; it may
        // still synchronize a completed mutation after this page was left.
        await onChanged?.();
        notify(
          action === "enable"
            ? "两步验证已开启，其他设备已退出"
            : "两步验证已关闭",
        );
      }
    } catch (e) {
      if (mounted.current)
        setError(
          changed
            ? `两步验证设置已保存，但账号状态同步失败：${e.message}，请重新读取后核对。`
            : e.message,
        );
    } finally {
      if (mounted.current) setBusy(false);
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
          {loading
            ? "正在读取"
            : !status
              ? "状态待确认"
              : status.enabled
                ? "已开启"
                : "未开启"}
        </span>
      </div>
      <ErrorBox>{error}</ErrorBox>
      {error && (
        <Button
          className="secondary"
          type="button"
          disabled={busy || loading}
          onClick={retry}
        >
          重新读取验证状态
        </Button>
      )}
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
      {status && !loading && !codes && (
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
            <Button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => setSetup(null)}
            >
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
