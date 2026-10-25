import React, { useEffect, useState, useRef } from "react";
import { api } from "./api.js";
import { Button, ErrorBox, Modal, Pagination } from "./components.jsx";
const labels = {
  pending: "等待发送",
  sending: "发送中",
  accepted: "服务商已受理",
  failed: "失败",
  uncertain: "需核实",
  cancelled: "已取消",
};
export default function Deliveries({ notify }) {
  const [data, setData] = useState({ items: [], page: 1, pages: 1, total: 0 }),
    [scope, setScope] = useState("attention"),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState(null),
    [error, setError] = useState(""),
    [readError, setReadError] = useState(""),
    [resultKey, setResultKey] = useState(""),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const request = useRef(0);
  const criteriaKey = JSON.stringify([scope, page]);
  const ready = !loading && !readError && resultKey === criteriaKey;
  const showSnapshot = !!selected || (!readError && resultKey === criteriaKey);
  const items = showSnapshot ? data.items : [];
  async function load() {
    const generation = ++request.current;
    setLoading(true);
    setReadError("");
    try {
      const result = await api(
        `/operations/deliveries?scope=${scope}&page=${page}`,
      );
      // A slow poll from the previous filter must not replace the current list.
      if (generation !== request.current) return;
      setData(result);
      setPage(result.page);
      setResultKey(JSON.stringify([scope, result.page]));
      setReadError("");
    } catch (e) {
      if (generation === request.current) setReadError(e.message);
    } finally {
      if (generation === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    let stopped = false,
      timer;
    // Editing owns a stable snapshot. Neither a new read nor an old poll may
    // replace it or clear the result of the reconciliation write.
    if (selected) setLoading(false);
    else {
      const poll = async () => {
        await load();
        if (!stopped) timer = setTimeout(poll, 15000);
      };
      poll();
    }
    return () => {
      stopped = true;
      clearTimeout(timer);
      request.current++;
    };
  }, [scope, page, !!selected, refresh]);
  async function save(e) {
    e.preventDefault();
    if (busy || !selected) return;
    const values = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError("");
    try {
      await api(`/operations/deliveries/${selected.id}`, {
        method: "POST",
        body: {
          ...values,
          version: selected.version,
        },
      });
      setSelected(null);
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
            优先处理失败和需核实的任务；全部记录支持翻页。先核实服务商受理情况，再决定是否重试。
          </p>
        </div>
      </div>
      <label>
        通知范围
        <select
          value={scope}
          disabled={busy || !!selected}
          onChange={(e) => {
            request.current++;
            setScope(e.target.value);
            setPage(1);
          }}
        >
          <option value="attention">待处理通知</option>
          <option value="all">全部通知记录</option>
        </select>
      </label>
      <Button
        className="secondary small"
        disabled={busy || loading || !!selected}
        onClick={() => setRefresh((value) => value + 1)}
      >
        刷新通知记录
      </Button>
      <ErrorBox>{!selected && readError}</ErrorBox>
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
                      disabled={busy || !ready || !!selected}
                      onClick={() => {
                        if (busy || !ready || selected) return;
                        request.current++;
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
        {!items.length && (
          <p className="empty-state">
            {loading
              ? "正在读取通知记录…"
              : readError
                ? "通知记录读取失败，请刷新重试"
                : scope === "attention"
                  ? "暂无待处理通知"
                  : "尚无外发通知"}
          </p>
        )}
      </div>
      {showSnapshot && (
        <fieldset
          disabled={busy || !ready || !!selected}
          style={{ border: 0, padding: 0 }}
        >
          <Pagination
            page={data.page}
            pages={data.pages}
            total={data.total}
            onPage={setPage}
          />
        </fieldset>
      )}
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
                type="button"
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
