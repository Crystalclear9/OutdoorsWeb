import React, { useState, useEffect } from "react";
import {
  MagnifyingGlass,
  Users,
  ShieldCheck,
  Plus,
  ArrowRight,
  CheckCircle,
  ClipboardText,
} from "@phosphor-icons/react";
import { api } from "./api.js";
import { PERMISSIONS } from "./permissions.js";
import { Button, ErrorBox, Empty, Modal } from "./components.jsx";
import { dateString, slotName, formatDate } from "./utils.js";

export function UsersPage({ notify }) {
  const [users, setUsers] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [modal, setModal] = useState(null),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      setUsers((await api("/users")).items);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function act() {
    setBusy(true);
    setError("");
    try {
      if (modal.type === "reset") {
        const r = await api(`/users/${modal.user.id}/reset-password`, {
          method: "POST",
          headers: { "If-Match": `"${modal.user.version}"` },
        });
        setModal({
          type: "password",
          password: r.temporaryPassword,
          email: modal.user.email,
        });
      } else {
        await api(`/users/${modal.user.id}/status`, {
          method: "POST",
          body: { disabled: !modal.user.disabled },
          headers: { "If-Match": `"${modal.user.version}"` },
        });
        setModal(null);
        notify("账号状态已更新");
      }
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const filtered = users.filter((u) =>
    `${u.email}${u.company}${u.contact}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>
              账号管理 <span className="count-badge">{users.length}</span>
            </h2>
            <p>管理企业账号的访问权限及密码恢复。</p>
          </div>
          <label className="search-input">
            <MagnifyingGlass size={18} />
            <input
              aria-label="搜索账号"
              placeholder="搜索企业名称或邮箱"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <ErrorBox>{error}</ErrorBox>
        {loading ? (
          <div className="loading-block">正在加载账号…</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>企业 / 邮箱</th>
                  <th>联系人</th>
                  <th>角色</th>
                  <th>账号状态</th>
                  <th>注册时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.company}</strong>
                      <small>{u.email}</small>
                    </td>
                    <td>
                      {u.contact}
                      <small>{u.phone || "未填写"}</small>
                    </td>
                    <td>{u.role === "admin" ? "管理员" : "企业"}</td>
                    <td>
                      <span
                        className={`status ${u.disabled ? "status-rejected" : "status-approved"}`}
                      >
                        <span />
                        {u.disabled
                          ? "已停用"
                          : u.mustChangePassword
                            ? "待修改密码"
                            : "正常"}
                      </span>
                    </td>
                    <td>{formatDate(u.created)}</td>
                    <td>
                      {u.role === "enterprise" ? (
                        <div className="row-actions">
                          <button
                            className="text-button"
                            onClick={() => {
                              setError("");
                              setModal({ type: "reset", user: u });
                            }}
                          >
                            重置密码
                          </button>
                          <button
                            className={`text-button ${!u.disabled ? "danger-text" : ""}`}
                            onClick={() => {
                              setError("");
                              setModal({ type: "status", user: u });
                            }}
                          >
                            {u.disabled ? "启用" : "停用"}
                          </button>
                        </div>
                      ) : (
                        <span className="muted">运维管理</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && (
              <Empty icon={Users} title="暂无匹配账号">
                试试其他企业名称或邮箱。
              </Empty>
            )}
          </div>
        )}
      </section>
      {modal && (
        <Modal
          title={
            modal.type === "password"
              ? "临时密码已生成"
              : modal.type === "reset"
                ? "重置企业账号密码"
                : modal.user.disabled
                  ? "启用账号"
                  : "停用账号"
          }
          onClose={() => setModal(null)}
        >
          {modal.type === "password" ? (
            <>
              <p className="body-copy">
                请通过已核验的联系方式，将临时密码交给 {modal.email}
                。密码只在此处显示一次，企业登录后必须修改。
              </p>
              <code className="temporary-password">{modal.password}</code>
              <div className="dialog-actions">
                <Button className="primary" onClick={() => setModal(null)}>
                  已妥善记录
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="body-copy">
                {modal.type === "reset"
                  ? `确认已核验 ${modal.user.company} 的身份？重置后，原密码和所有登录会话立即失效。`
                  : `${modal.user.disabled ? "启用后该企业可重新登录。" : "停用后该企业的所有登录会话立即失效，已有申请记录会保留。"} 企业：${modal.user.company}`}
              </p>
              <ErrorBox>{error}</ErrorBox>
              <div className="dialog-actions">
                <Button className="secondary" onClick={() => setModal(null)}>
                  取消
                </Button>
                <Button loading={busy} className="primary" onClick={act}>
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

export function ClosuresPage({ notify, onChange }) {
  const [items, setItems] = useState([]),
    [error, setError] = useState(""),
    [modal, setModal] = useState(null),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      setItems((await api("/closures")).items);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/closures", {
        method: "POST",
        body: Object.fromEntries(new FormData(e.currentTarget)),
      });
      setModal(null);
      await load();
      onChange();
      notify("暂停开放安排已保存");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await api(`/closures/${modal.id}`, { method: "DELETE" });
      setModal(null);
      await load();
      onChange();
      notify("该桁架位已恢复开放");
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
            <h2>场地开放安排</h2>
            <p>按日期暂停特定桁架位，已有预约的时段无法关闭。</p>
          </div>
          <Button
            className="primary"
            onClick={() => {
              setError("");
              setModal({ type: "create" });
            }}
          >
            <Plus size={18} />
            新增暂停安排
          </Button>
        </div>
        <ErrorBox>{!modal && error}</ErrorBox>
        {items.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>桁架位</th>
                  <th>暂停日期</th>
                  <th>暂停原因</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{slotName(c.slot)}</strong>
                    </td>
                    <td>
                      {c.start} 至 {c.end}
                    </td>
                    <td>{c.reason}</td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => {
                          setError("");
                          setModal({ type: "remove", id: c.id });
                        }}
                      >
                        恢复开放
                        <ArrowRight size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={CheckCircle} title="当前没有暂停安排">
            全部场地按正常预约流程开放。
          </Empty>
        )}
      </section>
      {modal && (
        <Modal
          title={modal.type === "create" ? "新增暂停开放安排" : "恢复开放"}
          onClose={() => setModal(null)}
        >
          {modal.type === "create" ? (
            <form onSubmit={save}>
              <label>
                桁架位置
                <select name="slot">
                  {Array.from({ length: 29 }, (_, i) => (
                    <option key={i} value={i + 1}>
                      {slotName(i + 1)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-columns">
                <label>
                  开始日期
                  <input
                    type="date"
                    name="start"
                    required
                    min={dateString()}
                    defaultValue={dateString()}
                  />
                </label>
                <label>
                  结束日期
                  <input
                    type="date"
                    name="end"
                    required
                    min={dateString()}
                    defaultValue={dateString()}
                  />
                </label>
              </div>
              <label>
                暂停原因
                <textarea
                  name="reason"
                  required
                  maxLength={200}
                  placeholder="例如：场地维护、校内活动占用"
                />
              </label>
              <ErrorBox>{error}</ErrorBox>
              <div className="dialog-actions">
                <Button className="primary" loading={busy}>
                  保存安排
                </Button>
              </div>
            </form>
          ) : (
            <>
              <p>确认移除此安排，恢复该时段的预约开放？</p>
              <ErrorBox>{error}</ErrorBox>
              <div className="dialog-actions">
                <Button className="secondary" onClick={() => setModal(null)}>
                  取消
                </Button>
                <Button className="primary" loading={busy} onClick={remove}>
                  恢复开放
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

const ACTIONS = {
  "access.staff_created": "创建工作人员",
  "access.denied": "拒绝越权或安全校验失败的请求",
  "access.permissions_changed": "变更业务授权",
  "account.session_revoked": "撤销登录会话",
  "account.other_sessions_revoked": "退出其他设备",
  "account.admin_created": "创建管理员",
  "account.admin_recovered": "恢复管理员账号",
  "account.registered": "企业注册",
  "account.login": "账号登录",
  "account.password_changed": "修改密码",
  "account.profile_updated": "更新企业资料",
  "account.disabled": "停用账号",
  "account.enabled": "启用账号",
  "account.password_reset": "重置密码",
  "booking.submitted": "提交申请",
  "booking.withdrawn": "撤回申请",
  "booking.approved": "审核通过",
  "booking.rejected": "审核未通过",
  "notice.deleted": "删除公告",
  "notice.saved": "保存公告",
  "venue.closed": "暂停场地开放",
  "venue.reopened": "恢复场地开放",
};
export function AuditPage() {
  const [items, setItems] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    api("/audit")
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>操作日志</h2>
          <p>记录最近 100 次账号及业务操作，便于追溯。</p>
        </div>
        <ShieldCheck size={24} />
      </div>
      <ErrorBox>{error}</ErrorBox>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>操作人</th>
              <th>操作内容</th>
              <th>关联记录</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td>{a.email || "系统"}</td>
                <td>
                  {ACTIONS[a.action] || a.action}
                  {a.action.startsWith("access.") && a.details !== "{}" && (
                    <small>
                      {(() => {
                        try {
                          const d = JSON.parse(a.details),
                            labels = (keys) =>
                              (keys || [])
                                .map(
                                  (k) =>
                                    PERMISSIONS.find((p) => p.key === k)
                                      ?.label || k,
                                )
                                .join("、") || "无";
                          return d.after
                            ? `${labels(d.before)} → ${labels(d.after)}`
                            : d.permissions
                              ? `授权：${labels(d.permissions)}`
                              : "";
                        } catch {
                          return "";
                        }
                      })()}
                    </small>
                  )}
                </td>
                <td className="monospace">{a.target}</td>
                <td>
                  {new Date(a.created).toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && !error && (
          <Empty icon={ClipboardText} title="暂无操作日志" />
        )}
      </div>
    </section>
  );
}
