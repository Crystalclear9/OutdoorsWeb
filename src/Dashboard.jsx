import React, { useState, useEffect } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  ClipboardText,
  Clock,
  CheckCircle,
  Megaphone,
  MapTrifold,
  ShieldCheck,
  Buildings,
} from "@phosphor-icons/react";
import { api } from "./api.js";
import { Button, Empty, ErrorBox, Status } from "./components.jsx";
import { BookingDetail } from "./Booking.jsx";
import { slotName } from "./utils.js";
import { can } from "./permissions.js";

export default function Dashboard({
  user,
  counts,
  notices,
  connected,
  version,
  onNavigate,
  onApply,
  onRefresh,
  notify,
}) {
  const [items, setItems] = useState([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [detail, setDetail] = useState(null);
  const admin = can(user, "bookings.review"),
    staff = user?.role === "admin",
    publishing = can(user, "notices.manage"),
    total = Object.values(counts).reduce((a, b) => a + b, 0);
  useEffect(() => {
    let active = true;
    if (!user || user.mustChangePassword || (staff && !admin)) {
      setItems([]);
      return;
    }
    setLoading(true);
    api(
      `/bookings?page=1${admin ? "&status=" + encodeURIComponent("待审核") : ""}`,
    )
      .then((r) => {
        if (active) {
          setItems(r.items.slice(0, 5));
          setError("");
        }
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [user?.id, user?.mustChangePassword, admin, version]);
  const metrics =
    user && (!staff || admin)
      ? [
          [admin ? "待处理申请" : "我的待审核", counts["待审核"] || 0, Clock],
          ["已通过", counts["已通过"] || 0, CheckCircle],
          ["需调整申请", counts["未通过"] || 0, ClipboardText],
          [admin ? "累计申报" : "我的申请总数", total, Buildings],
        ]
      : [];
  return (
    <div className="dashboard">
      <section className="workspace-welcome">
        <div>
          <span className="section-kicker">
            {staff ? "管理员工作空间" : user ? "企业工作空间" : "校园布展服务"}
          </span>
          <h2>
            {staff && !admin
              ? `${user.contact}，按职责开展工作。`
              : admin
                ? "先处理待办，再安排新的活动。"
                : user
                  ? `${user.contact}，欢迎回来。`
                  : "从了解场地，到有序开展。"}
          </h2>
          <p>
            {staff && !admin
              ? "您的账号仅可使用已授权功能，菜单将按职责显示。"
              : admin
                ? `当前有 ${counts["待审核"] || 0} 条申请等待审核。您也可以直接发布活动通知。`
                : user
                  ? "在这里跟进申请进度、查看审核意见和最新通知。"
                  : "先查看开放位置与预约须知，登录企业账号后即可提交申请。"}
          </p>
        </div>
        <div className="workspace-actions">
          <Button
            className="primary"
            disabled={!connected}
            onClick={() =>
              admin
                ? onNavigate("records")
                : staff
                  ? onNavigate(
                      publishing
                        ? "notices"
                        : can(user, "venue.manage")
                          ? "closures"
                          : can(user, "accounts.manage")
                            ? "users"
                            : can(user, "audit.read")
                              ? "audit"
                              : "account",
                    )
                  : onApply()
            }
          >
            {admin
              ? "处理企业申请"
              : staff
                ? publishing
                  ? "编写通知公告"
                  : "打开已授权功能"
                : "发起布展申请"}
            <ArrowRight size={18} />
          </Button>
          <button
            className="text-button"
            onClick={() => onNavigate(publishing ? "notices" : "venue")}
          >
            {publishing ? "发布活动通知" : "查看可预约场地"}
            <ArrowUpRight size={17} />
          </button>
        </div>
      </section>
      {!!metrics.length && (
        <div className="dashboard-metrics">
          {metrics.map(([title, value, Icon]) => (
            <button
              key={title}
              className="card"
              onClick={() => onNavigate("records")}
            >
              <Icon size={24} />
              <span>
                {title}
                <strong>
                  {value}
                  <small>条</small>
                </strong>
              </span>
              <ArrowUpRight size={17} />
            </button>
          ))}
        </div>
      )}
      <div className="dashboard-grid">
        <section className="card dashboard-applications">
          <div className="card-header">
            <div>
              <h2>
                {admin
                  ? "待办申请"
                  : staff
                    ? "已授权工作"
                    : user
                      ? "最近的申请"
                      : "预约办理指引"}
              </h2>
              <p>
                {admin
                  ? "优先处理待审核申请，审核结果直接同步至企业。"
                  : user
                    ? "最近 5 条申请，查看状态或进入详情。"
                    : "提前准备材料，让申请一次更顺畅。"}
              </p>
            </div>
            {user && (
              <button
                className="text-button"
                onClick={() => onNavigate("records")}
              >
                全部申请
                <ArrowRight size={16} />
              </button>
            )}
          </div>
          <ErrorBox>{error}</ErrorBox>
          {!user ? (
            <div className="guest-workflow">
              {[
                ["01", "查询场地", "按日期查看桁架开放情况，选择合适位置。"],
                ["02", "准备申报", "填写企业资料，准备清晰的桁架设计图。"],
                ["03", "提交审核", "最长申请 3 天，在申请记录中跟进结果。"],
              ].map(([n, t, c]) => (
                <div key={n}>
                  <span>{n}</span>
                  <div>
                    <h3>{t}</h3>
                    <p>{c}</p>
                  </div>
                </div>
              ))}
              <Button className="secondary" onClick={() => onNavigate("venue")}>
                进入场地查询
                <MapTrifold size={18} />
              </Button>
            </div>
          ) : staff && !admin ? (
            <Empty icon={ShieldCheck} title="按职责处理工作">
              请从左侧菜单进入已授权业务。需要其他权限时，请联系超级管理员。
            </Empty>
          ) : loading ? (
            <div className="loading-block">正在加载申请…</div>
          ) : items.length ? (
            <div className="dashboard-rows">
              {items.map((b) => (
                <button key={b.id} onClick={() => setDetail(b)}>
                  <span className="dashboard-row-icon">
                    <ClipboardText size={22} />
                  </span>
                  <div>
                    <strong>{b.company}</strong>
                    <small>
                      {slotName(b.slot)} · {b.start} 至 {b.end}
                    </small>
                    {b.reason && <p>{b.reason}</p>}
                  </div>
                  <Status value={b.status} />
                  <ArrowRight size={17} />
                </button>
              ))}
            </div>
          ) : (
            <Empty
              icon={admin ? CheckCircle : ClipboardText}
              title={admin ? "待办已处理完毕" : "还没有提交申请"}
            >
              {admin
                ? "新的企业申请会出现在这里。"
                : "先到场地查询选择位置，再提交布展申请。"}
            </Empty>
          )}
        </section>
        <section className="card dashboard-announcements">
          <div className="card-header">
            <div>
              <h2>最新公告</h2>
              <p>活动安排与场地服务通知。</p>
            </div>
            <Megaphone size={22} />
          </div>
          {notices.length ? (
            <div className="dashboard-notices">
              {notices.slice(0, 3).map((n) => (
                <button key={n.id} onClick={() => onNavigate("notices")}>
                  <strong>
                    {!!n.pinned && <span className="pin-tag">置顶</span>}
                    {n.title}
                  </strong>
                  <p>{n.content.slice(0, 85)}</p>
                  <small>{n.created.slice(0, 10)}</small>
                </button>
              ))}
            </div>
          ) : (
            <p className="quiet-empty">
              {connected ? "暂无已发布公告。" : "公告服务尚未连接。"}
            </p>
          )}
          <div className="dashboard-notice-footer">
            <Button
              className={publishing ? "primary" : "secondary"}
              onClick={() => onNavigate("notices")}
            >
              {publishing ? "编写并发布公告" : "查看全部公告"}
              <ArrowUpRight size={17} />
            </Button>
          </div>
        </section>
      </div>
      <div className="workspace-shortcuts">
        <button onClick={() => onNavigate("venue")}>
          <MapTrifold size={25} />
          <span>
            <strong>场地查询</strong>
            <small>按日期查看原图位置和开放状态</small>
          </span>
          <ArrowRight size={18} />
        </button>
        {user && (
          <button onClick={() => onNavigate("account")}>
            <ShieldCheck size={25} />
            <span>
              <strong>账号与企业资料</strong>
              <small>维护联系人资料与账号安全</small>
            </span>
            <ArrowRight size={18} />
          </button>
        )}
        {can(user, "venue.manage") && (
          <button onClick={() => onNavigate("closures")}>
            <Clock size={25} />
            <span>
              <strong>场地开放安排</strong>
              <small>维护暂停时间与恢复开放</small>
            </span>
            <ArrowRight size={18} />
          </button>
        )}
      </div>
      {detail && (
        <BookingDetail
          item={detail}
          user={user}
          onClose={() => setDetail(null)}
          onSaved={(message) => {
            setDetail(null);
            onRefresh();
            notify(message);
          }}
        />
      )}
    </div>
  );
}
