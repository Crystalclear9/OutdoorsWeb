import React, { useEffect, useState, useRef } from "react";
import { api, apiUrl } from "./api.js";
import CaptchaField, { useCaptcha } from "./Captcha.jsx";
import { Button, ErrorBox, PasswordInput } from "./components.jsx";

function SmsForm({
  purpose,
  onSuccess,
  disabled = false,
  onBusyChange = () => {},
}) {
  const captcha = useCaptcha();
  const { refresh } = captcha;
  const [sent, setSent] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (busy || disabled) return;
    const form = e.currentTarget,
      values = Object.fromEntries(new FormData(form));
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      if (!sent)
        setSent(
          await api("/auth/sms/send", {
            method: "POST",
            body: {
              phone: values.phone,
              purpose,
              captchaId: captcha.challenge?.id,
              captcha: captcha.code,
            },
          }),
        );
      else {
        const result = await api("/auth/sms/verify", {
          method: "POST",
          body: {
            id: sent.id,
            code: values.code,
            currentPassword: values.currentPassword,
          },
        });
        await onSuccess(result);
      }
    } catch (e) {
      setError(e.message);
      if (!sent) refresh();
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <form className="sms-form" onSubmit={submit}>
      <label>
        手机号码
        <input
          name="phone"
          type="tel"
          pattern="1[0-9]{10}"
          maxLength={11}
          required
          readOnly={!!sent}
          disabled={busy || disabled}
          autoComplete="tel"
        />
      </label>
      {sent ? (
        <>
          <label>
            短信验证码
            <input
              name="code"
              required
              pattern="[0-9]{6}"
              maxLength={6}
              inputMode="numeric"
              autoComplete="one-time-code"
              disabled={busy || disabled}
            />
          </label>
          {purpose === "link" && (
            <PasswordInput
              name="currentPassword"
              label="当前账号密码"
              autoComplete="current-password"
              disabled={busy || disabled}
            />
          )}
          <p className="field-note">短信已发送，5分钟内有效。</p>
        </>
      ) : (
        <CaptchaField captcha={captcha} disabled={busy || disabled} sms />
      )}
      <ErrorBox>{error}</ErrorBox>
      <Button
        className="primary"
        type="submit"
        loading={busy}
        disabled={(!sent && !captcha.ready) || disabled}
      >
        {sent
          ? purpose === "link"
            ? "验证并绑定手机号"
            : "使用短信登录"
          : "发送短信验证码"}
      </Button>
      {sent && (
        <Button
          className="secondary"
          type="button"
          disabled={busy || disabled}
          onClick={() => {
            setSent(null);
            refresh();
          }}
        >
          重新填写手机号
        </Button>
      )}
    </form>
  );
}

export function LoginExtras({ onResult, disabled = false, onBusyChange }) {
  const [providers, setProviders] = useState(null),
    [sms, setSms] = useState(false);
  useEffect(() => {
    api("/auth/providers")
      .then(setProviders)
      .catch(() => {});
  }, []);
  if (!providers || !Object.values(providers).some(Boolean)) return null;
  return (
    <div className="login-extras">
      <p>其他登录方式</p>
      <div className="identity-actions">
        {providers.sms && (
          <Button
            className="secondary"
            disabled={disabled}
            onClick={() => setSms(!sms)}
          >
            {sms ? "收起短信登录" : "手机号登录"}
          </Button>
        )}
        {["qq", "wechat"]
          .filter((p) => providers[p])
          .map((p) => (
            <a
              className="button secondary"
              key={p}
              href={apiUrl(`/auth/oauth/${p}/start`)}
              aria-disabled={disabled || undefined}
              tabIndex={disabled ? -1 : undefined}
              onClick={(e) => disabled && e.preventDefault()}
            >
              {p === "qq" ? "QQ 登录" : "微信登录"}
            </a>
          ))}
      </div>
      {sms && (
        <SmsForm
          purpose="login"
          onSuccess={onResult}
          disabled={disabled}
          onBusyChange={onBusyChange}
        />
      )}
      <p className="field-note">
        首次验证后补齐企业资料即可创建账号；已有邮箱账号请先登录并绑定。
      </p>
    </div>
  );
}

export default function Identity({ notify }) {
  const [data, setData] = useState(null),
    [link, setLink] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [readFailed, setReadFailed] = useState(false);
  const mounted = useRef(true),
    request = useRef(0);
  async function load(saved = "") {
    if (!mounted.current) return false;
    const generation = ++request.current;
    setLoading(true);
    setError("");
    try {
      const latest = await api("/auth/identities");
      if (!mounted.current || generation !== request.current) return false;
      setData(latest);
      setReadFailed(false);
      return true;
    } catch (e) {
      if (mounted.current && generation === request.current) {
        setData(null);
        setReadFailed(true);
        setError(
          saved
            ? `${saved}，但状态读取失败：${e.message}。请重新读取后核对。`
            : e.message,
        );
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
  async function unlink(provider) {
    if (busy || loading || !data) return;
    setBusy(true);
    setError("");
    try {
      await api(`/auth/oauth/${provider}/unlink`, { method: "POST" });
      await load("解除绑定已保存");
      if (mounted.current) notify("已解除绑定");
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>快捷登录与账号绑定</h2>
          <p>验证并绑定本人手机号或第三方账号，避免重复注册。</p>
        </div>
      </div>
      <div className="identity-content">
        <ErrorBox>{error}</ErrorBox>
        {readFailed && (
          <Button
            className="secondary"
            disabled={busy || loading}
            onClick={() => load()}
          >
            重新读取绑定状态
          </Button>
        )}
        {loading && <p className="field-note">正在读取绑定状态…</p>}
        {data && !loading && (
          <>
            <p>
              已验证手机号：<strong>{data.phone || "尚未绑定"}</strong>
            </p>
            {data.configured.sms ? (
              <>
                <Button
                  className="secondary"
                  disabled={busy}
                  onClick={() => setLink(!link)}
                >
                  {link
                    ? "收起绑定"
                    : data.phone
                      ? "更换绑定手机号"
                      : "验证并绑定手机号"}
                </Button>
                {link && (
                  <SmsForm
                    purpose="link"
                    disabled={busy}
                    onBusyChange={setBusy}
                    onSuccess={async () => {
                      if (!mounted.current) return;
                      setLink(false);
                      await load("手机号绑定已保存");
                      if (mounted.current) notify("手机号已验证并绑定");
                    }}
                  />
                )}
              </>
            ) : (
              <p className="field-note">手机号快捷登录暂未开放。</p>
            )}
            <div className="identity-actions">
              {["qq", "wechat"].map((p) => {
                const linked = data.providers.includes(p),
                  label = p === "qq" ? "QQ" : "微信";
                return linked ? (
                  <Button
                    key={p}
                    className="secondary"
                    disabled={busy}
                    onClick={() => unlink(p)}
                  >
                    解除 {label} 绑定
                  </Button>
                ) : data.configured[p] ? (
                  <a
                    key={p}
                    className="button secondary"
                    href={apiUrl(`/auth/oauth/${p}/start?intent=link`)}
                    aria-disabled={busy || undefined}
                    tabIndex={busy ? -1 : undefined}
                    onClick={(event) => busy && event.preventDefault()}
                  >
                    绑定 {label}
                  </a>
                ) : (
                  <span className="subtle-tag" key={p}>
                    {label} 登录暂未开放
                  </span>
                );
              })}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
