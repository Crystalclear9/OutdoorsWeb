import React, { useState, useEffect } from "react";
import {
  MapTrifold,
  ClipboardText,
  Megaphone,
  ArrowRight,
  ArrowUpRight,
  Plus,
  CaretRight,
  ShieldCheck,
  Users,
  UserCircle,
  SignOut,
  List,
  MapPin,
  CalendarBlank,
  CheckCircle,
  ArrowsClockwise,
  Question,
  WarningCircle,
} from "@phosphor-icons/react";
import { previewAvailable, previewRole, previewRoles } from "./preview.js";
import { api, setCsrf } from "./api.js";
import { dateString, slotName, zoneName } from "./utils.js";
import { Button, Brand, Modal, AuthPage, AccountPage } from "./components.jsx";
import { BookingForm } from "./Booking.jsx";
import { UsersPage, ClosuresPage, AuditPage } from "./Admin.jsx";
import VenueMap from "./VenueMap.jsx";
import Records from "./Records.jsx";
import Notices from "./Notices.jsx";
import Access from "./Access.jsx";
import { can } from "./permissions.js";
import { VENUE_SEGMENTS, inSegment } from "./venue-layout.js";

const titles = {
  venue: ["户外广场布展预约", "选择日期与区域，查看桁架位置及开放状态。"],
  records: ["我的申请", "查看布展申请进度与审核意见。"],
  notices: ["通知公告", "场地使用说明、活动安排与服务通知。"],
  account: ["账号设置", "维护企业资料、登录密码与设备。"],
  users: ["账号管理", "管理企业账号、访问状态与密码恢复。"],
  closures: ["场地开放安排", "设置桁架暂停时段与恢复日期。"],
  access: ["工作人员授权", "分配业务职责与管理权限。"],
  audit: ["操作日志", "查询账号及业务操作记录。"],
};
export default function App() {
  const [user, setUser] = useState(null),
    [sessionLoading, setSessionLoading] = useState(true),
    [connected, setConnected] = useState(false),
    [serviceError, setServiceError] = useState(""),
    [auth, setAuth] = useState(null),
    [page, setPage] = useState("venue"),
    [mobile, setMobile] = useState(false),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState("");
  const [date, setDate] = useState(dateString()),
    [zone, setZone] = useState("all"),
    [selected, setSelected] = useState(1),
    [view, setView] = useState("map"),
    [venue, setVenue] = useState({ occupied: [], closed: [], total: 29 }),
    [notices, setNotices] = useState([]),
    [counts, setCounts] = useState({}),
    [version, setVersion] = useState(0);
  const admin = user?.role === "admin";
  const refresh = () => setVersion((v) => v + 1);
  const notify = (message) => setToast(message);
  const changeZone = (value) => {
    setZone(value);
    if (!inSegment(selected, value)) {
      setSelected(VENUE_SEGMENTS.find((s) => s.id === value)?.first || 1);
    }
  };
  const go = (p) => {
    setPage(user?.mustChangePassword ? "account" : p);
    setMobile(false);
  };
  useEffect(() => {
    let active = true;
    api("/auth/session")
      .then((r) => {
        if (active) {
          setCsrf(r.csrf);
          setUser(r.user);
          if (r.user?.mustChangePassword) setPage("account");
        }
      })
      .catch((e) => active && setServiceError(e.message))
      .finally(() => active && setSessionLoading(false));
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([
      api(`/venue?date=${date}`),
      api("/notices"),
    ])
      .then(([v, n]) => {
        if (active) {
          setVenue(v);
          setNotices(n.items);
          setConnected(true);
          setServiceError("");
        }
      })
      .catch((e) => {
        if (active) {
          setConnected(false);
          setServiceError(e.message);
        }
      });
    return () => {
      active = false;
    };
  }, [date, version, page]);
  useEffect(() => {
    if (
      user &&
      !user.mustChangePassword &&
      (user.role === "enterprise" || can(user, "bookings.review"))
    )
      api("/summary")
        .then((r) => setCounts(r.counts))
        .catch((e) => notify(e.message));
    else setCounts({});
  }, [user, version]);
  useEffect(() => {
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const fn = () => {
      setUser(null);
      setCsrf(null);
      setPage("venue");
      setModal(null);
      notify("登录已失效，请重新登录");
    };
    window.addEventListener("session-expired", fn);
    return () => window.removeEventListener("session-expired", fn);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  async function logout() {
    if (previewRole) { switchPreview("guest"); return; }
    try {
      await api("/auth/logout", { method: "POST" });
      setUser(null);
      setCsrf(null);
      setModal(null);
      setCounts({});
      setAuth("login");
      setPage("venue");
      refresh();
    } catch (e) {
      notify(e.message);
    }
  }
  function beginBooking() {
    if (!connected) {
      notify("服务暂不可用，请稍后重试");
      return;
    }
    if (!user) {
      setAuth("login");
      return;
    }
    if (user.mustChangePassword) {
      go("account");
      return;
    }
    if (admin) {
      go(can(user, "bookings.review") ? "records" : "venue");
      return;
    }
    setModal({ type: "booking" });
  }
  function onAuth(u) {
    setUser(u);
    setAuth(null);
    setPage(u.mustChangePassword ? "account" : "venue");
    refresh();
    notify("登录成功");
  }
  function switchPreview(role) {
    // Reloading unmounts all role-specific state and prevents stale responses
    // from the prior identity being displayed in the next preview.
    const url = new URL(location.href);
    if (role) url.searchParams.set("preview", role);
    else url.searchParams.delete("preview");
    location.assign(url.href);
  }
  const nav = [
    ["venue", "场地查询", MapTrifold],
    ...(user?.role === "enterprise" || can(user, "bookings.review")
      ? [["records", admin ? "企业申报审核" : "我的申请", ClipboardText]]
      : []),
    ["notices", "通知公告", Megaphone],
    ...(can(user, "venue.manage")
      ? [["closures", "场地开放安排", CalendarBlank]]
      : []),
    ...(can(user, "accounts.manage") ? [["users", "账号管理", Users]] : []),
    ...(can(user, "audit.read") ? [["audit", "操作日志", ShieldCheck]] : []),
    ...(user?.isSuperAdmin ? [["access", "授权管理", ShieldCheck]] : []),
  ];
  const busy = venue.occupied.find((b) => b.slot === selected),
    closed = venue.closed.find((b) => b.slot === selected);
  if (auth)
    return (
      <>
        <AuthPage
          initialMode={auth}
          onSuccess={onAuth}
          onBack={() => setAuth(null)}
        />
        {toast && (
          <div className="toast" role="status">
            <CheckCircle size={20} />
            {toast}
          </div>
        )}
      </>
    );
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-left">
            <button
              className="mobile-toggle icon-button"
              aria-label="打开导航"
              aria-expanded={mobile}
              aria-controls="workspace-navigation"
              onClick={() => setMobile(!mobile)}
            >
              <List size={22} />
            </button>
            <a
              href="#"
              className="brand-link"
              onClick={(e) => {
                e.preventDefault();
                go("venue");
              }}
            >
              <Brand />
            </a>
            <span className="breadcrumb">
              校园服务
              <CaretRight size={13} />
              <strong>
                {page === "account"
                  ? "账号设置"
                  : nav.find((n) => n[0] === page)?.[1]}
              </strong>
            </span>
          </div>
          <aside id="workspace-navigation" className={`sidebar ${mobile ? "is-open" : ""}`}>
            <div className="workspace-label">户外广场布展预约</div>
            <div className="nav-heading">工作空间</div>
            <nav>
              {nav.map(([id, label, Icon]) => (
                <button
                  key={id}
                  aria-label={label}
                  aria-current={page === id ? "page" : undefined}
                  className={page === id ? "selected" : ""}
                  onClick={() => go(id)}
                >
                  <Icon size={18} weight={page === id ? "fill" : "regular"} />
                  <span>{label}</span>
                  {id === "records" && !!counts["待审核"] && (
                    <b aria-hidden="true">{counts["待审核"]}</b>
                  )}
                </button>
              ))}
            </nav>
            <div className="sidebar-support">
              <button
                className="text-button"
                onClick={() => setModal({ type: "help" })}
              >
                <Question size={16} />
                查看使用指南
              </button>
            </div>
          </aside>
          <div className="topbar-actions">
            <span className="today">
              <CalendarBlank size={15} />
              {dateString().replaceAll("-", " / ")}
            </span>
            <button
              className="text-button guide-trigger"
              onClick={() => setModal({ type: "help" })}
            >
              预约须知
            </button>
      {previewAvailable && (
        <div className="identity-preview" title={previewRole ? "示例数据，仅供页面预览" : "切换查看各身份页面"}>
          <label htmlFor="preview-identity">身份预览</label>
          <select id="preview-identity" value={previewRole} onChange={(e) => switchPreview(e.target.value)}>
            <option value="">真实账号</option>
            {previewRoles.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          {previewRole && <small className="preview-badge">示例</small>}
        </div>
      )}
            {user ? (
              <div className="user-bar">
                <button className="account-link" onClick={() => go("account")}>
                  <span className="avatar small">{user.company.slice(0, 1)}</span>
                  <span>{user.contact || "管理员"}</span>
                </button>
                <button
                  className="logout-button"
                  aria-label="退出登录"
                  onClick={logout}
                >
                  <SignOut size={18} />
                </button>
              </div>
            ) : (
              <Button
                className="primary small"
                onClick={() => setAuth("login")}
                disabled={sessionLoading}
              >
                登录 / 注册
                <ArrowUpRight size={15} />
              </Button>
            )}
          </div>
        </div>
      </header>
      {mobile && (
        <button
          className="nav-scrim"
          aria-label="关闭导航"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main-shell">
        <main
          className={
            page === "records" && can(user, "bookings.review")
              ? "review-page"
              : page === "venue" ? "venue-page" : ""
          }
        >
          <div className="page-heading">
            <div>
              <span className="section-kicker">
                {admin ? "活动中心管理平台" : "大学生活动中心 · 户外广场"}
              </span>
              <h1>
                {page === "records" && can(user, "bookings.review")
                  ? "企业申报审核"
                  : titles[page]?.[0]}
              </h1>
              <p>
                {page === "records" && can(user, "bookings.review")
                  ? "核对场地时段与设计材料，处理企业布展申请。"
                  : titles[page]?.[1]}
              </p>

            </div>
            {["venue", "records"].includes(page) &&
              !(admin && page === "records") &&
              (!admin || can(user, "bookings.review")) && (
                <Button
                  className="primary"
                  onClick={beginBooking}
                  disabled={!connected || sessionLoading}
                >
                  {admin ? <ShieldCheck size={19} /> : <Plus size={20} />}{" "}
                  {admin ? "查看待审核申请" : "发起布展申请"}
                  <ArrowUpRight size={17} />
                </Button>
              )}
          </div>
          {!connected && serviceError && (
            <div className="service-warning">
              <WarningCircle size={23} />
              <div>
                <strong>服务暂未连接</strong>
                <p>
                  暂时无法读取预约和公告数据，请重试连接。
                </p>
              </div>
              <Button className="secondary small" onClick={refresh}>
                <ArrowsClockwise size={16} />
                重试连接
              </Button>
            </div>
          )}
          {page === "venue" && (
            <>
              <div className="venue-layout">
                <section className="card venue-card">
                  <div className="card-header">
                    <div>
                      <h2>桁架位置</h2>
                      <p>
                        <MapPin size={15} />
                        大学生活动中心户外广场
                      </p>
                    </div>
                    <div className="segmented">
                      <button
                        className={view === "map" ? "selected" : ""}
                        onClick={() => setView("map")}
                      >
                        分布图
                      </button>
                      <button
                        className={view === "list" ? "selected" : ""}
                        onClick={() => setView("list")}
                      >
                        位置列表
                      </button>
                    </div>
                  </div>
                  <div className="venue-toolbar">
                    <div className="field-inline">
                      <CalendarBlank size={18} />
                      <input
                        type="date"
                        aria-label="查询日期"
                        value={date}
                        onChange={(e) =>
                          e.target.value && setDate(e.target.value)
                        }
                      />
                    </div>
                    <select
                      aria-label="筛选区域"
                      value={zone}
                      onChange={(e) => changeZone(e.target.value)}
                    >
                      <option value="all">全部位置（29）</option>
                      {VENUE_SEGMENTS.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.label}（{z.last - z.first + 1}）
                        </option>
                      ))}
                    </select>
                  </div>
                  {view === "map" ? (
                    <div
                      className={`venue-map ${!connected ? "disconnected" : ""}`}
                    >
                      <VenueMap
                        occupied={[...venue.occupied, ...venue.closed]}
                        closed={venue.closed}
                        selected={selected}
                        onSelect={setSelected}
                        zone={zone}
                        connected={connected}
                      />
                    </div>
                  ) : (
                    <div className="slot-grid">
                      {Array.from({ length: 29 }, (_, i) => i + 1)
                        .filter((n) => inSegment(n, zone))
                        .map((n) => {
                          const b = venue.occupied.some((s) => s.slot === n),
                            c = venue.closed.some((s) => s.slot === n);
                          return (
                            <button
                              key={n}
                              onClick={() => setSelected(n)}
                              className={`${selected === n ? "selected" : ""} ${b ? "occupied" : c ? "closed" : ""}`}
                            >
                              <strong>{slotName(n)}</strong>
                              <small>
                                {!connected
                                  ? "待同步"
                                  : c
                                    ? "暂停开放"
                                    : b
                                      ? "已占用"
                                      : "可预约"}
                              </small>
                            </button>
                          );
                        })}
                    </div>
                  )}
                  <div className="venue-bottom">
                    <span>
                      <ShieldCheck size={16} />
                      {connected
                        ? "预约状态自动更新"
                        : "暂时无法获取预约状态"}
                    </span>
                    <span>{date}</span>
                  </div>
                  <p className="map-source-note">
                    绿地边缘 6 个 · B 座通道 4 个 · A 座通道 4 个 · 东侧直线 7
                    个 · 南侧直线 8 个。
                  </p>
                </section>
                <div className="venue-side">
                  <section className="card position-card">
                    <div className="position-header">
                      <span>已选桁架位</span>
                      <span
                        className={`subtle-tag ${busy || closed ? "tag-amber" : ""}`}
                      >
                        {!connected
                          ? "状态待同步"
                          : closed
                            ? "暂停开放"
                            : busy
                              ? "已占用"
                              : "可预约"}
                      </span>
                    </div>
                    <div className="position-number">
                      <span>{slotName(selected)}</span>
                      <MapPin size={40} weight="light" />
                    </div>
                    <p>{zoneName(selected)}</p>
                    <div className="position-details">
                      <div>
                        <span>选择日期</span>
                        <strong>{date}</strong>
                      </div>
                      <div>
                        <span>所在场地</span>
                        <strong>户外广场</strong>
                      </div>
                      <div>
                        <span>最长申报</span>
                        <strong>3 天（含起止日期）</strong>
                      </div>
                    </div>
                    {closed ? (
                      <div className="info-box">
                        <p>{closed.reason}</p>
                      </div>
                    ) : busy ? (
                      <div className="info-box">
                        <p>该日期已有活动安排，请选择其他位置或日期。</p>
                      </div>
                    ) : (
                      <Button
                        className="primary full"
                        disabled={!connected || sessionLoading}
                        onClick={beginBooking}
                      >
                        {user ? "申请此位置" : "登录后预约"}
                        <ArrowRight size={19} />
                      </Button>
                    )}
                  </section>

                </div>
              </div>
            </>
          )}
          {page === "records" &&
            user &&
            !user.mustChangePassword &&
            (user.role === "enterprise" || can(user, "bookings.review")) && (
              <Records
                key={user.id}
                user={user}
                notify={notify}
                onChange={refresh}
              />
            )}
          {page === "notices" && (
            <Notices
              items={notices}
              user={user}
              connected={connected}
              onSaved={(msg) => {
                notify(msg);
                refresh();
              }}
            />
          )}
          {page === "account" && user && (
            <AccountPage
              key={user.id}
              user={user}
              onUser={setUser}
              onLogout={logout}
              notify={notify}
            />
          )}
          {page === "users" && can(user, "accounts.manage") && (
            <UsersPage notify={notify} />
          )}
          {page === "closures" && can(user, "venue.manage") && (
            <ClosuresPage notify={notify} onChange={refresh} />
          )}
          {page === "audit" && can(user, "audit.read") && <AuditPage />}
          {page === "access" && user?.isSuperAdmin && (
            <Access notify={notify} />
          )}
          <footer className="page-footer">
            <Brand />
            <span>大学生活动中心 · 户外广场布展服务</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle size={21} />
          {toast}
        </div>
      )}
      {modal?.type === "booking" && user && (
        <BookingForm
          user={user}
          slot={selected}
          date={date}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            go("records");
            refresh();
            notify("申请已提交，请等待管理员审核");
          }}
        />
      )}
      {modal?.type === "help" && (
        <Modal
          title="布展预约须知"
          description="请在提交申请前阅读以下说明。"
          onClose={() => setModal(null)}
        >
          <div className="help-content">
            <h3>01 · 账号与企业资料</h3>
            <p>
              注册企业账号后，完善企业名称、联系人及手机号。请确保信息真实、联系方式畅通。
            </p>
            <h3>02 · 日期与桁架位</h3>
            <p>
              每次申报不可超过 3
              天，包含起止日期。请根据场地查询结果选择位置；待审核申请不代表预约成功，以审核通过后的安排为准。
            </p>
            <h3>03 · 设计图与审核</h3>
            <p>
              上传 3 MB 以内的 JPG、PNG 或 WebP
              设计图。审核结果在“我的申请”中查看；未通过时请根据审核意见重新申报。待审核的申请可以撤回。
            </p>
            <h3>04 · 账号恢复</h3>
            <p>
              忘记密码时，请联系活动中心管理员核验身份并重置。请勿将账号密码或临时密码交给无关人员。
            </p>
            <h3>05 · 现场使用</h3>
            <p>
              遵守现场管理要求，保持环境整洁，活动结束后及时撤除设备。
            </p>
          </div>
        </Modal>
      )}
      {modal?.type === "notice" && (
        <Modal
          title={modal.item.title}
          description={`大学生活动中心 · ${modal.item.created.slice(0, 10)}`}
          onClose={() => setModal(null)}
        >
          <div className="notice-full">{modal.item.content}</div>
        </Modal>
      )}
    </div>
  );
}
