import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  Buildings,
  SquaresFour,
  MapTrifold,
  ClipboardText,
  Megaphone,
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Plus,
  CaretDown,
  CaretRight,
  Bell,
  Question,
  CalendarBlank,
  Clock,
  CheckCircle,
  XCircle,
  X,
  UploadSimple,
  MagnifyingGlass,
  ArrowsClockwise,
  SignOut,
  Info,
  ShieldCheck,
  Users,
  MapPin,
  FileImage,
  Eye,
  List,
  DownloadSimple,
} from "@phosphor-icons/react";
import "./styles.css";

const dateString = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const TODAY = dateString();
const plusDay = (date, n) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return dateString(d);
};
const ROLES = { enterprise: "企业用户", admin: "管理员", guest: "游客" };
const slotName = (n) =>
  `${n <= 9 ? "A" : n <= 19 ? "B" : "C"}-${String(n <= 9 ? n : n <= 19 ? n - 9 : n - 19).padStart(2, "0")}`;
const INITIAL_NOTICES = [
  {
    id: 1,
    title: "户外广场企业布展预约须知",
    content:
      "请企业如实填写名称、联系人和联系方式，并上传清晰的桁架设计图。每次申报时间不可超过 3 天。提交后请耐心等待管理员审核，审核结果以管理人员电话通知为准。",
    date: TODAY,
    pinned: true,
  },
  {
    id: 2,
    title: "文明布展，共同维护校园公共空间",
    content:
      "请保持场地整洁，合理控制活动音量，不占用消防通道。活动结束后，请及时撤除桁架并清理现场。",
    date: plusDay(TODAY, -2),
  },
  {
    id: 3,
    title: "场地桁架位置与使用说明",
    content:
      "广场示意图展示 29 个桁架位。蓝色表示可预约，橙色表示已占用。图示为演示布局，具体摆放位置请以现场安排为准。",
    date: plusDay(TODAY, -5),
  },
];
const SEED = [
  ...[1, 2, 4, 7, 10, 13, 17, 22, 26].map((slot, i) => ({
    id: `DEMO-${100 + i}`,
    company: [
      "华为技术有限公司",
      "武汉联想信息技术有限公司",
      "武汉智行科技有限公司",
    ][i % 3],
    contact: "陈老师",
    phone: "13800000000",
    start: TODAY,
    end: TODAY,
    slot,
    status: "已通过",
    created: plusDay(TODAY, -2),
    owner: "seed",
    history: [
      { text: "企业提交申请", date: plusDay(TODAY, -2) },
      { text: "管理员审核通过", date: plusDay(TODAY, -1) },
    ],
  })),
  ...[
    "武汉云启科技有限公司",
    "湖北知远文化有限公司",
    "武汉星河创新有限公司",
  ].map((company, i) => ({
    id: `HUST-${2026102001 + i}`,
    company,
    contact: ["张先生", "李女士", "刘先生"][i],
    phone: "13900000000",
    start: plusDay(TODAY, i),
    end: plusDay(TODAY, i + 1),
    slot: [3, 6, 8][i],
    status: "待审核",
    created: TODAY,
    owner: i === 0 ? "enterprise" : "seed",
    history: [{ text: "企业提交申请，等待审核", date: TODAY }],
  })),
];
function useStored(key, initial) {
  const [v, set] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      window.dispatchEvent(new Event("demo-storage-full"));
    }
  }, [key, v]);
  return [v, set];
}
const overlap = (a, b) => a.start <= b.end && b.start <= a.end;
const Status = ({ value }) => (
  <span
    className={`status ${value === "已通过" ? "green" : value === "待审核" ? "orange" : "red"}`}
  >
    <span />
    {value}
  </span>
);
function Modal({ title, sub, children, onClose, wide = false }) {
  useEffect(() => {
    const fn = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", fn);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", fn);
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "wide" : ""}`}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={22} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function VenueMap({ occupied, selected, onSelect, zone }) {
  const positions = Array.from({ length: 29 }, (_, i) => {
    let x,
      y,
      r = 0;
    if (i < 9) {
      if (i < 4) {
        x = 160 + i * 46;
        y = 162;
      } else if (i < 7) {
        x = 356;
        y = 183 + (i - 4) * 40;
        r = 90;
      } else {
        x = 159 + (i - 7) * 48;
        y = 332;
      }
    } else if (i < 19) {
      const j = i - 9;
      if (j < 5) {
        x = 409 + j * 41;
        y = 298 + j * 13;
        r = 18;
      } else {
        x = 401 + (j - 5) * 14;
        y = 403 + (j - 5) * 35;
        r = 68;
      }
    } else {
      const j = i - 19;
      if (j < 5) {
        x = 650;
        y = 349 + j * 39;
        r = 90;
      } else {
        x = 401 + (j - 5) * 44;
        y = 609;
      }
    }
    return { x, y, r, n: i + 1 };
  });
  return (
    <svg
      viewBox="0 0 820 690"
      className="venue-svg"
      role="img"
      aria-label="户外广场29个桁架位置示意图"
    >
      <defs>
        <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".7" fill="#d8e1e9" />
        </pattern>
        <pattern
          id="grass"
          width="12"
          height="12"
          patternUnits="userSpaceOnUse"
        >
          <path d="M2 6h2m3 3h2" stroke="#c2d9ca" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="820" height="690" fill="#f7f9fb" />
      <rect width="820" height="690" fill="url(#grid)" />
      <path d="M105 114H322V290H105Z" fill="#e0eee3" stroke="#ccdfd1" />
      <path d="M105 114H322V290H105Z" fill="url(#grass)" />
      <text x="212" y="231" textAnchor="middle" className="map-label">
        中心绿地
      </text>
      <path
        d="M458 114h123v86c0 186-104 359-311 359H107V433h130c131 0 221-104 221-233Z"
        fill="#e8edf1"
        stroke="#d8e0e6"
        strokeWidth="2"
      />
      <path
        d="M482 200c0 190-116 306-253 306"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeDasharray="7 8"
      />
      <path d="M107 434h112v126H107Z" fill="#dde5ec" />
      <rect x="113" y="442" width="100" height="108" rx="3" fill="#e4eaf0" />
      <Buildings
        x="144"
        y="469"
        width="34"
        height="34"
        color="#65849f"
        weight="light"
      />
      <text x="163" y="526" textAnchor="middle" className="map-small">
        大学生活动中心
      </text>
      <path
        d="M102 374H330M603 123v180M103 586h245M693 339v220"
        stroke="#e4e9ee"
        strokeWidth="12"
        strokeLinecap="round"
      />
      <text x="200" y="100" textAnchor="middle" className="map-zone">
        A 区 · 绿地周边
      </text>
      <text x="529" y="250" textAnchor="middle" className="map-zone">
        B 区 · 环形广场
      </text>
      <text x="572" y="650" textAnchor="middle" className="map-zone">
        C 区 · 东南侧步道
      </text>
      {[
        { x: 92, y: 337 },
        { x: 367, y: 565 },
        { x: 688, y: 590 },
        { x: 599, y: 189 },
      ].map((t, i) => (
        <g key={i}>
          <circle cx={t.x} cy={t.y} r="14" fill="#e2ede4" />
          <circle cx={t.x - 4} cy={t.y - 4} r="10" fill="#d3e4d6" />
        </g>
      ))}
      {positions.map(({ x, y, r, n }) => {
        const busy = occupied.some((a) => a.slot === n);
        const active = selected === n;
        const dim = zone !== "全部区域" && zone !== slotName(n)[0] + " 区";
        return (
          <g
            key={n}
            role="button"
            tabIndex={dim ? -1 : 0}
            aria-label={`${slotName(n)} ${busy ? "已占用" : "可预约"}`}
            onClick={() => !dim && onSelect(n)}
            onKeyDown={(e) =>
              ["Enter", " "].includes(e.key) && !dim && onSelect(n)
            }
            className="map-slot"
            opacity={dim ? 0.2 : 1}
            transform={`translate(${x} ${y})`}
          >
            <title>
              {slotName(n)} · {busy ? "已占用" : "可预约"}
            </title>
            {active && (
              <rect
                x="-24"
                y="-17"
                width="48"
                height="34"
                rx="8"
                fill="none"
                stroke="#155d96"
                strokeWidth="2"
                strokeDasharray="3 2"
              />
            )}
            <rect
              x="-18"
              y="-7"
              width="36"
              height="14"
              rx="3"
              transform={`rotate(${r})`}
              fill={busy ? "#e4a66b" : active ? "#124e80" : "#5f96c1"}
              stroke="white"
              strokeWidth="2"
            />
            <text
              y={r === 90 ? 5 : -16}
              x={r === 90 ? 27 : 0}
              textAnchor={r === 90 ? "start" : "middle"}
              className="slot-text"
            >
              {slotName(n)}
            </text>
          </g>
        );
      })}
      <g transform="translate(738 79)">
        <path d="M0 0l-8 23 8-5 8 5Z" fill="#52718c" />
        <text y="-10" textAnchor="middle" className="map-small">
          N
        </text>
      </g>
      <path d="M80 641h80m-80-5v10m80-10v10" stroke="#90a4b6" />
      <text x="120" y="662" textAnchor="middle" className="map-small">
        场地布局示意
      </text>
    </svg>
  );
}

function App() {
  const [role, setRole] = useStored("hust-demo-role", "enterprise");
  const [bookings, setBookings] = useStored("hust-demo-bookings", SEED);
  const [notices, setNotices] = useStored("hust-demo-notices", INITIAL_NOTICES);
  const [page, setPage] = useState("overview"),
    [date, setDate] = useState(TODAY),
    [zone, setZone] = useState("全部区域"),
    [selected, setSelected] = useState(3),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("全部状态"),
    [review, setReview] = useState(""),
    [error, setError] = useState(""),
    [zoom, setZoom] = useState(1),
    [mobileNav, setMobileNav] = useState(false);
  const occupied = bookings.filter(
    (b) => b.status === "已通过" && b.start <= date && b.end >= date,
  );
  const pending = bookings.filter((b) => b.status === "待审核");
  const mine = bookings.filter((b) => b.owner === "enterprise");
  const selectedBooking = occupied.find((b) => b.slot === selected);
  function notify(s) {
    setToast(s);
  }
  useEffect(() => {
    const fn = () =>
      setToast("浏览器存储已满，本次修改仅在当前页面保留。请减少上传图片。");
    window.addEventListener("demo-storage-full", fn);
    return () => window.removeEventListener("demo-storage-full", fn);
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  function go(p) {
    setPage(p);
    setSearch("");
    setFilter("全部状态");
    setMobileNav(false);
  }
  function open(m) {
    setError("");
    setReview("");
    setModal(m);
  }
  function book(slot = selected) {
    if (role === "guest") {
      open({ type: "roles" });
      return;
    }
    open({ type: "booking", slot });
  }
  function changeRole(r) {
    setRole(r);
    setModal(null);
    go("overview");
    notify(`已进入${ROLES[r]}演示`);
  }
  function submitBooking(e) {
    e.preventDefault();
    const f = new FormData(e.target),
      data = Object.fromEntries(f);
    if (data.start < TODAY) return setError("申报开始日期不能早于今天");
    const days = (new Date(data.end) - new Date(data.start)) / 86400000 + 1;
    if (days < 1 || days > 3)
      return setError("申报日期需按先后顺序选择，且不可超过 3 天");
    if (!/^1\d{10}$/.test(data.phone))
      return setError("请填写正确的 11 位手机号码");
    if (!modal.image) return setError("请上传桁架设计图");
    const candidate = { ...data, slot: Number(data.slot) };
    if (
      bookings.some(
        (b) =>
          b.status === "已通过" &&
          b.slot === candidate.slot &&
          overlap(b, candidate),
      )
    )
      return setError("该桁架位在所选时段已被占用，请调整日期或桁架位");
    const item = {
      ...candidate,
      id: `HUST-${Date.now()}`,
      image: modal.image,
      imageName: modal.imageName,
      owner: "enterprise",
      created: TODAY,
      status: "待审核",
      history: [{ text: "企业提交申请，等待管理员审核", date: TODAY }],
    };
    setBookings([item, ...bookings]);
    setModal(null);
    go("records");
    notify("申请已提交，请等待管理员审核");
  }
  function decide(status) {
    const b = modal.item;
    if (status === "未通过" && !review.trim())
      return setError("请填写未通过原因，方便企业修改后重新申报");
    if (
      status === "已通过" &&
      bookings.some(
        (a) =>
          a.id !== b.id &&
          a.status === "已通过" &&
          a.slot === b.slot &&
          overlap(a, b),
      )
    )
      return setError("此桁架位已有时间冲突的已通过预约，请退回企业调整");
    setBookings(
      bookings.map((a) =>
        a.id === b.id
          ? {
              ...a,
              status,
              reason: review,
              history: [
                ...a.history,
                {
                  text:
                    status === "已通过"
                      ? "管理员审核通过"
                      : `审核未通过：${review}`,
                  date: TODAY,
                },
              ],
            }
          : a,
      ),
    );
    setModal(null);
    notify(`申请${status}，演示版不会发送电话或短信通知`);
  }
  const nav = [
    { id: "overview", icon: SquaresFour, label: "工作台概览" },
    {
      id: "venue",
      icon: MapTrifold,
      label: role === "admin" ? "场地情况管理" : "场地情况总览",
    },
    ...(role === "admin"
      ? [
          {
            id: "records",
            icon: ShieldCheck,
            label: "企业申报审核",
            count: pending.length,
          },
        ]
      : role === "enterprise"
        ? [
            { id: "apply", icon: ClipboardText, label: "企业布展申报" },
            { id: "records", icon: Clock, label: "我的申报记录" },
          ]
        : []),
    {
      id: "notices",
      icon: Megaphone,
      label: role === "admin" ? "通知公告管理" : "通知公告",
    },
  ];
  const records = (role === "admin" ? bookings : mine).filter(
    (b) =>
      (filter === "全部状态" || b.status === filter) &&
      `${b.company}${b.contact}${b.id}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("overview");
          }}
        >
          <div className="university-mark">
            <Buildings size={30} weight="light" />
          </div>
          <div>
            <strong>华中科技大学</strong>
            <small>
              HUAZHONG UNIVERSITY OF
              <br />
              SCIENCE AND TECHNOLOGY
            </small>
          </div>
        </a>
        <div className="platform-name">
          大学生活动中心<span>户外广场布展预约平台</span>
        </div>
        <div className="nav-caption">服务工作台</div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "active" : ""}
              onClick={() => (n.id === "apply" ? book() : go(n.id))}
            >
              <n.icon size={21} weight={page === n.id ? "fill" : "regular"} />
              <span>{n.label}</span>
              {!!n.count && <b>{n.count}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="service-label">
            <ShieldCheck size={20} />
            <span>
              让校园活动有序发生<small>规范申报 · 便捷审核 · 透明共享</small>
            </span>
          </div>
          <button
            className="switch-bottom"
            onClick={() => open({ type: "roles" })}
          >
            <SignOut size={18} />
            切换演示身份
            <CaretRight size={14} />
          </button>
          <p>本地演示 · 数据仅保存在当前浏览器</p>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-btn mobile-toggle"
            aria-label="打开导航"
            onClick={() => setMobileNav(!mobileNav)}
          >
            <List size={24} />
          </button>
          <div className="breadcrumb">
            布展预约服务 <CaretRight size={13} />
            <span>{nav.find((n) => n.id === page)?.label}</span>
          </div>
          <div className="top-actions">
            <span className="demo-label">DEMO 演示环境</span>
            <button
              className="icon-btn"
              aria-label="使用帮助"
              onClick={() => open({ type: "help" })}
            >
              <Question size={21} />
            </button>
            <button
              className="icon-btn notification-btn"
              aria-label="查看通知"
              onClick={() => go("notices")}
            >
              <Bell size={21} />
              <i />
            </button>
            <span className="top-divider" />
            <button className="profile" onClick={() => open({ type: "roles" })}>
              <span className="avatar">
                {role === "admin" ? "管" : role === "guest" ? "访" : "企"}
              </span>
              <span>
                {ROLES[role]}
                <small>
                  {role === "admin"
                    ? "活动中心管理端"
                    : role === "guest"
                      ? "公开场地查询"
                      : "企业预约服务端"}
                </small>
              </span>
              <CaretDown size={13} />
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">大学生活动中心 · 户外广场</div>
              <h1>
                {page === "overview"
                  ? role === "admin"
                    ? "预约管理工作台"
                    : "让每一次校园相遇，有序发生"
                  : page === "venue"
                    ? "场地情况总览"
                    : page === "records"
                      ? role === "admin"
                        ? "企业申报审核"
                        : "我的申报记录"
                      : "通知公告"}
              </h1>
              <p>
                {page === "overview"
                  ? "从场地查询到布展申报，一站完成。"
                  : page === "venue"
                    ? "按日期查看桁架使用情况，选择合适的布展位置。"
                    : page === "records"
                      ? "查看申报信息与审核进度，让每一步都有迹可循。"
                      : "查看场地使用须知与最新服务通知。"}
              </p>
            </div>
            <div className="heading-action">
              {role !== "guest" && (
                <button
                  className="primary"
                  onClick={() => (role === "admin" ? go("records") : book())}
                >
                  {role === "admin" ? (
                    <ShieldCheck size={18} />
                  ) : (
                    <Plus size={18} />
                  )}{" "}
                  {role === "admin" ? "处理待审核申请" : "发起布展申报"}
                  <ArrowUpRight size={17} />
                </button>
              )}
              <span>
                <CalendarBlank size={14} />
                {TODAY.replaceAll("-", ".")}　
                {new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(
                  new Date(),
                )}
              </span>
            </div>
          </div>
          {(page === "overview" || page === "venue") && (
            <>
              <div className="notice-strip">
                <span>
                  <Megaphone size={19} />
                  <b>预约须知</b>
                  <i />
                  每次申报时间不可超过 3 天，请提前准备好桁架设计图。
                </span>
                <button
                  onClick={() =>
                    open({ type: "notice", item: INITIAL_NOTICES[0] })
                  }
                >
                  查看详情 <ArrowRight size={15} />
                </button>
              </div>
              <div className="stats-grid">
                {[
                  {
                    label: "场地桁架总数",
                    number: 29,
                    unit: "个",
                    note: "覆盖广场 3 个布展区域",
                    icon: MapTrifold,
                  },
                  {
                    label: "当日已占用",
                    number: occupied.length,
                    unit: "个",
                    note: `${date.replaceAll("-", ".")} 场地使用情况`,
                    icon: Buildings,
                    color: "orange",
                  },
                  {
                    label: "当日可预约",
                    number: 29 - occupied.length,
                    unit: "个",
                    note: "选择空闲桁架位发起申报",
                    icon: CheckCircle,
                    color: "blue",
                  },
                  {
                    label:
                      role === "admin"
                        ? "待审核申请"
                        : role === "guest"
                          ? "开放查询"
                          : "我的待审核",
                    number:
                      role === "admin"
                        ? pending.length
                        : role === "guest"
                          ? 3
                          : mine.filter((b) => b.status === "待审核").length,
                    unit: role === "guest" ? "个区域" : "条",
                    note:
                      role === "guest"
                        ? "无需登录，即可查看场地"
                        : "申报进度可在记录中查看",
                    icon: role === "guest" ? Users : ClipboardText,
                  },
                ].map((s) => (
                  <div className={`stat-card ${s.color || ""}`} key={s.label}>
                    <div>
                      <span>{s.label}</span>
                      <strong>
                        {s.number}
                        <small>{s.unit}</small>
                      </strong>
                      <p>{s.note}</p>
                    </div>
                    <span className="stat-icon">
                      <s.icon size={24} weight="duotone" />
                    </span>
                  </div>
                ))}
              </div>
              <div className="venue-grid">
                <section className="panel map-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>广场桁架分布</h2>
                      <p>
                        <MapPin size={14} />
                        大学生活动中心户外广场
                      </p>
                    </div>
                    <div className="map-filters">
                      <select
                        aria-label="筛选区域"
                        value={zone}
                        onChange={(e) => setZone(e.target.value)}
                      >
                        {["全部区域", "A 区", "B 区", "C 区"].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                      <input
                        aria-label="查看场地日期"
                        type="date"
                        value={date}
                        onChange={(e) =>
                          e.target.value && setDate(e.target.value)
                        }
                      />
                    </div>
                  </div>
                  <div className="map-wrap">
                    <div className="map-legend">
                      <span>
                        <i className="free" />
                        可预约
                      </span>
                      <span>
                        <i className="busy" />
                        已占用
                      </span>
                      <span>
                        <i className="chosen" />
                        已选中
                      </span>
                    </div>
                    <div
                      className="map-canvas"
                      style={{ transform: `scale(${zoom})` }}
                    >
                      <VenueMap
                        occupied={occupied}
                        selected={selected}
                        onSelect={setSelected}
                        zone={zone}
                      />
                    </div>
                    <div className="zoom-tools">
                      <button
                        aria-label="放大地图"
                        onClick={() => setZoom(Math.min(1.4, zoom + 0.1))}
                      >
                        +
                      </button>
                      <button
                        aria-label="缩小地图"
                        onClick={() => setZoom(Math.max(0.8, zoom - 0.1))}
                      >
                        −
                      </button>
                      <button
                        aria-label="重置地图"
                        onClick={() => {
                          setZoom(1);
                          setZone("全部区域");
                        }}
                      >
                        <ArrowsClockwise size={16} />
                      </button>
                    </div>
                    <div className="map-hint">
                      <Info size={14} />
                      点击桁架位查看详情 · 示意布局，以现场安排为准
                    </div>
                  </div>
                  <div className="map-footer">
                    <span>
                      <i />
                      场地信息随审核结果更新
                    </span>
                    <span>共 29 个桁架位</span>
                  </div>
                </section>
                <div className="right-column">
                  <section className="panel selected-panel">
                    <div className="panel-heading">
                      <h2>桁架位详情</h2>
                      <span
                        className={`tag ${selectedBooking ? "tag-orange" : ""}`}
                      >
                        {selectedBooking ? "已占用" : "可预约"}
                      </span>
                    </div>
                    <div className="slot-identity">
                      <div className="slot-icon">
                        <MapPin size={27} weight="duotone" />
                      </div>
                      <div>
                        <strong>{slotName(selected)}</strong>
                        <span>
                          {selected <= 9
                            ? "A 区 · 绿地周边"
                            : selected <= 19
                              ? "B 区 · 环形广场"
                              : "C 区 · 东南侧步道"}
                        </span>
                      </div>
                    </div>
                    <dl>
                      <div>
                        <dt>查询日期</dt>
                        <dd>{date}</dd>
                      </div>
                      <div>
                        <dt>场地位置</dt>
                        <dd>大学生活动中心户外广场</dd>
                      </div>
                      <div>
                        <dt>使用状态</dt>
                        <dd>
                          {selectedBooking
                            ? "该时段已有布展安排"
                            : "当前日期空闲"}
                        </dd>
                      </div>
                    </dl>
                    {selectedBooking ? (
                      <div className="soft-info">
                        <Info size={17} />
                        请选择其他空闲位置或调整查询日期。
                      </div>
                    ) : (
                      <button className="primary full" onClick={() => book()}>
                        {role === "guest" ? "以企业身份预约" : "预约此桁架位"}
                        <ArrowRight size={17} />
                      </button>
                    )}
                  </section>
                  <section className="panel steps-panel">
                    <div className="panel-heading">
                      <h2>布展预约流程</h2>
                      <span className="muted">4 个步骤</span>
                    </div>
                    {[
                      { t: "填写企业信息", d: "企业名称、联系人与联系方式" },
                      { t: "上传桁架设计图", d: "清晰展示布展内容与设计方案" },
                      { t: "等待管理员审核", d: "在申报记录中查看审核进度" },
                      { t: "按约定有序布展", d: "审核结果由管理人员电话通知" },
                    ].map((s, i) => (
                      <div className="process-step" key={s.t}>
                        <b>{String(i + 1).padStart(2, "0")}</b>
                        <div>
                          <strong>{s.t}</strong>
                          <p>{s.d}</p>
                        </div>
                      </div>
                    ))}
                  </section>
                </div>
              </div>
              {page === "overview" && (
                <div className="bottom-grid">
                  <section className="panel announcements">
                    <div className="panel-heading">
                      <h2>通知公告</h2>
                      <button
                        className="text-btn"
                        onClick={() => go("notices")}
                      >
                        查看全部 <CaretRight size={15} />
                      </button>
                    </div>
                    {notices.slice(0, 3).map((n) => (
                      <button
                        className="notice-row"
                        onClick={() => open({ type: "notice", item: n })}
                        key={n.id}
                      >
                        <span>
                          {n.pinned && <em>置顶</em>}
                          {n.title}
                        </span>
                        <small>
                          {n.date.slice(5).replace("-", "/")}
                          <CaretRight size={14} />
                        </small>
                      </button>
                    ))}
                  </section>
                  <section className="guide-card">
                    <div className="guide-icon">
                      <FileImage size={34} weight="duotone" />
                    </div>
                    <div>
                      <h2>准备好您的布展方案</h2>
                      <p>提前准备桁架设计图，让申报更顺畅。</p>
                      <button onClick={() => open({ type: "help" })}>
                        查看申报指南 <ArrowUpRight size={16} />
                      </button>
                    </div>
                  </section>
                </div>
              )}
            </>
          )}
          {page === "records" && (
            <section className="panel records-panel">
              <div className="panel-heading">
                <div className="record-tabs">
                  {["全部状态", "待审核", "已通过", "未通过"].map((v) => (
                    <button
                      className={filter === v ? "active" : ""}
                      key={v}
                      onClick={() => setFilter(v)}
                    >
                      {v === "全部状态" ? "全部申报" : v}
                      {v === "待审核" && (
                        <b>
                          {
                            (role === "admin"
                              ? pending
                              : mine.filter((b) => b.status === "待审核")
                            ).length
                          }
                        </b>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className="table-toolbar">
                <div className="search">
                  <MagnifyingGlass size={18} />
                  <input
                    placeholder="搜索企业名称、联系人或申报编号"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <span className="muted">共 {records.length} 条申报</span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>申报企业 / 编号</th>
                      <th>联系人</th>
                      <th>申报日期</th>
                      <th>桁架位</th>
                      <th>审核状态</th>
                      <th>提交日期</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <strong>{b.company}</strong>
                          <small>{b.id}</small>
                        </td>
                        <td>
                          {b.contact}
                          <small>{b.phone}</small>
                        </td>
                        <td>
                          {b.start}
                          <small>至 {b.end}</small>
                        </td>
                        <td>{slotName(b.slot)}</td>
                        <td>
                          <Status value={b.status} />
                        </td>
                        <td>{b.created}</td>
                        <td>
                          <button
                            className="text-btn"
                            onClick={() => open({ type: "detail", item: b })}
                          >
                            {role === "admin" && b.status === "待审核"
                              ? "审核申请"
                              : "查看详情"}
                            <ArrowUpRight size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {records.length === 0 && (
                <div className="empty">
                  <ClipboardText size={44} weight="light" />
                  <h3>暂无相关申报</h3>
                  <p>
                    可调整筛选条件
                    {role === "enterprise" ? "，或发起新的布展申报" : ""}。
                  </p>
                </div>
              )}
              <div className="table-footer">
                已展示全部 {records.length} 条记录
                <span>演示数据 · 仅在本机保存</span>
              </div>
            </section>
          )}
          {page === "notices" && (
            <section className="panel notice-list">
              <div className="panel-heading">
                <h2>
                  全部公告 <span className="muted">{notices.length}</span>
                </h2>
                {role === "admin" && (
                  <button
                    className="primary"
                    onClick={() => open({ type: "editNotice" })}
                  >
                    <Plus size={17} />
                    发布公告
                  </button>
                )}
              </div>
              {notices.map((n) => (
                <article key={n.id}>
                  <div className="notice-date">
                    <strong>{n.date.slice(8)}</strong>
                    <span>{n.date.slice(0, 7).replace("-", ".")}</span>
                  </div>
                  <div className="notice-content">
                    <button onClick={() => open({ type: "notice", item: n })}>
                      <h3>
                        {n.pinned && <em>置顶</em>}
                        {n.title}
                      </h3>
                    </button>
                    <p>{n.content}</p>
                    <small>大学生活动中心</small>
                  </div>
                  {role === "admin" ? (
                    <div className="notice-actions">
                      <button
                        className="text-btn"
                        onClick={() => open({ type: "editNotice", item: n })}
                      >
                        编辑
                      </button>
                      <button
                        className="text-btn danger-text"
                        onClick={() => open({ type: "deleteNotice", item: n })}
                      >
                        删除
                      </button>
                    </div>
                  ) : (
                    <button
                      className="icon-btn"
                      aria-label={`查看${n.title}`}
                      onClick={() => open({ type: "notice", item: n })}
                    >
                      <ArrowUpRight size={20} />
                    </button>
                  )}
                </article>
              ))}
            </section>
          )}
          <footer className="page-footer">
            <span>华中科技大学 · 大学生活动中心</span>
            <span>户外广场企业布展预约与审核服务</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle size={20} />
          {toast}
        </div>
      )}
      {modal?.type === "roles" && (
        <Modal
          title="选择演示身份"
          sub="使用不同角色，体验完整的预约与审核流程。"
          onClose={() => setModal(null)}
        >
          <div className="role-options">
            {[
              {
                r: "enterprise",
                i: Buildings,
                d: "提交布展申请，查看审核进度",
              },
              { r: "admin", i: ShieldCheck, d: "审核企业申请，管理场地与公告" },
              { r: "guest", i: Users, d: "无需登录，查看公开场地信息" },
            ].map((o) => (
              <button key={o.r} onClick={() => changeRole(o.r)}>
                <o.i size={29} weight="duotone" />
                <div>
                  <strong>{ROLES[o.r]}</strong>
                  <p>{o.d}</p>
                </div>
                <ArrowRight size={20} />
              </button>
            ))}
          </div>
          <div className="soft-info">
            <Info size={18} />
            演示身份可直接进入，尚未接入真实登录与身份认证。
          </div>
        </Modal>
      )}
      {modal?.type === "booking" && (
        <Modal
          title="企业布展申报"
          sub="请填写真实、完整的申报信息，提交后由管理员审核。"
          wide
          onClose={() => setModal(null)}
        >
          <form onSubmit={submitBooking}>
            <div className="form-grid">
              <div className="form-section">
                <h3>
                  <span>01</span>企业与联系人
                </h3>
                <label>
                  企业名称 <i>*</i>
                  <input
                    name="company"
                    required
                    maxLength={80}
                    placeholder="请输入企业完整名称"
                  />
                </label>
                <div className="two-fields">
                  <label>
                    联系人 <i>*</i>
                    <input
                      name="contact"
                      required
                      maxLength={30}
                      placeholder="请输入联系人"
                    />
                  </label>
                  <label>
                    联系方式 <i>*</i>
                    <input
                      name="phone"
                      required
                      inputMode="tel"
                      maxLength={11}
                      placeholder="11 位手机号码"
                    />
                  </label>
                </div>
                <h3>
                  <span>02</span>布展安排
                </h3>
                <div className="two-fields">
                  <label>
                    开始日期 <i>*</i>
                    <input
                      name="start"
                      type="date"
                      required
                      min={TODAY}
                      defaultValue={date < TODAY ? TODAY : date}
                    />
                  </label>
                  <label>
                    结束日期 <i>*</i>
                    <input
                      name="end"
                      type="date"
                      required
                      min={TODAY}
                      defaultValue={date < TODAY ? TODAY : date}
                    />
                  </label>
                </div>
                <p className="field-note">
                  含开始、结束日期，申报总时长不可超过 3 天。
                </p>
                <label>
                  申报桁架位 <i>*</i>
                  <select name="slot" defaultValue={modal.slot}>
                    {Array.from({ length: 29 }, (_, i) => (
                      <option value={i + 1} key={i}>
                        {slotName(i + 1)} ·{" "}
                        {i < 9
                          ? "绿地周边"
                          : i < 19
                            ? "环形广场"
                            : "东南侧步道"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="form-section upload-section">
                <h3>
                  <span>03</span>桁架设计图
                </h3>
                <label className="upload-box">
                  {modal.image ? (
                    <>
                      <img src={modal.image} alt="已上传桁架设计图" />
                      <span>{modal.imageName}</span>
                      <b>点击更换图片</b>
                    </>
                  ) : (
                    <>
                      <UploadSimple size={35} weight="light" />
                      <strong>点击上传设计图</strong>
                      <span>JPG、PNG 或 WebP，最大 3 MB</span>
                      <small>请确保布展内容与文字清晰可辨</small>
                    </>
                  )}
                  <input
                    aria-label="上传桁架设计图"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      const f = e.target.files[0];
                      if (!f) return;
                      if (
                        !["image/png", "image/jpeg", "image/webp"].includes(
                          f.type,
                        ) ||
                        f.size > 3 * 1024 * 1024
                      )
                        return setError(
                          "请上传 3 MB 以内的 JPG、PNG 或 WebP 图片",
                        );
                      const reader = new FileReader();
                      reader.onload = () => {
                        setModal((m) => ({
                          ...m,
                          image: reader.result,
                          imageName: f.name,
                        }));
                        setError("");
                      };
                      reader.readAsDataURL(f);
                    }}
                  />
                </label>
                <div className="soft-info">
                  <Info size={18} />
                  审核结果由管理人员电话通知，请保持联系方式畅通。
                </div>
              </div>
            </div>
            <label className="checkbox-label">
              <input type="checkbox" required />
              我已阅读预约须知，确认申报信息真实，并遵守校园场地管理要求。
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-footer">
              <span>
                <ShieldCheck size={16} />
                信息仅用于本次布展申请
              </span>
              <button
                type="button"
                className="secondary"
                onClick={() => setModal(null)}
              >
                取消
              </button>
              <button className="primary" type="submit">
                提交申请 <ArrowRight size={17} />
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal?.type === "detail" && (
        <Modal
          title={
            role === "admin" && modal.item.status === "待审核"
              ? "审核布展申请"
              : "申报详情"
          }
          sub={modal.item.id}
          wide
          onClose={() => setModal(null)}
        >
          <div className="detail-grid">
            <div>
              <Status value={modal.item.status} />
              <dl className="detail-fields">
                {[
                  ["企业名称", modal.item.company],
                  ["联系人", modal.item.contact],
                  ["联系方式", modal.item.phone],
                  ["申报日期", `${modal.item.start} 至 ${modal.item.end}`],
                  ["桁架位置", slotName(modal.item.slot)],
                  ["提交时间", modal.item.created],
                ].map(([a, b]) => (
                  <div key={a}>
                    <dt>{a}</dt>
                    <dd>{b}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div>
              <h3>桁架设计图</h3>
              {modal.item.image ? (
                <button
                  className="design-preview"
                  onClick={() =>
                    open({
                      type: "image",
                      image: modal.item.image,
                      back: modal.item,
                    })
                  }
                >
                  <img src={modal.item.image} alt="企业提交的桁架设计图" />
                  <span>
                    <MagnifyingGlass size={16} />
                    点击放大查看
                  </span>
                </button>
              ) : (
                <div className="sample-design">
                  <Buildings size={38} weight="light" />
                  <strong>校园企业交流活动</strong>
                  <p>{modal.item.company}</p>
                  <span>预置演示申请 · 未附真实设计图</span>
                </div>
              )}
            </div>
          </div>
          {modal.item.reason && (
            <div className="reject-reason">
              <strong>未通过原因</strong>
              <p>{modal.item.reason}</p>
            </div>
          )}
          <div className="timeline">
            {modal.item.history.map((h, i) => (
              <div key={i}>
                <CheckCircle size={17} />
                <span>{h.text}</span>
                <small>{h.date}</small>
              </div>
            ))}
          </div>
          {role === "admin" && modal.item.status === "待审核" ? (
            <>
              <label>
                审核意见 <span className="muted">（未通过时必填）</span>
                <textarea
                  placeholder="请填写审核意见或需要企业补充的内容"
                  value={review}
                  onChange={(e) => setReview(e.target.value)}
                  maxLength={500}
                />
              </label>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="modal-footer">
                <span>审核结果将同步更新到企业申报记录</span>
                <button className="danger" onClick={() => decide("未通过")}>
                  <XCircle size={18} />
                  未通过
                </button>
                <button className="primary" onClick={() => decide("已通过")}>
                  <CheckCircle size={18} />
                  审核通过
                </button>
              </div>
            </>
          ) : (
            <div className="modal-footer">
              <span>请以管理人员电话通知为准</span>
              <button className="primary" onClick={() => setModal(null)}>
                完成
              </button>
            </div>
          )}
        </Modal>
      )}
      {modal?.type === "image" && (
        <Modal
          title="桁架设计图预览"
          wide
          onClose={() => open({ type: "detail", item: modal.back })}
        >
          <img
            className="full-image"
            src={modal.image}
            alt="桁架设计图放大预览"
          />
          <button
            className="secondary"
            onClick={() => open({ type: "detail", item: modal.back })}
          >
            <ArrowLeft size={16} />
            返回申报详情
          </button>
        </Modal>
      )}
      {modal?.type === "notice" && (
        <Modal
          title={modal.item.title}
          sub={`大学生活动中心 · ${modal.item.date}`}
          onClose={() => setModal(null)}
        >
          <div className="notice-body">{modal.item.content}</div>
          <div className="modal-footer">
            <button className="primary" onClick={() => setModal(null)}>
              我已了解
            </button>
          </div>
        </Modal>
      )}
      {modal?.type === "editNotice" && (
        <Modal
          title={modal.item ? "编辑公告" : "发布公告"}
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.target));
              const n = {
                id: modal.item?.id ?? Date.now(),
                title: f.title.trim(),
                content: f.content.trim(),
                pinned: f.pinned === "on",
                date: modal.item?.date ?? TODAY,
              };
              if (!n.title || !n.content)
                return setError("请填写公告标题和正文");
              setNotices(
                (modal.item
                  ? notices.map((a) => (a.id === n.id ? n : a))
                  : [n, ...notices]
                ).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)),
              );
              setModal(null);
              notify("公告已保存");
            }}
          >
            <label>
              公告标题
              <input
                required
                name="title"
                maxLength={80}
                defaultValue={modal.item?.title}
              />
            </label>
            <label>
              公告正文
              <textarea
                required
                name="content"
                rows={7}
                maxLength={3000}
                defaultValue={modal.item?.content}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                name="pinned"
                defaultChecked={modal.item?.pinned}
              />
              置顶显示
            </label>
            {error && <p className="error">{error}</p>}
            <div className="modal-footer">
              <button
                type="button"
                className="secondary"
                onClick={() => setModal(null)}
              >
                取消
              </button>
              <button className="primary">保存公告</button>
            </div>
          </form>
        </Modal>
      )}
      {modal?.type === "deleteNotice" && (
        <Modal title="删除公告" onClose={() => setModal(null)}>
          <p>确认删除《{modal.item.title}》？</p>
          <div className="modal-footer">
            <button className="secondary" onClick={() => setModal(null)}>
              取消
            </button>
            <button
              className="danger"
              onClick={() => {
                setNotices(notices.filter((n) => n.id !== modal.item.id));
                setModal(null);
                notify("公告已删除");
              }}
            >
              删除公告
            </button>
          </div>
        </Modal>
      )}
      {modal?.type === "help" && (
        <Modal
          title="布展预约使用指南"
          sub="企业申报 → 管理员审核 → 场地使用"
          onClose={() => setModal(null)}
        >
          <div className="help-content">
            <h3>如何体验完整流程？</h3>
            <p>
              以企业身份选择日期、桁架位，填写申报信息并上传设计图。提交后，点击右上角身份入口切换为管理员，在“企业申报审核”中通过或退回申请，再切回企业查看结果。
            </p>
            <h3>申报需要准备什么？</h3>
            <p>
              企业名称、联系人、11 位手机号、最长 3 天的申报时间，以及 3 MB
              以内的 JPG、PNG 或 WebP 桁架设计图。
            </p>
            <h3>演示范围</h3>
            <p>
              本版本为响应式 Web
              Demo，提供企业、管理员与游客三种演示身份。数据保存在当前浏览器；未接入真实短信、QQ/微信授权、电话通知或后端。场地布局为参考
              PDF 绘制的示意图。
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
