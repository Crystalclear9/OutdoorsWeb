import React, { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  SpinnerGap,
  Buildings,
  ArrowRight,
  ArrowLeft,
  Eye,
  EyeSlash,
  ShieldCheck,
  WarningCircle,
} from "@phosphor-icons/react";
import { api, setCsrf } from "./api.js";
import Sessions from "./Sessions.jsx";
import Mfa from "./Mfa.jsx";
import Identity, { LoginExtras } from "./Identity.jsx";

export function Button({ children, loading, className = "", ...props }) {
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      className={`button ${className}`}
    >
      {loading && <SpinnerGap className="spin" size={18} />} {children}
    </button>
  );
}
export function ErrorBox({ children }) {
  return children ? (
    <div className="error-box" role="alert">
      <WarningCircle size={19} />
      <span>{children}</span>
    </div>
  ) : null;
}
export function Pagination({ page, pages, total, onPage }) {
  return (
    <div className="pagination">
      <span>
        共 {total} 条 · 第 {page} / {pages} 页
      </span>
      <div>
        <Button
          className="secondary small"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          上一页
        </Button>
        <Button
          className="secondary small"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}
export function Empty({
  icon: Icon = Buildings,
  title = "暂无记录",
  children,
}) {
  return (
    <div className="empty">
      <span>
        <Icon size={31} weight="light" />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Status({ value }) {
  return (
    <span
      className={`status status-${value === "已通过" ? "approved" : value === "待审核" ? "pending" : value === "未通过" ? "rejected" : "withdrawn"}`}
    >
      <span />
      {value}
    </span>
  );
}
export function Modal({ title, description, children, onClose, wide = false }) {
  return (
    <Dialog.Root open onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className={`dialog-content ${wide ? "dialog-wide" : ""}`}
        >
          <div className="dialog-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>
                {description || "请核对信息后操作。"}
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="关闭">
              <X size={22} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function PasswordInput({
  label = "密码",
  name = "password",
  minLength = 10,
  autoComplete = "new-password",
  ...props
}) {
  const [show, setShow] = useState(false);
  return (
    <label>
      {label}
      <div className="password-field">
        <input
          name={name}
          type={show ? "text" : "password"}
          minLength={minLength}
          maxLength={128}
          autoComplete={autoComplete}
          required
          {...props}
        />
        <button
          type="button"
          aria-label={show ? "隐藏密码" : "显示密码"}
          onClick={() => setShow(!show)}
        >
          {show ? <EyeSlash size={19} /> : <Eye size={19} />}
        </button>
      </div>
    </label>
  );
}
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Buildings size={27} weight="bold" />
      </span>
      <div>
        <strong>华中科技大学</strong>
        <small>大学生活动中心 · 场地服务</small>
      </div>
    </div>
  );
}

export function AuthPage({
  initialMode = "login",
  initialMfa = null,
  onSuccess,
  onBack,
}) {
  const [mfa, setMfa] = useState(initialMfa);
  const [mode, setMode] = useState(initialMode),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [challenge, setChallenge] = useState(null),
    [code, setCode] = useState(""),
    [captchaBusy, setCaptchaBusy] = useState(false),
    [captchaError, setCaptchaError] = useState("");
  async function refreshCaptcha() {
    setCaptchaBusy(true);
    setChallenge(null);
    setCode("");
    setCaptchaError("");
    try {
      setChallenge(await api("/auth/captcha"));
    } catch (e) {
      setCaptchaError(e.message);
    } finally {
      setCaptchaBusy(false);
    }
  }
  useEffect(() => {
    refreshCaptcha();
  }, []);
  async function submit(e) {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.currentTarget));
    setError("");
    if (mode === "register" && b.password !== b.confirm)
      return setError("两次输入的密码不一致");
    setBusy(true);
    try {
      const result = await api(`/auth/${mode}`, {
        method: "POST",
        body: { ...b, captchaId: challenge?.id, captcha: code },
      });
      if (result.mfaRequired) {
        setMfa(result.challenge);
        return;
      }
      setCsrf(result.csrf);
      onSuccess(result.user);
    } catch (e) {
      setError(e.message);
      await refreshCaptcha();
    } finally {
      setBusy(false);
    }
  }
  async function verifyMfa(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api("/auth/mfa/login", {
        method: "POST",
        body: {
          challenge: mfa,
          code: new FormData(e.currentTarget).get("code"),
        },
      });
      setCsrf(result.csrf);
      onSuccess(result.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <section className="auth-story">
        <Brand />
        <div className="auth-story-copy">
          <span className="section-kicker">CAMPUS SPACE, SHARED.</span>
          <h1>
            好的相遇，
            <br />
            从这里开始。
          </h1>
          <p>
            连接企业与校园，
            <br />
            让每一场活动都有合适的位置。
          </p>
        </div>
        <div className="auth-architecture" aria-hidden="true">
          <div className="building-shape">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="architecture-floor" />
          <span>大学生活动中心</span>
        </div>
        <div className="auth-story-footer">
          <ShieldCheck size={19} />
          账号保护 · 有序预约 · 透明审核
        </div>
      </section>
      <section className="auth-form-side">
        <button className="text-button back-link" onClick={onBack}>
          <ArrowLeft size={17} />
          返回场地浏览
        </button>
        <div className="auth-form-wrap">
          <span className="section-kicker">
            {mode === "login" ? "欢迎回来" : "开启校园布展之旅"}
          </span>
          <h2>{mode === "login" ? "登录您的账号" : "注册企业账号"}</h2>
          <p>
            {mode === "login"
              ? "管理您的布展申请，随时掌握审核进度。"
              : "填写企业信息，账号创建后即可提交申请。"}
          </p>
          <div className="auth-switch">
            <button
              className={mode === "login" ? "selected" : ""}
              onClick={() => {
                setMode("login");
                setError("");
              }}
            >
              账号登录
            </button>
            <button
              className={mode === "register" ? "selected" : ""}
              onClick={() => {
                setMode("register");
                setError("");
              }}
            >
              企业注册
            </button>
          </div>
          {mfa ? (
            <form onSubmit={verifyMfa}>
              <h3>验证您的身份</h3>
              <p>输入验证器中的动态验证码，或使用已保存的恢复码。</p>
              <label>
                动态验证码或恢复码
                <input
                  name="code"
                  required
                  autoComplete="one-time-code"
                  maxLength={32}
                  autoFocus
                />
              </label>
              <ErrorBox>{error}</ErrorBox>
              <Button className="primary full" loading={busy} type="submit">
                完成两步验证
              </Button>
              <Button
                className="secondary full"
                onClick={() => {
                  setMfa(null);
                  refreshCaptcha();
                }}
              >
                返回重新登录
              </Button>
            </form>
          ) : (
            <form onSubmit={submit} key={mode}>
              <label>
                邮箱地址
                <input
                  type="email"
                  name="email"
                  required
                  maxLength={254}
                  placeholder="name@company.com"
                  autoComplete="username"
                />
              </label>
              {mode === "register" && (
                <>
                  <label>
                    企业名称
                    <input
                      name="company"
                      required
                      maxLength={80}
                      placeholder="请输入企业完整名称"
                      autoComplete="organization"
                    />
                  </label>
                  <div className="form-columns">
                    <label>
                      联系人
                      <input
                        name="contact"
                        required
                        maxLength={30}
                        placeholder="您的姓名"
                        autoComplete="name"
                      />
                    </label>
                    <label>
                      联系电话
                      <input
                        name="phone"
                        type="tel"
                        required
                        pattern="1[0-9]{10}"
                        maxLength={11}
                        placeholder="11 位手机号"
                        autoComplete="tel"
                      />
                    </label>
                  </div>
                </>
              )}
              <PasswordInput
                label={mode === "register" ? "设置密码" : "密码"}
                minLength={mode === "login" ? 1 : 10}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                placeholder={
                  mode === "login" ? "请输入密码" : "至少 10 位，包含字母和数字"
                }
              />
              {mode === "register" && (
                <PasswordInput
                  label="确认密码"
                  name="confirm"
                  placeholder="再次输入密码"
                />
              )}
              <div className="captcha-field">
                <label htmlFor="auth-captcha">图片验证码</label>
                <div className="captcha-row">
                  <input
                    id="auth-captcha"
                    name="captcha"
                    value={code}
                    required
                    maxLength={6}
                    minLength={6}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="请输入 6 位数字"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    disabled={busy || captchaBusy}
                  />
                  <button
                    type="button"
                    className="captcha-image"
                    aria-label="刷新图片验证码"
                    disabled={busy || captchaBusy}
                    onClick={refreshCaptcha}
                  >
                    {challenge ? (
                      <img
                        src={challenge.image}
                        alt="图片验证码，请输入图中六位数字"
                      />
                    ) : (
                      <span>{captchaBusy ? "正在生成…" : "点击重试"}</span>
                    )}
                  </button>
                </div>
                <small>点击图片换一张 · 5 分钟有效</small>
                <ErrorBox>{captchaError}</ErrorBox>
              </div>
              <ErrorBox>{error}</ErrorBox>
              <Button
                className="primary full"
                loading={busy}
                disabled={!challenge || captchaBusy}
                type="submit"
              >
                {mode === "login" ? "登录账号" : "创建账号"}
                <ArrowRight size={19} />
              </Button>
            </form>
          )}
          {mode === "login" && !mfa && (
            <LoginExtras
              onResult={(r) => {
                if (r.mfaRequired) setMfa(r.challenge);
                else {
                  setCsrf(r.csrf);
                  onSuccess(r.user);
                }
              }}
            />
          )}
          {mode === "login" ? (
            <p className="auth-note">
              忘记密码？请联系大学生活动中心管理员核验身份并重置。
            </p>
          ) : (
            <p className="auth-note">
              注册创建的是企业账号。邮箱用作登录名，不代表邮箱已验证。
            </p>
          )}
          <div className="auth-bottom">
            <ShieldCheck size={16} />
            密码加密存储，账号信息仅用于场地服务。
          </div>
        </div>
        <small className="auth-copyright">华中科技大学 · 大学生活动中心</small>
      </section>
    </div>
  );
}

export function AccountPage({ user, onUser, onLogout, notify }) {
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  async function save(e) {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.currentTarget));
    setBusy("profile");
    setError("");
    try {
      const r = await api("/profile", { method: "PATCH", body: b });
      onUser(r.user);
      notify("企业资料已更新");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  async function password(e) {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.currentTarget));
    setError("");
    if (b.newPassword !== b.confirm) return setError("两次输入的新密码不一致");
    setBusy("password");
    try {
      await api("/auth/password", { method: "POST", body: b });
      notify("密码已修改，请重新登录");
      onLogout();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="account-layout">
      <section className="card account-profile">
        <div className="account-avatar">{user.company.slice(0, 1)}</div>
        <h2>{user.company}</h2>
        <p>{user.email}</p>
        <span className="subtle-tag">
          {user.role === "admin" ? "平台管理员" : "企业账号"}
        </span>
        <div className="account-meta">
          <span>
            注册日期<strong>{user.created.slice(0, 10)}</strong>
          </span>
          <span>
            账号状态<strong className="success-text">正常</strong>
          </span>
        </div>
        <Button className="secondary full" onClick={onLogout}>
          安全退出登录
        </Button>
      </section>
      <div className="account-forms">
        {!user.mustChangePassword && <Sessions notify={notify} />}
        {user.mfaRequired && (
          <ErrorBox>
            管理员账号须先开启两步验证，完成后即可使用业务功能。
          </ErrorBox>
        )}
        {!user.mustChangePassword && (
          <Mfa
            notify={notify}
            onChanged={() => api("/auth/session").then((r) => onUser(r.user))}
          />
        )}
        {!user.mustChangePassword && !user.mfaRequired && (
          <Identity notify={notify} />
        )}
        {user.mustChangePassword && (
          <ErrorBox>
            您正在使用临时密码，请先设置新密码，再继续使用业务功能。
          </ErrorBox>
        )}
        <ErrorBox>{error}</ErrorBox>
        {!user.mustChangePassword && (
          <section className="card">
            <div className="card-header">
              <div>
                <h2>企业资料</h2>
                <p>这些信息将自动填入新的布展申请。</p>
              </div>
            </div>
            <form className="card-form" onSubmit={save}>
              <label>
                企业名称
                <input
                  name="company"
                  required
                  maxLength={80}
                  defaultValue={user.company}
                />
              </label>
              <div className="form-columns">
                <label>
                  联系人
                  <input
                    name="contact"
                    required
                    maxLength={30}
                    defaultValue={user.contact}
                  />
                </label>
                <label>
                  联系电话
                  <input
                    name="phone"
                    type="tel"
                    pattern="1[0-9]{10}"
                    maxLength={11}
                    required
                    defaultValue={user.phone}
                  />
                </label>
              </div>
              <label>
                登录邮箱
                <input value={user.email} disabled readOnly />
              </label>
              <div className="form-actions">
                <Button className="primary" loading={busy === "profile"}>
                  保存资料
                </Button>
              </div>
            </form>
          </section>
        )}
        <section className="card">
          <div className="card-header">
            <div>
              <h2>账号安全</h2>
              <p>修改密码后，其他设备及当前会话都会退出。</p>
            </div>
            <ShieldCheck size={23} />
          </div>
          <form className="card-form" onSubmit={password}>
            <PasswordInput
              label="当前密码"
              name="currentPassword"
              autoComplete="current-password"
              minLength={1}
            />
            <div className="form-columns">
              <PasswordInput
                label="新密码"
                name="newPassword"
                placeholder="至少 10 位，包含字母和数字"
              />
              <PasswordInput label="确认新密码" name="confirm" />
            </div>
            <div className="form-actions">
              <Button className="primary" loading={busy === "password"}>
                更新密码
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
