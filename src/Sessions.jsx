import React, { useState, useEffect, useRef } from "react";
import { Desktop, SignOut } from "@phosphor-icons/react";
import { api } from "./api.js";
import { Button, ErrorBox } from "./components.jsx";

export default function Sessions({ notify }) {
  const [items, setItems] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [loading, setLoading] = useState(true),
    [readFailed, setReadFailed] = useState(false);
  const mounted = useRef(true),
    request = useRef(0);
  async function load(saved = "") {
    if (!mounted.current) return;
    const generation = ++request.current;
    setLoading(true);
    setError("");
    try {
      const result = await api("/auth/sessions");
      if (!mounted.current || generation !== request.current) return;
      setItems(result.items);
      setReadFailed(false);
    } catch (e) {
      if (!mounted.current || generation !== request.current) return;
      setItems([]);
      setReadFailed(true);
      setError(
        saved
          ? `${saved}，但设备列表读取失败：${e.message}。请重新读取后核对。`
          : e.message,
      );
    } finally {
      if (mounted.current && generation === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, []);
  async function revoke(id) {
    if (busy || loading || readFailed) return;
    setBusy(id);
    setError("");
    try {
      await api(
        id === "others" ? "/auth/logout-others" : `/auth/sessions/${id}`,
        { method: id === "others" ? "POST" : "DELETE" },
      );
      if (mounted.current) notify("登录会话已撤销");
      await load("登录会话已撤销");
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      if (mounted.current) setBusy("");
    }
  }
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>登录设备与授权会话</h2>
          <p>查看仍有效的登录，发现陌生设备时可立即退出。</p>
        </div>
        <Button
          className="secondary small"
          loading={busy === "others"}
          disabled={
            !!busy ||
            loading ||
            readFailed ||
            items.filter((s) => !s.current).length === 0
          }
          onClick={() => revoke("others")}
        >
          退出其他设备
        </Button>
      </div>
      <ErrorBox>{error}</ErrorBox>
      {readFailed && (
        <Button
          className="secondary small"
          disabled={!!busy || loading}
          onClick={() => load()}
        >
          重新读取登录设备
        </Button>
      )}
      {loading && <p className="field-note">正在读取登录设备…</p>}
      <div className="session-list">
        {!loading &&
          items.map((s) => (
            <div key={s.id}>
              <Desktop size={23} />
              <div>
                <strong>{s.current ? "当前设备" : "其他登录设备"}</strong>
                <p>{s.agent || "浏览器信息未知"}</p>
                <small>
                  {s.created
                    ? `登录于 ${new Date(s.created).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`
                    : "历史会话"}{" "}
                  ·{" "}
                  {new Date(s.expires).toLocaleDateString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                  })}{" "}
                  到期
                </small>
              </div>
              {s.current ? (
                <span className="subtle-tag">当前会话</span>
              ) : (
                <Button
                  className="secondary small"
                  disabled={!!busy || loading || readFailed}
                  loading={busy === s.id}
                  onClick={() => revoke(s.id)}
                >
                  <SignOut size={16} />
                  退出
                </Button>
              )}
            </div>
          ))}
      </div>
    </section>
  );
}
