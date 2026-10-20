import React, { useState, useEffect } from "react";
import {
  MagnifyingGlass,
  ClipboardText,
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  ArrowsClockwise,
} from "@phosphor-icons/react";
import { api } from "./api.js";
import { can } from "./permissions.js";
import { Empty, ErrorBox, Status, Button } from "./components.jsx";
import { slotName } from "./utils.js";
import { BookingDetail } from "./Booking.jsx";
import ReviewDesk from "./ReviewDesk.jsx";

export default function Records({ user, notify, onChange }) {
  return can(user, "bookings.review") ? (
    <ReviewDesk
      user={user}
      notify={notify}
      onChange={onChange}
      history={
        <ApplicationHistory user={user} notify={notify} onChange={onChange} />
      }
    />
  ) : (
    <ApplicationHistory user={user} notify={notify} onChange={onChange} />
  );
}

function ApplicationHistory({ user, notify, onChange }) {
  const [filter, setFilter] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [data, setData] = useState({ items: [], total: 0, pages: 1 }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(null),
    [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const t = setTimeout(
      () =>
        api(
          `/bookings?status=${encodeURIComponent(filter)}&q=${encodeURIComponent(query)}&page=${page}`,
        )
          .then((r) => {
            if (active) {
              setData(r);
              setError("");
            }
          })
          .catch((e) => active && setError(e.message))
          .finally(() => active && setLoading(false)),
      180,
    );
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [filter, query, page, version, user.id]);
  return (
    <>
      <section className="card records-card">
        <div className="record-filters">
          <div className="tabs">
            {["", "待审核", "已通过", "未通过", "已撤回", "已取消"].map((f) => (
              <button
                key={f}
                className={filter === f ? "selected" : ""}
                onClick={() => {
                  setFilter(f);
                  setPage(1);
                }}
              >
                {f || "全部申请"}
              </button>
            ))}
          </div>
          <button
            className="icon-button"
            aria-label="刷新申请列表"
            onClick={() => setVersion((v) => v + 1)}
          >
            <ArrowsClockwise size={20} />
          </button>
        </div>
        <div className="records-toolbar">
          <label className="search-input">
            <MagnifyingGlass size={19} />
            <input
              placeholder="搜索企业、联系人或申请编号"
              aria-label="搜索申请"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <span className="muted">共 {data.total} 条申请</span>
        </div>
        <ErrorBox>{error}</ErrorBox>
        {loading ? (
          <div className="loading-block">正在加载申请…</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>申报企业 / 编号</th>
                  <th>联系人</th>
                  <th>布展时间</th>
                  <th>桁架位</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.company}</strong>
                      <small className="monospace">{b.id}</small>
                    </td>
                    <td>
                      {b.contact}
                      <small>{b.phone}</small>
                    </td>
                    <td>
                      {b.start}
                      <small>至 {b.end}</small>
                    </td>
                    <td>
                      <span className="slot-label">{slotName(b.slot)}</span>
                    </td>
                    <td>
                      <Status value={b.status} />
                    </td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => setSelected(b)}
                      >
                        {can(user, "bookings.review") && b.status === "待审核"
                          ? "审核申请"
                          : "查看详情"}
                        <ArrowUpRight size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.items.length && (
              <Empty icon={ClipboardText} title="暂无相关申请">
                {filter || query
                  ? "请调整筛选条件后重试。"
                  : "提交申请后，您可以在这里查看进度与审核结果。"}
              </Empty>
            )}
          </div>
        )}
        <div className="pagination">
          <span>
            第 {page} / {data.pages} 页
          </span>
          <div>
            <Button
              className="secondary small"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ArrowLeft size={16} />
              上一页
            </Button>
            <Button
              className="secondary small"
              disabled={page >= data.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
              <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      </section>
      {selected && (
        <BookingDetail
          item={selected}
          user={user}
          onClose={() => setSelected(null)}
          onSaved={(msg) => {
            setSelected(null);
            setVersion((v) => v + 1);
            onChange();
            notify(msg);
          }}
        />
      )}
    </>
  );
}
