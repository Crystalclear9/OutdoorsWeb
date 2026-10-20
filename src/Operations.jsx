import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { Button, ErrorBox } from "./components.jsx";
export default function Operations({ notify }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      setData(await api("/operations"));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
    const timer = setInterval(load, data?.running ? 1500 : 10000);
    return () => clearInterval(timer);
  }, [data?.running]);
  async function run() {
    setBusy(true);
    try {
      await api("/operations/run", { method: "POST" });
      notify("备份和清理已在后台启动");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const format = (v) =>
    v ? new Date(v).toLocaleString("zh-CN") : "尚无成功记录";
  return (
    <section className="card operations-card">
      <div className="card-header">
        <div>
          <h2>运行与维护</h2>
          <p>自动检查数据库、磁盘空间和定时备份，失败信息在这里查看。</p>
        </div>
        <Button
          className="primary"
          loading={busy}
          disabled={!data || data.running}
          onClick={run}
        >
          {data?.running ? "正在后台执行" : "立即备份并清理"}
        </Button>
      </div>
      <ErrorBox>{error}</ErrorBox>
      {data && (
        <>
          <div className="operations-grid">
            <div>
              <span>数据库与存储</span>
              <strong>{data.health.ok ? "检查正常" : "需要处理"}</strong>
              <small>
                剩余空间{" "}
                {data.health.freeBytes === null
                  ? "—"
                  : (data.health.freeBytes / 1073741824).toFixed(1) + " GB"}
              </small>
            </div>
            <div>
              <span>最近成功备份</span>
              <strong>{format(data.backup?.at)}</strong>
              <small>{data.backup?.file || "后台维护启动后自动生成"}</small>
            </div>
            <div>
              <span>自动备份计划</span>
              <strong>
                {data.backupHours
                  ? `每 ${data.backupHours} 小时`
                  : "已关闭自动备份"}
              </strong>
              <small>保留最近 {data.keep} 份完整性检查通过的备份</small>
            </div>
            <div>
              <span>超时待办</span>
              <strong>{data.pendingOver24} 条</strong>
              <small>提交超过 24 小时仍待审核</small>
            </div>
          </div>
          {data.warnings.map((w) => (
            <ErrorBox key={w}>{w}</ErrorBox>
          ))}
          <div className="operations-detail">
            <h3>最近一次维护</h3>
            <p>
              {format(data.maintenance?.at)} ·{" "}
              {data.running
                ? "执行中"
                : data.maintenance
                  ? data.maintenance.ok
                    ? "成功"
                    : "失败"
                  : "等待执行"}
            </p>
            {data.maintenance?.error && (
              <ErrorBox>{data.maintenance.error}</ErrorBox>
            )}
            {data.maintenance?.removed && (
              <p>
                已清理：验证码 {data.maintenance.removed.captchas}、过期会话{" "}
                {data.maintenance.removed.sessions}、限流记录{" "}
                {data.maintenance.removed.rateLimits}、过期幂等标识{" "}
                {data.maintenance.removed.idempotency}、已读旧消息{" "}
                {data.maintenance.removed.readNotifications}。
              </p>
            )}
            <p>
              自动清理不删除预约、设计图、账号或审计日志。默认备份位于同一数据卷，请定期复制到另一台设备；本机备份不能覆盖整机损坏的风险。
            </p>
            <p>外部告警与异机备份需要运维配置，当前页面不会代替外部监控。</p>
          </div>
        </>
      )}
    </section>
  );
}
