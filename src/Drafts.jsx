import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { Button, ErrorBox } from "./components.jsx";
import { formatDate } from "./utils.js";

export default function Drafts({ onOpen, notify }) {
  const [items, setItems] = useState([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const mounted = useRef(true),
    generation = useRef(0);
  async function load() {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await api("/drafts");
      if (mounted.current && current === generation.current)
        setItems(result.items);
    } catch (e) {
      if (mounted.current && current === generation.current) {
        setItems([]);
        setError(e.message);
      }
    } finally {
      if (mounted.current && current === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  async function act(item, remove = false) {
    if (busy || loading) return;
    if (
      remove &&
      !window.confirm("确定删除此草稿及其设计图？此操作不会影响已提交申请。")
    )
      return;
    setBusy(true);
    setError("");
    try {
      if (remove) {
        await api(`/drafts/${item.id}`, {
          method: "DELETE",
          headers: { "If-Match": `"${item.version}"` },
        });
        if (mounted.current) {
          notify?.("草稿已删除");
          await load();
        }
      } else {
        const result = await api(`/drafts/${item.id}`);
        if (mounted.current) onOpen(result.draft);
      }
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>申请草稿</h2>
          <p>仅本人可见。保存草稿不代表已提交审核；最多保留20份。</p>
        </div>
        <Button className="secondary" disabled={busy || loading} onClick={load}>
          刷新草稿
        </Button>
      </div>
      <ErrorBox>{error}</ErrorBox>
      {loading ? (
        <p role="status">正在读取草稿…</p>
      ) : !error && !items.length ? (
        <p>暂无保存的草稿。填写申请时可点击“保存草稿”。</p>
      ) : (
        items.map((item) => (
          <article className="notice-article" key={item.id}>
            <div>
              <h3>{item.payload.company || "未填写企业名称"}</h3>
              <p>
                {item.payload.start || "日期待填"} 至{" "}
                {item.payload.end || "日期待填"}
              </p>
              <small>最后保存：{formatDate(item.updated)}</small>
              {item.payload.source_booking_id && (
                <p>复制自 {item.payload.source_booking_id}</p>
              )}
            </div>
            <div className="row-actions">
              <Button
                className="primary"
                disabled={busy}
                onClick={() => act(item)}
              >
                继续填写
              </Button>
              <Button
                className="danger-outline"
                disabled={busy}
                onClick={() => act(item, true)}
              >
                删除草稿
              </Button>
            </div>
          </article>
        ))
      )}
    </section>
  );
}
