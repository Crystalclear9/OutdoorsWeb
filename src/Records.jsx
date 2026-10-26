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
import { BookingDetail } from "./Booking.jsx";
import ReviewDesk from "./ReviewDesk.jsx";

export default function Records({
  user,
  notify,
  onChange,
  initialStatus = "",
}) {
  const filterStatus = initialStatus === "all" ? "" : initialStatus;
  return can(user, "bookings.review") ? (
    <ReviewDesk
      user={user}
      notify={notify}
      onChange={onChange}
      initialMode={
        initialStatus && initialStatus !== "待审核" ? "history" : "pending"
      }
      history={
        <ApplicationHistory
          user={user}
          notify={notify}
          onChange={onChange}
          initialStatus={filterStatus}
        />
      }
    />
  ) : (
    <ApplicationHistory
      user={user}
      notify={notify}
      onChange={onChange}
      initialStatus={filterStatus}
    />
  );
}

function ApplicationHistory({ user, notify, onChange, initialStatus = "" }) {
  const reviewerAccess = can(user, "bookings.review");
  const [filter, setFilter] = useState(initialStatus),
    [query, setQuery] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [reviewer, setReviewer] = useState(""),
    [reviewers, setReviewers] = useState([]),
    [reviewersError, setReviewersError] = useState(""),
    [page, setPage] = useState(1),
    [data, setData] = useState({ items: [], total: 0, pages: 1 }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(null),
    [version, setVersion] = useState(0),
    [resultKey, setResultKey] = useState("");
  const rangeError =
    from && to && from > to ? "提交开始日期不能晚于结束日期。" : "";
  const criteriaKey = JSON.stringify([filter, query, from, to, reviewer, page]);
  useEffect(() => {
    if (!reviewerAccess) return;
    let active = true;
    api("/bookings/reviewers")
      .then((r) => {
        if (active) {
          setReviewers(r.items);
          setReviewersError("");
        }
      })
      .catch(
        (e) =>
          active &&
          setReviewersError(`无法读取审批人：${e.message} 可点击刷新重试。`),
      );
    return () => {
      active = false;
    };
  }, [reviewerAccess, user.id, version]);
  useEffect(() => {
    let active = true;
    if (rangeError) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const t = setTimeout(
      () =>
        api(
          `/bookings?status=${encodeURIComponent(filter)}&q=${encodeURIComponent(query)}&page=${page}&from=${from}&to=${to}${reviewerAccess ? `&reviewer=${encodeURIComponent(reviewer)}` : ""}`,
        )
          .then((r) => {
            if (active) {
              if (page > r.pages) {
                setPage(r.pages);
                return;
              }
              setData(r);
              setResultKey(criteriaKey);
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
  }, [
    filter,
    query,
    from,
    to,
    reviewer,
    page,
    version,
    user.id,
    reviewerAccess,
    rangeError,
  ]);
  return (
    <>
      <section className="card records-card">
        <div className="record-filters">
          <div className="tabs">
            {[
              "",
              "待审核",
              ...(reviewerAccess ? ["过期未审核"] : []),
              "已通过",
              "未通过",
              "已撤回",
              "已取消",
            ].map((f) => (
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
          <span className="muted">
            {resultKey === criteriaKey && !rangeError && !error
              ? `共 ${data.total} 条申请`
              : "正在核对筛选条件"}
          </span>
        </div>
        <div className="form-columns history-filters">
          <label>
            提交开始日期（北京时间）
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            提交结束日期（北京时间）
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </label>
          {reviewerAccess && (
            <label>
              审批人
              <select
                aria-label="审批人"
                value={reviewer}
                onChange={(e) => {
                  setReviewer(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">全部审批人</option>
                {reviewers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <ErrorBox>{rangeError || reviewersError}</ErrorBox>
        <ErrorBox>{error}</ErrorBox>
        {rangeError ? (
          <p className="loading-block">
            请调整提交日期后查询，未显示旧筛选结果。
          </p>
        ) : error ? (
          <p className="loading-block">
            未能读取最新申请，请点击刷新重试；未显示旧筛选结果。
          </p>
        ) : loading || resultKey !== criteriaKey ? (
          <div className="loading-block">正在加载申请…</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>申报企业 / 编号</th>
                  <th>联系人</th>
                  <th>提交时间（北京时间）</th>
                  <th>布展时间</th>
                  <th>布展地点 / 搭建方</th>
                  <th>状态</th>
                  {reviewerAccess && <th>审批人</th>}
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
                      {new Date(b.created).toLocaleString("zh-CN", {
                        timeZone: "Asia/Shanghai",
                        hour12: false,
                      })}
                    </td>
                    <td>
                      {b.start}
                      <small>至 {b.end}</small>
                    </td>
                    <td>
                      <span>大活A座平台</span>
                      <small>
                        {b.builder_contact || "历史申请未提供搭建方"}
                      </small>
                      {b.builder_phone && <small>{b.builder_phone}</small>}
                    </td>
                    <td>
                      <Status value={b.status} />
                    </td>
                    {reviewerAccess && <td>{b.reviewerName || "未记录"}</td>}
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
                {filter || query || from || to || reviewer
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
              disabled={
                loading ||
                !!rangeError ||
                resultKey !== criteriaKey ||
                page <= 1
              }
              onClick={() => setPage((p) => p - 1)}
            >
              <ArrowLeft size={16} />
              上一页
            </Button>
            <Button
              className="secondary small"
              disabled={
                loading ||
                !!rangeError ||
                resultKey !== criteriaKey ||
                page >= data.pages
              }
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
