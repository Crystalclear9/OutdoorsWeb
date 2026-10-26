import React, { useState, useEffect, useRef } from "react";
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
import { Button, ErrorBox, Empty, Modal, Pagination } from "./components.jsx";
import { dateString, slotName, formatDate } from "./utils.js";

export function UsersPage({ notify }) {
  const request = useRef(0);
  const [page, setPage] = useState(1),
    [pagination, setPagination] = useState({ pages: 1, total: 0 });
  const [users, setUsers] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [modal, setModal] = useState(null),
    [busy, setBusy] = useState(false),
    [resultKey, setResultKey] = useState("");
  const criteriaKey = JSON.stringify([page, query]);
  const ready = !loading && !error && resultKey === criteriaKey;
  const criteria = useRef({ page, query });
  criteria.current = { page, query };
  async function load() {
    const id = ++request.current;
    setLoading(true);
    setError("");
    try {
      const current = criteria.current;
      const r = await api(
        `/users?page=${current.page}&q=${encodeURIComponent(current.query)}`,
      );
      if (id !== request.current) return;
      if (current.page > r.pages) {
        setPage(r.pages);
        return;
      }
      setUsers(r.items);
      setPagination(r);
      setResultKey(JSON.stringify([current.page, current.query]));
      setError("");
    } catch (e) {
      if (id === request.current) setError(e.message);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(load, 180);
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [query, page]);
  async function act() {
    if (busy) return;
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
  function open(type, user) {
    if (!ready || busy) return;
    setError("");
    setModal({ type, user });
  }
  const filtered = users;
  return (
    <>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>
              账号管理{" "}
              <span className="count-badge">
                {ready ? pagination.total : "—"}
              </span>
            </h2>
            <p>管理企业账号的访问权限及密码恢复。</p>
          </div>
          <div className="row-actions">
            <label className="search-input">
              <MagnifyingGlass size={18} />
              <input
                aria-label="搜索账号"
                placeholder="搜索企业名称或邮箱"
                value={query}
                disabled={busy}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <Button
              className="secondary small"
              disabled={loading || busy}
              onClick={load}
            >
              刷新账号
            </Button>
          </div>
        </div>
        <ErrorBox>{error}</ErrorBox>
        {!ready ? (
          <div className="loading-block">
            {error
              ? "账号读取失败，请刷新重试；未显示旧筛选结果。"
              : "正在加载账号…"}
          </div>
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
                            disabled={busy || !ready}
                            onClick={() => open("reset", u)}
                          >
                            重置密码
                          </button>
                          <button
                            className={`text-button ${!u.disabled ? "danger-text" : ""}`}
                            disabled={busy || !ready}
                            onClick={() => open("status", u)}
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
      <fieldset
        disabled={!ready || busy}
        style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
      >
        <Pagination
          page={page}
          pages={pagination.pages}
          total={pagination.total}
          onPage={setPage}
        />
      </fieldset>
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
          onClose={() => !busy && setModal(null)}
        >
          {modal.type === "password" ? (
            <>
              <p className="body-copy">
                请通过已核验的联系方式，将临时密码交给 {modal.email}
                。密码只在此处显示一次，企业登录后必须修改。
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
          ) : (
            <>
              <p className="body-copy">
                {modal.type === "reset"
                  ? `确认已核验 ${modal.user.company} 的身份？重置后，原密码和所有登录会话立即失效。`
                  : `${modal.user.disabled ? "启用后该企业可重新登录。" : "停用后该企业的所有登录会话立即失效，已有申请记录会保留。"} 企业：${modal.user.company}`}
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

const ACTIONS = {
  "account.external_registered": "通过快捷登录创建企业账号",
  "account.mfa_requested": "密码验证通过，等待两步验证",
  "account.mfa_enabled": "开启两步验证",
  "account.mfa_disabled": "关闭两步验证",
  "account.mfa_login": "完成两步验证登录",
  "account.mfa_recovered": "运维恢复两步验证",
  "account.phone_linked": "验证并绑定手机号",
  "account.sms_login": "手机号验证通过",
  "account.oauth_login": "第三方身份验证通过",
  "account.oauth_linked": "绑定第三方账号",
  "account.oauth_unlinked": "解除第三方绑定",
  "account.notification_preferences": "更新结果通知偏好",
  "booking.reschedule_requested": "申请改期",
  "booking.rescheduled": "批准改期并替换原预约",
  "venue.onsite_updated": "更新现场摆放登记",
  "delivery.reconciled": "人工核实通知发送结果",
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
  "booking.cancelled": "取消已通过预约",
  "maintenance.requested": "手动启动备份与清理",
  "notice.deleted": "删除公告",
  "notice.saved": "保存公告",
  "venue.closed": "暂停场地开放",
  "venue.reopened": "恢复场地开放",
};
export function AuditPage() {
  const [page, setPage] = useState(1),
    [query, setQuery] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [pagination, setPagination] = useState({ pages: 1, total: 0 });
  const [items, setItems] = useState([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [resultKey, setResultKey] = useState("");
  const rangeError = from && to && from > to ? "日志日期范围无效" : "";
  const criteriaKey = JSON.stringify([page, query, from, to, revision]);
  const ready = !loading && !error && !rangeError && resultKey === criteriaKey;
  useEffect(() => {
    let active = true;
    if (rangeError) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    api(
      `/audit?page=${page}&q=${encodeURIComponent(query)}&from=${from}&to=${to}`,
    )
      .then((r) => {
        if (active) {
          if (page > r.pages) {
            setPage(r.pages);
            return;
          }
          setItems(r.items);
          setPagination(r);
          setResultKey(criteriaKey);
          setError("");
        }
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [page, query, from, to, revision, rangeError]);
  function download() {
    if (!ready || !items.length) return;
    const cell = (v) =>
      '"' +
      String(v ?? "")
        .replace(/^[=+@\-\t\r]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    const csv =
      "\ufeff" +
      [
        ["操作人", "操作内容", "关联记录", "时间", "详情"],
        ...items.map((a) => [
          a.email || "系统",
          ACTIONS[a.action] || a.action,
          a.target,
          a.created,
          a.details,
        ]),
      ]
        .map((row) => row.map(cell).join(","))
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `审计日志-第${page}页.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>操作日志</h2>
          <p>按日期、操作代码、邮箱或关联编号查询历史记录。</p>
        </div>
        <div className="row-actions">
          <Button
            className="secondary small"
            disabled={loading || !!rangeError}
            onClick={() => setRevision((value) => value + 1)}
          >
            刷新日志
          </Button>
          <Button
            className="secondary small"
            disabled={!ready || !items.length}
            onClick={download}
          >
            导出本页
          </Button>
        </div>
      </div>
      <div className="audit-filters">
        <input
          aria-label="搜索操作日志"
          placeholder="操作代码、邮箱或申请编号"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        <label>
          起始日期
          <input
            aria-label="日志起始日期"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          结束日期
          <input
            aria-label="日志结束日期"
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      <ErrorBox>{rangeError || error}</ErrorBox>
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
            {(ready ? items : []).map((a) => (
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
        {ready && !items.length && (
          <Empty icon={ClipboardText} title="暂无操作日志" />
        )}
        {!ready && (
          <p className="loading-block">
            {rangeError
              ? "请调整日期范围后查询，未显示旧筛选结果。"
              : error
                ? "未能读取最新日志，请刷新重试；未显示旧筛选结果。"
                : "正在读取操作日志…"}
          </p>
        )}
      </div>
      <fieldset disabled={!ready} style={{ border: 0, margin: 0, padding: 0 }}>
        <Pagination
          page={page}
          pages={pagination.pages}
          total={pagination.total}
          onPage={setPage}
        />
      </fieldset>
    </section>
  );
}
