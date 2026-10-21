import React, { useState, useEffect } from "react";
import { Plus, ShieldCheck, Key } from "@phosphor-icons/react";
import { api } from "./api.js";
import { PERMISSIONS } from "./permissions.js";
import { Button, Modal, ErrorBox, PasswordInput } from "./components.jsx";

export default function Access({ notify }) {
  const [items, setItems] = useState([]),
    [error, setError] = useState(""),
    [modal, setModal] = useState(null),
    [busy, setBusy] = useState(false),
    [grants, setGrants] = useState([]);
  async function load() {
    try {
      setItems((await api("/access")).items);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  function open(type, user) {
    if (busy) return;
    setError("");
    setGrants(user?.permissions || []);
    setModal({ type, user });
  }
  async function save(e) {
    e.preventDefault();
    if (busy) return;
    const data = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError("");
    try {
      const edit = modal.type === "edit",
        r = await api(edit ? `/access/${modal.user.id}` : "/access/staff", {
          method: edit ? "PATCH" : "POST",
          headers: edit ? { "If-Match": `"${modal.user.version}"` } : {},
          body: { ...data, permissions: grants },
        });
      if (edit) {
        setModal(null);
        notify("授权已更新，该账号的所有登录已撤销，需重新登录");
      } else
        setModal({
          type: "password",
          password: r.temporaryPassword,
          email: r.user.email,
        });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function accountAction() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const u = modal.user,
        reset = modal.type === "reset",
        r = await api(`/users/${u.id}/${reset ? "reset-password" : "status"}`, {
          method: "POST",
          headers: { "If-Match": `"${u.version}"` },
          ...(reset ? {} : { body: { disabled: !u.disabled } }),
        });
      if (reset)
        setModal({
          type: "password",
          password: r.temporaryPassword,
          email: u.email,
        });
      else {
        setModal(null);
        notify("管理员状态已更新");
      }
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>管理员授权</h2>
            <p>按职责分配业务权限。授权变更后，该账号需重新登录。</p>
          </div>
          <Button className="primary" onClick={() => open("create")}>
            <Plus size={18} />
            新增管理员
          </Button>
        </div>
        <ErrorBox>{!modal && error}</ErrorBox>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>管理员</th>
                <th>授权范围</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.contact}</strong>
                    <small>{u.email}</small>
                  </td>
                  <td>
                    <div className="permission-tags">
                      {u.isSuperAdmin ? (
                        <span className="subtle-tag">
                          超级管理员 · 全部权限
                        </span>
                      ) : u.permissions.length ? (
                        PERMISSIONS.filter((p) =>
                          u.permissions.includes(p.key),
                        ).map((p) => (
                          <span className="subtle-tag" key={p.key}>
                            {p.label}
                          </span>
                        ))
                      ) : (
                        <span className="muted">尚未授予业务权限</span>
                      )}
                    </div>
                  </td>
                  <td>
                    {u.disabled
                      ? "已停用"
                      : u.mustChangePassword
                        ? "待修改临时密码"
                        : "正常"}
                  </td>
                  <td>
                    {u.isSuperAdmin ? (
                      <span className="muted">受保护账号</span>
                    ) : (
                      <div className="row-actions">
                        <button
                          className="text-button"
                          onClick={() => open("edit", u)}
                        >
                          调整授权
                        </button>
                        <button
                          className="text-button"
                          onClick={() => open("reset", u)}
                        >
                          重置密码
                        </button>
                        <button
                          className="text-button"
                          onClick={() => open("status", u)}
                        >
                          {u.disabled ? "启用" : "停用"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {modal && (
        <Modal
          title={
            modal.type === "password"
              ? "请妥善交付临时密码"
              : modal.type === "create"
                ? "创建并授权管理员"
                : modal.type === "edit"
                  ? "调整管理员权限"
                  : modal.type === "reset"
                    ? "重置管理员密码"
                    : modal.user.disabled
                      ? "启用管理员"
                      : "停用管理员"
          }
          onClose={() => !busy && setModal(null)}
        >
          {modal.type === "password" ? (
            <>
              <p className="body-copy">
                {modal.email}{" "}
                首次登录必须修改临时密码。请通过核验后的渠道交付，此密码只显示一次。
              </p>
              <code className="temporary-password">{modal.password}</code>
              <div className="dialog-actions">
                <Button
                  className="primary"
                  disabled={busy}
                  onClick={() => setModal(null)}
                >
                  已妥善记录
                </Button>
              </div>
            </>
          ) : ["create", "edit"].includes(modal.type) ? (
            <form onSubmit={save}>
              {modal.type === "create" ? (
                <>
                  <label>
                    管理员姓名
                    <input required name="contact" maxLength={30} />
                  </label>
                  <label>
                    登录邮箱
                    <input required type="email" name="email" maxLength={254} />
                  </label>
                </>
              ) : (
                <p className="body-copy">
                  正在为 {modal.user.email} 分配权限。
                </p>
              )}
              <fieldset className="grant-options">
                <legend>业务权限</legend>
                {PERMISSIONS.map((p) => (
                  <label key={p.key}>
                    <input
                      type="checkbox"
                      checked={grants.includes(p.key)}
                      onChange={(e) =>
                        setGrants((v) =>
                          e.target.checked
                            ? [...v, p.key]
                            : v.filter((k) => k !== p.key),
                        )
                      }
                    />
                    <span>
                      <strong>{p.label}</strong>
                      <small>{p.description}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <PasswordInput
                label="输入您当前的密码以确认授权"
                name="currentPassword"
                minLength={1}
                autoComplete="current-password"
              />
              <ErrorBox>{error}</ErrorBox>
              <div className="dialog-actions">
                <Button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setModal(null)}
                >
                  取消
                </Button>
                <Button className="primary" loading={busy}>
                  <ShieldCheck size={18} />
                  {modal.type === "create" ? "创建并授权" : "保存授权"}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <p className="body-copy">
                {modal.type === "reset"
                  ? "确认已核验管理员身份？重置后原密码及全部登录会话立即失效。"
                  : "更新账号状态后，该账号的访问权限将同步生效，停用会撤销全部登录会话。"}
              </p>
              <ErrorBox>{error}</ErrorBox>
              <div className="dialog-actions">
                <Button
                  className="secondary"
                  disabled={busy}
                  onClick={() => setModal(null)}
                >
                  取消
                </Button>
                <Button
                  className="primary"
                  loading={busy}
                  onClick={accountAction}
                >
                  确认操作
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
