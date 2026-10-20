import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { Button, ErrorBox, PasswordInput } from "./components.jsx";

export default function ExternalSignup({ proof, onSuccess, onCancel }) {
  const [info, setInfo] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api("/auth/signup/inspect", { method: "POST", body: { proof } })
      .then((r) => {
        if (active) setInfo(r);
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [proof]);
  async function submit(e) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    setError("");
    if (values.password !== values.confirm)
      return setError("两次输入的密码不一致");
    setBusy(true);
    try {
      onSuccess(
        await api("/auth/signup/complete", {
          method: "POST",
          body: { ...values, proof, confirmed: values.confirmed === "on" },
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="external-signup-form">
      <h3>补齐企业资料</h3>
      <p className="field-note">
        {info
          ? { sms: "手机号", qq: "QQ", wechat: "微信" }[info.provider] +
            "已验证。填写企业资料后即可创建企业账号。"
          : "正在核实登录凭据…"}
        已有邮箱账号请返回登录，再在账号设置中绑定，避免重复建号。
      </p>
      <ErrorBox>{error}</ErrorBox>
      {info && (
        <>
          <label>
            登录邮箱
            <input
              name="email"
              type="email"
              maxLength={254}
              required
              autoComplete="username"
            />
          </label>
          <label>
            企业名称
            <input
              name="company"
              maxLength={80}
              required
              autoComplete="organization"
            />
          </label>
          <div className="form-columns">
            <label>
              联系人
              <input
                name="contact"
                maxLength={30}
                required
                autoComplete="name"
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
                defaultValue={info.phone}
                readOnly={!!info.phone}
                autoComplete="tel"
              />
            </label>
          </div>
          <PasswordInput
            label="设置密码"
            name="password"
            autoComplete="new-password"
            placeholder="至少 10 位，包含字母和数字"
          />
          <PasswordInput
            label="确认密码"
            name="confirm"
            autoComplete="new-password"
          />
          <label className="check-label">
            <input name="confirmed" type="checkbox" required />
            我确认企业资料真实，同意创建企业账号。
          </label>
          <Button className="primary full" loading={busy} type="submit">
            完成资料并进入工作台
          </Button>
        </>
      )}
      <Button className="secondary full" disabled={busy} onClick={onCancel}>
        返回账号登录
      </Button>
    </form>
  );
}
