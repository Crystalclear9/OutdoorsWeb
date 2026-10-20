import React, { useState, useEffect } from "react";
import { Desktop, SignOut } from "@phosphor-icons/react";
import { api } from "./api.js";
import { Button, ErrorBox } from "./components.jsx";

export default function Sessions({ notify }) {
  const [items, setItems] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  async function load() {
    try {
      setItems((await api("/auth/sessions")).items);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function revoke(id) {
    setBusy(id);
    setError("");
    try {
      await api(
        id === "others" ? "/auth/logout-others" : `/auth/sessions/${id}`,
        { method: id === "others" ? "POST" : "DELETE" },
      );
      notify("登录会话已撤销");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
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
          disabled={!!busy || items.filter((s) => !s.current).length === 0}
          onClick={() => revoke("others")}
        >
          退出其他设备
        </Button>
      </div>
      <ErrorBox>{error}</ErrorBox>
      <div className="session-list">
        {items.map((s) => (
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
                disabled={!!busy}
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
