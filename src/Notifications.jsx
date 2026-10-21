import React, { useEffect, useState, useRef } from "react";
import { api } from "./api.js";
import { Button, Empty, ErrorBox } from "./components.jsx";
import { BookingDetail } from "./Booking.jsx";
import { can } from "./permissions.js";
export default function Notifications({
  user,
  version,
  onNavigate,
  onRefresh,
  notify,
}) {
  const request = useRef(0),
    pageRef = useRef(1);
  const [data, setData] = useState({ items: [], unread: 0, pages: 1 }),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [detail, setDetail] = useState(null),
    [loading, setLoading] = useState(true);
  pageRef.current = page;
  async function load() {
    const id = ++request.current;
    setLoading(true);
    try {
      const r = await api("/notifications?page=" + pageRef.current);
      if (id !== request.current) return;
      if (r.page > r.pages) {
        setPage(r.pages);
        return;
      }
      setData(r);
      setError("");
    } catch (e) {
      if (id === request.current) setError(e.message);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    load();
    return () => {
      request.current++;
    };
  }, [page, version]);
  async function read(item) {
    setBusy(true);
    try {
      await api("/notifications/read", {
        method: "POST",
        body: item ? { id: item.id } : {},
      });
      await load();
      if (
        item &&
        ((can(user, "payments.manage") && !can(user, "bookings.review")) ||
          item.title === "超时待办提醒")
      )
        onNavigate("casework");
      else if (item?.target)
        setDetail(
          (await api("/bookings/" + encodeURIComponent(item.target))).booking,
        );
      else if (item) onNavigate("records");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card notification-card">
      <div className="card-header">
        <div>
          <h2>
            办理消息 <span className="subtle-tag">{data.unread} 条未读</span>
          </h2>
          <p>审批结果、预约取消与待办提醒。</p>
        </div>
        <Button
          className="secondary small"
          disabled={busy || !data.unread}
          onClick={() => read()}
        >
          全部标为已读
        </Button>
      </div>
      <ErrorBox>{error}</ErrorBox>
      {data.items.length ? (
        <div className="notification-items">
          {data.items.map((n) => (
            <button
              key={n.id}
              className={!n.read_at ? "unread" : ""}
              disabled={busy || loading}
              onClick={() => read(n)}
            >
              <span>
                <strong>{n.title}</strong>
                <small>{new Date(n.created).toLocaleString("zh-CN")}</small>
              </span>
              <p>{n.content}</p>
              <small>{n.target ? "打开申请详情" : "进入审批待办"}</small>
            </button>
          ))}
        </div>
      ) : (
        <Empty title="暂无办理消息">新的业务消息会显示在这里。</Empty>
      )}
      {data.pages > 1 && (
        <div className="pagination">
          <span>
            {page} / {data.pages} 页
          </span>
          <div>
            <Button
              className="secondary small"
              disabled={page <= 1 || busy || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              上一页
            </Button>
            <Button
              className="secondary small"
              disabled={page >= data.pages || busy || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
      {detail && (
        <BookingDetail
          key={detail.id}
          item={detail}
          user={user}
          onClose={() => setDetail(null)}
          onSaved={(message) => {
            setDetail(null);
            load();
            onRefresh();
            notify(message);
          }}
        />
      )}
    </section>
  );
}
