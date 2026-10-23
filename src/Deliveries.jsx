import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { Button, ErrorBox, Modal } from "./components.jsx";
const labels = {
  pending: "等待发送",
  sending: "发送中",
  accepted: "服务商已受理",
  failed: "失败",
  uncertain: "需核实",
  cancelled: "已取消",
};
export default function Deliveries({ notify }) {
  const [items, setItems] = useState([]),
    [selected, setSelected] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api("/operations/deliveries")
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);
  async function save(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/operations/deliveries/${selected.id}`, {
        method: "POST",
        body: {
          ...Object.fromEntries(new FormData(e.currentTarget)),
          version: selected.version,
        },
      });
      setSelected(null);
      load();
      notify("通知任务已更新");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>结果通知发送记录</h2>
          <p>
            最近 50
            条短信或电话任务。先核实不确定的任务，再决定是否重试，避免重复打扰。
          </p>
        </div>
      </div>
      <ErrorBox>{!selected && error}</ErrorBox>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>时间 / 关联申请</th>
              <th>方式 / 号码</th>
              <th>状态</th>
              <th>处理</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td>
                  {new Date(r.created).toLocaleString("zh-CN")}
                  <small>{r.bookingId}</small>
                </td>
                <td>
                  {r.kind === "voice" ? "电话" : "短信"}
                  <small>{r.phone}</small>
                </td>
                <td>
                  {labels[r.state]}
                  <small>{r.last_error}</small>
                </td>
                <td>
                  {["failed", "uncertain"].includes(r.state) && (
                    <Button
                      className="secondary small"
                      disabled={busy}
                      onClick={() => {
                        if (busy) return;
                        setSelected(r);
                        setError("");
                      }}
                    >
                      核实处理
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <p className="empty-state">尚无外发通知</p>}
      </div>
      {selected && (
        <Modal
          title="核实通知发送结果"
          description="请先查询服务商后台的发送记录。"
          onClose={() => !busy && setSelected(null)}
        >
          <form onSubmit={save}>
            <label>
              核实结果
              <select name="action" disabled={busy}>
                <option value="accepted">已受理，结束任务</option>
                <option value="failed">确认未受理，标记失败</option>
                {selected.state === "failed" && (
                  <option value="retry">重新发送一次</option>
                )}
              </select>
            </label>
            <label>
              核实依据或服务商编号
              <textarea
                name="reason"
                maxLength={300}
                required
                disabled={busy}
              />
            </label>
            <ErrorBox>{error}</ErrorBox>
            <div className="dialog-actions">
              <Button
                className="secondary"
                disabled={busy}
                onClick={() => !busy && setSelected(null)}
              >
                取消
              </Button>
              <Button className="primary" loading={busy} type="submit">
                保存处理结果
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
