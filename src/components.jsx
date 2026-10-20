import React, { useState, useEffect, useId } from "react";
import { createPortal } from "react-dom";
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
import universitySignature from "./assets/hust-signature.png";

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
  const titleId = useId(),
    descId = useId();
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <>
      <div className="dialog-overlay" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className={`dialog-content ${wide ? "dialog-wide" : ""}`}
      >
        <div className="dialog-heading">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p id={descId}>{description || "请核对信息后操作。"}</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={22} />
          </button>
        </div>
        {children}
      </div>
    </>,
    document.body,
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
      <img className="university-signature" src={universitySignature} alt="华中科技大学" />
      <span className="brand-service">大学生活动中心<small>户外广场布展预约</small></span>
    </div>
  );
}

export function AuthPage({ initialMode = "login", onSuccess, onBack }) {
  const [mode, setMode] = useState(initialMode),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.currentTarget));
    setError("");
    if (mode === "register" && b.password !== b.confirm)
      return setError("两次输入的密码不一致");
    setBusy(true);
    try {
      const result = await api(`/auth/${mode}`, { method: "POST", body: b });
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
          <span className="section-kicker">华中科技大学 · 公共空间预约平台</span>
          <h1>
            户外广场
            <br />
            布展预约
          </h1>
          <p>
            查询场地，提交布展申请。
            <br />
            登录后查看申请与审核结果。
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
          华中科技大学 · 大学生活动中心
        </div>
      </section>
      <section className="auth-form-side">
        <button className="text-button back-link" onClick={onBack}>
          <ArrowLeft size={17} />
          返回场地浏览
        </button>
        <div className="auth-form-wrap">
          <span className="section-kicker">
            {mode === "login" ? "欢迎回来" : "企业账号注册"}
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
            <ErrorBox>{error}</ErrorBox>
            <Button className="primary full" loading={busy} type="submit">
              {mode === "login" ? "登录账号" : "创建账号"}
              <ArrowRight size={19} />
            </Button>
          </form>
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
