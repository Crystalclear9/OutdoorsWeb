import React, { useEffect, useState } from "react";
import { api, apiUrl } from "./api.js";
import { Button, ErrorBox, PasswordInput } from "./components.jsx";

function SmsForm({
  purpose,
  onSuccess,
  disabled = false,
  onBusyChange = () => {},
}) {
  const [captcha, setCaptcha] = useState(null),
    [sent, setSent] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = () =>
    api("/auth/captcha")
      .then(setCaptcha)
      .catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, []);
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
              captchaId: captcha?.id,
              captcha: values.captcha,
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
        onSuccess(result);
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
            />
          </label>
          {purpose === "link" && (
            <PasswordInput
              name="currentPassword"
              label="当前账号密码"
              autoComplete="current-password"
            />
          )}
          <p className="field-note">短信已发送，5分钟内有效。</p>
        </>
      ) : (
        <div className="captcha-field">
          <label>
            图片验证码
            <input
              name="captcha"
              required
              pattern="[0-9]{6}"
              maxLength={6}
              inputMode="numeric"
            />
          </label>
          <button
            className="captcha-image"
            type="button"
            aria-label="刷新短信图片验证码"
            disabled={busy || disabled}
            onClick={refresh}
          >
            {captcha && (
              <img src={captcha.image} alt="短信发送前的图片验证码" />
            )}
          </button>
        </div>
      )}
      <ErrorBox>{error}</ErrorBox>
      <Button
        className="primary"
        type="submit"
        loading={busy}
        disabled={!captcha || disabled}
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
    [busy, setBusy] = useState(false);
  const load = () =>
    api("/auth/identities")
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  async function preferences(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/auth/notifications", {
        method: "POST",
        body: { sms: !!data.preferences.sms, voice: !!data.preferences.voice },
      });
      notify("通知偏好已保存");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function unlink(provider) {
    setBusy(true);
    try {
      await api(`/auth/oauth/${provider}/unlink`, { method: "POST" });
      await load();
      notify("已解除绑定");
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
          <h2>快捷登录与结果通知</h2>
          <p>验证并绑定本人手机号或第三方账号，避免重复注册。</p>
        </div>
      </div>
      <div className="identity-content">
        <ErrorBox>{error}</ErrorBox>
        {data && (
          <>
            <p>
              已验证手机号：<strong>{data.phone || "尚未绑定"}</strong>
            </p>
            {data.configured.sms ? (
              <>
                <Button className="secondary" onClick={() => setLink(!link)}>
                  {link
                    ? "收起绑定"
                    : data.phone
                      ? "更换绑定手机号"
                      : "验证并绑定手机号"}
                </Button>
                {link && (
                  <SmsForm
                    purpose="link"
                    onSuccess={() => {
                      setLink(false);
                      load();
                      notify("手机号已验证并绑定");
                    }}
                  />
                )}
              </>
            ) : (
              <p className="field-note">手机号快捷登录与电话通知暂未开放。</p>
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
            {data.phone && data.configured.sms && (
              <form onSubmit={preferences}>
                <h3>审批结果通知</h3>
                {[
                  ["sms", "接收审批结果短信"],
                  ["voice", "接收自动语音电话通知"],
                ].map(([key, label]) => (
                  <label key={key} className="check-label">
                    <input
                      type="checkbox"
                      checked={!!data.preferences[key]}
                      onChange={(e) =>
                        setData((d) => ({
                          ...d,
                          preferences: {
                            ...d.preferences,
                            [key]: +e.target.checked,
                          },
                        }))
                      }
                    />
                    {label}
                  </label>
                ))}
                <p className="field-note">
                  仅向已验证号码发送，站内消息始终保留。勾选表示同意接收对应通知。
                </p>
                <Button className="secondary" loading={busy} type="submit">
                  保存通知偏好
                </Button>
              </form>
            )}
          </>
        )}
      </div>
    </section>
  );
}
