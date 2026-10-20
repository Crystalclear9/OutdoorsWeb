import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { Button, Empty, ErrorBox } from "./components.jsx";
export default function Notifications({ version, onNavigate }) {
  const [data, setData] = useState({ items: [], unread: 0, pages: 1 }),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      setData(await api("/notifications?page=" + page));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, [page, version]);
  async function read(item) {
    setBusy(true);
    try {
      await api("/notifications/read", {
        method: "POST",
        body: item ? { id: item.id } : {},
      });
      await load();
      if (item) onNavigate("records");
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
              disabled={busy}
              onClick={() => read(n)}
            >
              <span>
                <strong>{n.title}</strong>
                <small>{new Date(n.created).toLocaleString("zh-CN")}</small>
              </span>
              <p>{n.content}</p>
              <small>查看相关申请</small>
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
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              上一页
            </Button>
            <Button
              className="secondary small"
              disabled={page >= data.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
