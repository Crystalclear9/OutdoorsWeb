import React, { useState, useEffect } from "react";
import {
  SquaresFour,
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
  Clock,
  ArrowsClockwise,
  Question,
  WarningCircle,
  Buildings,
} from "@phosphor-icons/react";
import { api, setCsrf } from "./api.js";
import { dateString, slotName, zoneName } from "./utils.js";
import { Button, Brand, Modal, AuthPage, AccountPage } from "./components.jsx";
import { BookingForm } from "./Booking.jsx";
import { UsersPage, ClosuresPage, AuditPage } from "./Admin.jsx";
import VenueMap from "./VenueMap.jsx";
import Records from "./Records.jsx";
import Notices from "./Notices.jsx";
import Dashboard from "./Dashboard.jsx";
import Access from "./Access.jsx";
import Operations from "./Operations.jsx";
import Onsite from "./Onsite.jsx";
import Archives from "./Archives.jsx";
import Deliveries from "./Deliveries.jsx";
import { can } from "./permissions.js";
import { VENUE_SEGMENTS, inSegment } from "./venue-layout.js";

const titles = {
  overview: [
    "场地有序，活动从容。",
    "查询场地、提交申请，让校园里的每一次相遇都有好安排。",
  ],
  venue: ["找到适合您的位置。", "按日期与区域，查看户外广场的桁架开放情况。"],
  records: ["每一步进度，都清晰可见。", "统一管理布展申请，及时查看审核意见。"],
  notices: ["校园动态，及时知晓。", "查看场地使用说明及最新服务通知。"],
  account: ["您的账号，安心管理。", "维护企业资料与账号安全。"],
  users: ["每一个账号，妥善管理。", "管理企业访问权限、账号状态与密码恢复。"],
  closures: ["让场地安排井然有序。", "统一维护桁架开放与暂停安排。"],
  access: ["按职责授权，按权限操作。", "管理工作人员授权与账号访问范围。"],
  audit: ["有记录，也有依据。", "查看账号及业务操作记录。"],
  operations: ["运行状态，及时掌握。", "查看备份、存储空间和日常维护结果。"],
};
export default function App() {
  const [user, setUser] = useState(null),
    [sessionLoading, setSessionLoading] = useState(true),
    [connected, setConnected] = useState(false),
    [serviceError, setServiceError] = useState(""),
    [auth, setAuth] = useState(null),
    [oauthMfa, setOauthMfa] = useState(null),
    [externalSignup, setExternalSignup] = useState(null),
    [page, setPage] = useState("overview"),
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
    setPage(user?.mustChangePassword || user?.mfaRequired ? "account" : p);
    setMobile(false);
  };
  useEffect(() => {
    const hash = window.location.hash;
    if (/^#signup=[a-f0-9]{64}$/.test(hash)) {
      setExternalSignup(hash.slice(8));
      setAuth("login");
    }
    if (/^#mfa=[a-f0-9]{64}$/.test(hash)) {
      setOauthMfa(hash.slice(5));
      setAuth("login");
    }
    if (hash === "#oauth=linked") {
      setPage("account");
      notify("第三方账号已绑定");
    }
    if (hash.startsWith("#oauth=") || hash.startsWith("#mfa="))
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
  }, []);
  useEffect(() => {
    let active = true;
    api("/auth/session")
      .then((r) => {
        if (active) {
          setCsrf(r.csrf);
          setUser(r.user);
          if (r.user?.mustChangePassword || r.user?.mfaRequired)
            setPage("account");
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
      api(`/venue?date=${page === "venue" ? date : dateString()}`),
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
      !user.mfaRequired &&
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
      setPage("overview");
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
    try {
      await api("/auth/logout", { method: "POST" });
      setUser(null);
      setCsrf(null);
      setModal(null);
      setCounts({});
      setAuth("login");
      setPage("overview");
      refresh();
    } catch (e) {
      notify(e.message);
    }
  }
  function beginBooking() {
    if (!connected) {
      notify("账号服务尚未连接，请使用 Docker 完整服务地址访问");
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
      go(can(user, "bookings.review") ? "records" : "overview");
      return;
    }
    setModal({ type: "booking" });
  }
  function onAuth(u) {
    setExternalSignup(null);
    setOauthMfa(null);
    setUser(u);
    setAuth(null);
    setPage(u.mustChangePassword || u.mfaRequired ? "account" : "overview");
    refresh();
    notify("登录成功");
  }
  const nav = [
    ["overview", "服务工作台", SquaresFour],
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
    ...(user?.isSuperAdmin
      ? [["operations", "运行维护", ArrowsClockwise]]
      : []),
  ];
  const busy = venue.occupied.find((b) => b.slot === selected),
    closed = venue.closed.find((b) => b.slot === selected),
    unavailable = new Set(
      [...venue.occupied, ...venue.closed].map((b) => b.slot),
    ).size;
  if (auth)
    return (
      <>
        <AuthPage
          initialMfa={oauthMfa}
          initialSignup={externalSignup}
          initialMode={auth}
          onSuccess={onAuth}
          onBack={() => {
            setAuth(null);
            setOauthMfa(null);
            setExternalSignup(null);
            if (window.location.hash.startsWith("#signup="))
              window.history.replaceState(
                null,
                "",
                window.location.pathname + window.location.search,
              );
          }}
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
      <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("overview");
          }}
        >
          <Brand />
        </a>
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
              <Icon size={21} weight={page === id ? "fill" : "regular"} />
              <span>{label}</span>
              {id === "records" && !!counts["待审核"] && (
                <b aria-hidden="true">{counts["待审核"]}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-support">
          <button
            type="button"
            className="sidebar-help-button"
            aria-label="打开使用指南"
            title="打开使用指南"
            onClick={() => setModal({ type: "help" })}
          >
            <Question size={22} />
            <span className="sidebar-help-copy">
              <strong>使用帮助</strong>
              <small>材料、规则与审核流程</small>
            </span>
          </button>
        </div>
        <div className="sidebar-account">
          {user ? (
            <>
              <button onClick={() => go("account")}>
                <span className="avatar">{user.company.slice(0, 1)}</span>
                <span>
                  <strong>{user.contact || "管理员"}</strong>
                  <small>{admin ? "平台管理员" : "企业账号"}</small>
                </span>
                <CaretRight size={17} />
              </button>
              <button
                className="logout-button"
                aria-label="退出登录"
                onClick={logout}
              >
                <SignOut size={19} />
              </button>
            </>
          ) : (
            <button onClick={() => setAuth("login")}>
              <span className="avatar">
                <UserCircle size={23} />
              </span>
              <span>
                <strong>登录账号</strong>
                <small>管理您的企业申请</small>
              </span>
              <ArrowRight size={18} />
            </button>
          )}
        </div>
      </aside>
      {mobile && (
        <button
          className="nav-scrim"
          aria-label="关闭导航"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="mobile-toggle icon-button"
              aria-label="打开导航"
              onClick={() => setMobile(!mobile)}
            >
              <List size={25} />
            </button>
            <span className="breadcrumb">
              校园服务
              <CaretRight size={14} />
              <strong>
                {page === "account"
                  ? "账号设置"
                  : nav.find((n) => n[0] === page)?.[1]}
              </strong>
            </span>
          </div>
          <div className="topbar-actions">
            <span className="today">
              <CalendarBlank size={17} />
              {dateString().replaceAll("-", " / ")}
            </span>
            {user ? (
              <button className="account-link" onClick={() => go("account")}>
                <span className="avatar small">{user.company.slice(0, 1)}</span>
                <span>{user.contact || "管理员"}</span>
              </button>
            ) : (
              <Button
                className="primary small"
                onClick={() => setAuth("login")}
                disabled={sessionLoading}
              >
                登录 / 注册
                <ArrowUpRight size={16} />
              </Button>
            )}
          </div>
        </header>
        <main
          className={
            page === "records" && can(user, "bookings.review")
              ? "review-page"
              : ""
          }
        >
          <div className="page-heading">
            <div>
              <span className="section-kicker">
                {admin ? "活动中心管理平台" : "大学生活动中心 · 户外广场"}
              </span>
              <h1>
                {page === "records" && can(user, "bookings.review")
                  ? "集中审阅，连续处理。"
                  : titles[page]?.[0]}
              </h1>
              <p>
                {page === "records" && can(user, "bookings.review")
                  ? "先核对冲突与材料，再确认结果；处理后自动进入下一条。"
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
                <strong>后端服务尚未连接</strong>
                <p>
                  {serviceError} GitHub Pages 仅托管前端，账号与业务数据需要
                  Docker 服务支持。
                </p>
              </div>
              <Button className="secondary small" onClick={refresh}>
                <ArrowsClockwise size={16} />
                重试连接
              </Button>
            </div>
          )}
          {page === "overview" && (
            <Dashboard
              user={user}
              counts={counts}
              notices={notices}
              connected={connected}
              version={version}
              onNavigate={go}
              onApply={beginBooking}
              onRefresh={refresh}
              notify={notify}
            />
          )}
          {page === "venue" && (
            <>
              <div className="metrics">
                <div>
                  <span className="metric-icon">
                    <MapTrifold size={25} />
                  </span>
                  <div>
                    <p>全部桁架位</p>
                    <strong>
                      29<small>个</small>
                    </strong>
                  </div>
                  <span className="metric-foot">原图五段位置分布</span>
                </div>
                <div>
                  <span className="metric-icon green">
                    <CheckCircle size={25} />
                  </span>
                  <div>
                    <p>所选日期可预约</p>
                    <strong>
                      {connected ? 29 - unavailable : "—"}
                      <small>个</small>
                    </strong>
                  </div>
                  <span className="metric-foot">
                    {connected ? "场地数据已同步" : "等待连接服务"}
                  </span>
                </div>
                <div>
                  <span className="metric-icon amber">
                    <Buildings size={25} />
                  </span>
                  <div>
                    <p>所选日期已安排</p>
                    <strong>
                      {connected ? venue.occupied.length : "—"}
                      <small>个</small>
                    </strong>
                  </div>
                  <span className="metric-foot">
                    {venue.closed.length
                      ? `另有 ${venue.closed.length} 个暂停开放`
                      : "以审批通过的申请为准"}
                  </span>
                </div>
                <div>
                  <span className="metric-icon">
                    <Clock size={25} />
                  </span>
                  <div>
                    <p>现场实际摆放</p>
                    <strong>
                      {connected ? (venue.actualPlaced ?? 0) : "—"}
                      <small>个</small>
                    </strong>
                  </div>
                  <span className="metric-foot">
                    所选日期现场登记，与预约数分别统计
                  </span>
                </div>
              </div>
              <div className="venue-layout">
                <section className="card venue-card">
                  <div className="card-header">
                    <div>
                      <h2>原图桁架位置</h2>
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
                    <div className="legend">
                      <span>
                        <i />
                        可预约
                      </span>
                      <span>
                        <i className="occupied" />
                        已占用
                      </span>
                      <span>
                        <i className="closed" />
                        暂停
                      </span>
                    </div>
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
                      <div className="map-caption">
                        底图来源：需求 PDF 第 11 页。点击蓝色桁架查看位置。
                      </div>
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
                        ? "实时查询 · 每 30 秒同步"
                        : "等待后端连接，不显示模拟占用数据"}
                    </span>
                    <span>{date}</span>
                  </div>
                  <p className="map-source-note">
                    绿地边缘 6 个 · B 座通道 4 个 · A 座通道 4 个 · 东侧直线 7
                    个 · 南侧直线 8 个。A 座、B 座是建筑名称；01–29
                    为系统位置编号，原 PDF 未提供桁架编号。
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
                  <section className="guide-card">
                    <span className="section-kicker">BEFORE YOU APPLY</span>
                    <h2>
                      一次顺畅的预约，
                      <br />
                      从充分准备开始。
                    </h2>
                    <div className="guide-step">
                      <span>01</span>
                      <p>完善企业与联系人资料</p>
                    </div>
                    <div className="guide-step">
                      <span>02</span>
                      <p>准备清晰的桁架设计图</p>
                    </div>
                    <div className="guide-step">
                      <span>03</span>
                      <p>提交后等待管理员审核</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setModal({ type: "help" })}
                    >
                      阅读完整预约须知
                      <ArrowUpRight size={17} />
                    </button>
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
            <>
              <Onsite notify={notify} onChange={refresh} />
              <ClosuresPage notify={notify} onChange={refresh} />
            </>
          )}
          {page === "audit" && can(user, "audit.read") && (
            <>
              <AuditPage />
              <Archives />
            </>
          )}
          {page === "operations" && user?.isSuperAdmin && (
            <>
              <Operations notify={notify} />
              <Deliveries notify={notify} />
            </>
          )}
          {page === "access" && user?.isSuperAdmin && (
            <Access notify={notify} />
          )}
          <footer className="page-footer">
            <Brand />
            <span>校园公共空间，让每一场活动更有序。</span>
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
              遵守现场管理要求，保持环境整洁，活动结束后及时撤除设备。场地图按需求
              PDF 第 11 页对齐；A 座、B 座为建筑名称，位置编号为系统标识。
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
