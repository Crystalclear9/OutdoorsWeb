import React, { lazy, Suspense, useState, useEffect, useRef } from "react";
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
import AccessCode from "./AccessCode.jsx";
import LazyPageBoundary from "./LazyPageBoundary.jsx";
const Casework = lazy(() => import("./Casework.jsx"));
import { can } from "./permissions.js";
import { VENUE_SEGMENTS, inSegment } from "./venue-layout.js";

const titles = {
  casework: ["通知与缴费办理", "查看反馈时限、结果电话和线下缴费办理进度。"],
  overview: ["服务工作台", "查询场地开放情况，提交布展申请并跟进办理进度。"],
  venue: ["场地查询", "按日期与区域，查看户外广场的桁架开放情况。"],
  records: ["我的申请", "统一管理布展申请，及时查看审核意见。"],
  notices: ["通知公告", "查看场地使用说明及最新服务通知。"],
  account: ["账号设置", "维护企业资料与账号安全。"],
  users: ["账号管理", "管理企业访问权限、账号状态与密码恢复。"],
  closures: ["场地开放安排", "统一维护桁架开放与暂停安排。"],
  access: ["授权管理", "管理工作人员授权与账号访问范围。"],
  audit: ["操作日志", "查看账号及业务操作记录。"],
  operations: ["运行维护", "查看备份、存储空间和日常维护结果。"],
};
export default function App() {
  const [user, setUser] = useState(null),
    [sessionLoading, setSessionLoading] = useState(true),
    [logoutBusy, setLogoutBusy] = useState(false),
    [passwordBusy, setPasswordBusy] = useState(false),
    [connected, setConnected] = useState(false),
    [serviceError, setServiceError] = useState(""),
    [auth, setAuth] = useState(null),
    [oauthMfa, setOauthMfa] = useState(null),
    [externalSignup, setExternalSignup] = useState(null),
    [page, setPage] = useState("overview"),
    [caseTarget, setCaseTarget] = useState(""),
    [mobile, setMobile] = useState(false),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState("");
  const [date, setDate] = useState(dateString()),
    [zone, setZone] = useState("all"),
    [selected, setSelected] = useState(1),
    [view, setView] = useState("map"),
    [venue, setVenue] = useState({ occupied: [], closed: [], total: 29 }),
    [venueLoading, setVenueLoading] = useState(true),
    [notices, setNotices] = useState([]),
    [noticeError, setNoticeError] = useState(""),
    [counts, setCounts] = useState({}),
    [version, setVersion] = useState(0);
  const admin = user?.role === "admin";
  const venueDate = page === "venue" ? date : dateString();
  const venueReady = connected && !venueLoading && venue.date === venueDate;
  const sessionGeneration = useRef(0);
  const logoutPending = useRef(false);
  const passwordPending = useRef(null);
  const accountGeneration = sessionGeneration.current;
  // Account requests may settle after logout and a new login, including a login
  // to the same ID. Only the originating authentication generation may act.
  const guardAccount =
    (callback) =>
    (...args) => {
      if (
        accountGeneration === sessionGeneration.current &&
        !logoutPending.current
      )
        return callback(...args);
    };
  function updateAccountUser(next) {
    // Multiple profile saves can outlive a page visit in the same login. Their
    // responses must not roll the visible account back to an older DB version.
    setUser((current) =>
      current?.id === next?.id && next?.version < current?.version
        ? current
        : next,
    );
  }
  function beginPasswordChange() {
    if (passwordPending.current || logoutPending.current) return null;
    const operation = Symbol("password-change");
    passwordPending.current = operation;
    setPasswordBusy(true);
    // Navigation can unmount/remount AccountPage. The App owns the operation,
    // and only its claimant may release it, including failure and late finally.
    return () => {
      if (passwordPending.current !== operation) return;
      passwordPending.current = null;
      setPasswordBusy(false);
    };
  }
  const refresh = () => setVersion((v) => v + 1);
  const notify = (message) => setToast(message);
  const changeZone = (value) => {
    setZone(value);
    if (!inSegment(selected, value)) {
      setSelected(VENUE_SEGMENTS.find((s) => s.id === value)?.first || 1);
    }
  };
  const go = (p, caseId = "") => {
    if (p === "casework") setCaseTarget(caseId);
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
    const generation = sessionGeneration.current;
    api("/auth/session")
      .then((r) => {
        if (active && generation === sessionGeneration.current) {
          setCsrf(r.csrf);
          setUser(r.user);
          if (r.user?.mustChangePassword || r.user?.mfaRequired)
            setPage("account");
        }
      })
      .catch(
        (e) =>
          active &&
          generation === sessionGeneration.current &&
          setServiceError(e.message),
      )
      .finally(
        () =>
          active &&
          generation === sessionGeneration.current &&
          setSessionLoading(false),
      );
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setVenueLoading(true);
    api(`/venue?date=${venueDate}`)
      .then((v) => {
        if (active) {
          setVenue(v);
          setConnected(true);
          setServiceError("");
        }
      })
      .catch((e) => {
        if (active) {
          setConnected(false);
          setServiceError(e.message);
        }
      })
      .finally(() => active && setVenueLoading(false));
    // Public announcements are independent of venue availability: a failed or
    // slow announcement read must not block an otherwise healthy reservation.
    api("/notices")
      .then((n) => {
        if (active) {
          setNotices(n.items);
          setNoticeError("");
        }
      })
      .catch(() => {
        if (active) {
          setNotices([]);
          setNoticeError("公告暂时无法加载，请稍后重试。");
        }
      });
    return () => {
      active = false;
    };
  }, [date, version, page]);
  useEffect(() => {
    let active = true;
    if (
      user &&
      !user.mustChangePassword &&
      !user.mfaRequired &&
      (user.role === "enterprise" || can(user, "bookings.review"))
    )
      api("/summary")
        .then((r) => active && setCounts(r.counts))
        .catch((e) => active && notify(e.message));
    else setCounts({});
    return () => {
      active = false;
    };
  }, [user, version]);
  useEffect(() => {
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const fn = () => {
      // Logout revokes the server session before its response may arrive. Other
      // reads must not reopen login while that response can still clear cookies.
      if (logoutPending.current || passwordPending.current) return;
      sessionGeneration.current++;
      setSessionLoading(false);
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
    if (logoutPending.current || passwordPending.current) return;
    logoutPending.current = true;
    setLogoutBusy(true);
    sessionGeneration.current++;
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
    } finally {
      logoutPending.current = false;
      setLogoutBusy(false);
    }
  }
  function beginBooking() {
    if (page === "venue" && !venueReady) {
      notify("请等待所选日期的场地状态同步后再申请");
      return;
    }
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
    sessionGeneration.current++;
    setSessionLoading(false);
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
  const busy = venueReady && venue.occupied.find((b) => b.slot === selected),
    closed = venueReady && venue.closed.find((b) => b.slot === selected),
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
                go("overview");
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
          <aside
            id="workspace-navigation"
            className={`sidebar ${mobile ? "is-open" : ""}`}
          >
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
          </aside>
          <div className="topbar-actions">
            <span className="today">
              <CalendarBlank size={15} />
              {dateString().replaceAll("-", " / ")}
            </span>
            <button
              type="button"
              className="icon-button guide-trigger"
              aria-label="打开使用指南"
              title="使用指南"
              onClick={() => setModal({ type: "help" })}
            >
              <Question size={21} />
            </button>
            {user ? (
              <div className="user-bar">
                <button className="account-link" onClick={() => go("account")}>
                  <span className="avatar small">
                    {user.company.slice(0, 1)}
                  </span>
                  <span>{user.contact || "管理员"}</span>
                </button>
                <button
                  className="logout-button"
                  aria-label="退出登录"
                  disabled={logoutBusy || passwordBusy}
                  aria-busy={logoutBusy || passwordBusy}
                  onClick={logout}
                >
                  <SignOut size={18} />
                </button>
              </div>
            ) : (
              <Button
                className="primary small"
                onClick={() => setAuth("login")}
                disabled={sessionLoading || passwordBusy}
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
              : page === "venue"
                ? "venue-page"
                : "overview-page"
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
                  disabled={
                    !connected ||
                    sessionLoading ||
                    (page === "venue" && !venueReady)
                  }
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
              noticeError={noticeError}
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
                      className={`venue-map ${!venueReady ? "disconnected" : ""}`}
                    >
                      <VenueMap
                        occupied={
                          venueReady ? [...venue.occupied, ...venue.closed] : []
                        }
                        closed={venueReady ? venue.closed : []}
                        selected={selected}
                        onSelect={setSelected}
                        zone={zone}
                        connected={venueReady}
                      />
                    </div>
                  ) : (
                    <div className="slot-grid">
                      {Array.from({ length: 29 }, (_, i) => i + 1)
                        .filter((n) => inSegment(n, zone))
                        .map((n) => {
                          const b =
                              venueReady &&
                              venue.occupied.some((s) => s.slot === n),
                            c =
                              venueReady &&
                              venue.closed.some((s) => s.slot === n);
                          return (
                            <button
                              key={n}
                              onClick={() => setSelected(n)}
                              className={`${selected === n ? "selected" : ""} ${b ? "occupied" : c ? "closed" : ""}`}
                            >
                              <strong>{slotName(n)}</strong>
                              <small>
                                {!venueReady
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
                      {venueLoading
                        ? "正在同步所选日期的场地状态…"
                        : venueReady
                          ? "预约状态自动更新"
                          : "暂时无法获取预约状态"}
                    </span>
                    <span>{date}</span>
                  </div>
                  <p className="map-source-note">
                    绿地边缘 6 个 · B 座通道 4 个 · A 座通道 4 个 · 东侧直线 7
                    个 · 南侧直线 8 个。
                  </p>
                  <p
                    className="map-source-note venue-onsite-summary"
                    role="status"
                  >
                    {venueLoading
                      ? `${date} 现场登记数据正在同步，请稍候。`
                      : !venueReady
                        ? "现场登记数据待同步。"
                        : venue.onsite?.length
                          ? `${date} 现场登记：已摆放 ${venue.actualPlaced} / 29，已登记 ${venue.onsite.length} 个位置。未登记位置不计入；实际摆放不等于批准占位。`
                          : `${date} 尚无现场登记，不能据此判断实际摆放数量。`}
                  </p>
                </section>
                <div className="venue-side">
                  <section className="card position-card">
                    <div className="position-header">
                      <span>已选桁架位</span>
                      <span
                        className={`subtle-tag ${busy || closed ? "tag-amber" : ""}`}
                      >
                        {!venueReady
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
                      <div>
                        <span>现场登记</span>
                        <strong>
                          {!venueReady
                            ? "待同步"
                            : venue.onsite?.some((row) => row.slot === selected)
                              ? venue.onsite.find(
                                  (row) => row.slot === selected,
                                ).present
                                ? "已摆放"
                                : "已登记未摆放"
                              : "尚未登记"}
                        </strong>
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
                        disabled={!venueReady || sessionLoading}
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
              readError={noticeError}
              user={user}
              onSaved={(msg) => {
                notify(msg);
                refresh();
              }}
            />
          )}
          {page === "casework" &&
            user &&
            (user.role === "enterprise" ||
              can(user, "bookings.review") ||
              can(user, "payments.manage")) && (
              <LazyPageBoundary key={user.id}>
                <Suspense fallback={<p>正在加载办理界面…</p>}>
                  <Casework
                    key={user.id}
                    user={user}
                    notify={notify}
                    initialId={caseTarget}
                  />
                </Suspense>
              </LazyPageBoundary>
            )}
          {page === "account" && user && (
            <AccountPage
              key={user.id}
              user={user}
              onUser={guardAccount(updateAccountUser)}
              onLogout={guardAccount(logout)}
              logoutBusy={logoutBusy}
              passwordBusy={passwordBusy}
              beginPasswordChange={guardAccount(beginPasswordChange)}
              notify={guardAccount(notify)}
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
              遵守现场管理要求，保持环境整洁，活动结束后及时撤除设备。场地图按需求
              PDF 第 11 页对齐；A 座、B 座为建筑名称，位置编号为系统标识。
            </p>
            <AccessCode connected={connected} />
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
