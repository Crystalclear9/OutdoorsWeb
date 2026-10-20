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
  audit: ["有记录，也有依据。", "查看账号及业务操作记录。"],
};
export default function App() {
  const [user, setUser] = useState(null),
    [sessionLoading, setSessionLoading] = useState(true),
    [connected, setConnected] = useState(false),
    [serviceError, setServiceError] = useState(""),
    [auth, setAuth] = useState(null),
    [page, setPage] = useState("overview"),
    [mobile, setMobile] = useState(false),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState("");
  const [date, setDate] = useState(dateString()),
    [zone, setZone] = useState("全部区域"),
    [selected, setSelected] = useState(1),
    [view, setView] = useState("map"),
    [venue, setVenue] = useState({ occupied: [], closed: [], total: 29 }),
    [notices, setNotices] = useState([]),
    [counts, setCounts] = useState({}),
    [version, setVersion] = useState(0);
  const admin = user?.role === "admin";
  const refresh = () => setVersion((v) => v + 1);
  const notify = (message) => setToast(message);
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
    Promise.all([api(`/venue?date=${date}`), api("/notices")])
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
  }, [date, version]);
  useEffect(() => {
    if (user && !user.mustChangePassword)
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
      go("records");
      return;
    }
    setModal({ type: "booking" });
  }
  function onAuth(u) {
    setUser(u);
    setAuth(null);
    setPage(u.mustChangePassword ? "account" : "overview");
    refresh();
    notify("登录成功");
  }
  const nav = [
    ["overview", "服务工作台", SquaresFour],
    ["venue", "场地查询", MapTrifold],
    ...(user
      ? [["records", admin ? "企业申报审核" : "我的申请", ClipboardText]]
      : []),
    ["notices", "通知公告", Megaphone],
    ...(admin
      ? [
          ["closures", "场地开放安排", CalendarBlank],
          ["users", "账号管理", Users],
          ["audit", "操作日志", ShieldCheck],
        ]
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
          <span>
            <Question size={22} />
          </span>
          <h3>需要一点帮助？</h3>
          <p>了解申报材料、预约规则与审核流程。</p>
          <button
            className="text-button"
            onClick={() => setModal({ type: "help" })}
          >
            查看使用指南
            <ArrowUpRight size={17} />
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
        <main>
          <div className="page-heading">
            <div>
              <span className="section-kicker">
                {admin ? "活动中心管理平台" : "大学生活动中心 · 户外广场"}
              </span>
              <h1>{titles[page]?.[0]}</h1>
              <p>{titles[page]?.[1]}</p>
            </div>
            {["overview", "venue", "records"].includes(page) && (
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
          {(page === "overview" || page === "venue") && (
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
                  <span className="metric-foot">A / B / C 三个区域</span>
                </div>
                <div>
                  <span className="metric-icon green">
                    <CheckCircle size={25} />
                  </span>
                  <div>
                    <p>当日可预约</p>
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
                    <p>当日已安排</p>
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
                    <p>
                      {user
                        ? admin
                          ? "等待审核"
                          : "我的待审核"
                        : "企业预约服务"}
                    </p>
                    <strong>
                      {user ? counts["待审核"] || 0 : "3"}
                      <small>{user ? "条" : "天以内"}</small>
                    </strong>
                  </div>
                  <span className="metric-foot">
                    {user ? "所有设备共享审核进度" : "登录后提交布展申请"}
                  </span>
                </div>
              </div>
              <div className="venue-layout">
                <section className="card venue-card">
                  <div className="card-header">
                    <div>
                      <h2>广场桁架分布</h2>
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
                      onChange={(e) => setZone(e.target.value)}
                    >
                      {["全部区域", "A 区", "B 区", "C 区"].map((z) => (
                        <option key={z}>{z}</option>
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
                        场地布局示意，具体摆放请以现场安排为准。
                      </div>
                    </div>
                  ) : (
                    <div className="slot-grid">
                      {Array.from({ length: 29 }, (_, i) => i + 1)
                        .filter(
                          (n) =>
                            zone === "全部区域" ||
                            zone.startsWith(slotName(n)[0]),
                        )
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
                    <p>
                      {slotName(selected)[0]} 区 · {zoneName(selected)}
                    </p>
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
              {page === "overview" && (
                <div className="overview-bottom">
                  <section className="card recent-notices">
                    <div className="card-header">
                      <h2>通知公告</h2>
                      <button
                        className="text-button"
                        onClick={() => go("notices")}
                      >
                        查看全部
                        <ArrowRight size={16} />
                      </button>
                    </div>
                    {notices.slice(0, 3).map((n) => (
                      <button
                        className="recent-notice"
                        key={n.id}
                        onClick={() => setModal({ type: "notice", item: n })}
                      >
                        <span>
                          {!!n.pinned && <b className="pin-tag">置顶</b>}
                          {n.title}
                        </span>
                        <small>
                          {n.created.slice(0, 10)}
                          <ArrowUpRight size={16} />
                        </small>
                      </button>
                    ))}
                    {!notices.length && (
                      <p className="quiet-empty">
                        {connected
                          ? "暂无已发布通知"
                          : "连接后端后，将显示最新通知。"}
                      </p>
                    )}
                  </section>
                  <section className="contact-panel">
                    <Megaphone size={30} weight="light" />
                    <h2>有序布展，共享校园。</h2>
                    <p>
                      爱护公共设施，保持场地整洁。
                      <br />
                      共同守护每一份校园美好。
                    </p>
                  </section>
                </div>
              )}
            </>
          )}
          {page === "records" && user && !user.mustChangePassword && (
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
          {page === "users" && admin && <UsersPage notify={notify} />}
          {page === "closures" && admin && (
            <ClosuresPage notify={notify} onChange={refresh} />
          )}
          {page === "audit" && admin && <AuditPage />}
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
              遵守现场管理要求，保持环境整洁，活动结束后及时撤除设备。图中布局为场地示意，具体位置以现场安排为准。
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
