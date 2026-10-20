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
            <div>
              <span>异机加密备份</span>
              <strong>
                {data.offsiteConfigured
                  ? data.offsite?.verified
                    ? "复制并校验成功"
                    : "等待成功复制"
                  : "尚未配置"}
              </strong>
              <small>
                {data.offsite?.at ? format(data.offsite.at) : "S3 兼容对象存储"}
              </small>
            </div>
            <div>
              <span>外部故障告警</span>
              <strong>
                {data.alertConfigured
                  ? data.externalAlert?.ok === false
                    ? "告警发送失败"
                    : "已配置"
                  : "尚未配置"}
              </strong>
              <small>
                {data.externalAlert?.at
                  ? format(data.externalAlert.at)
                  : "数据库、磁盘、备份、通知队列异常"}
              </small>
            </div>
            <div>
              <span>短信与电话通知</span>
              <strong>
                {data.communicationConfigured ? "已配置服务商" : "尚未配置"}
              </strong>
              <small>
                {data.deliveries
                  .map(
                    (r) =>
                      `${{ pending: "待发送", sending: "发送中", accepted: "服务商已受理", failed: "失败", uncertain: "需核实", cancelled: "已取消" }[r.state] || r.state} ${r.count}`,
                  )
                  .join(" · ") || "暂无外发任务"}
              </small>
            </div>
            <div>
              <span>历史资料归档</span>
              <strong>{data.archiveCount} 份</strong>
              <small>随数据库一起备份，设计图仍按原权限访问</small>
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
              自动清理保留预约与账号；超过保留期的设计图和审计日志完整归档，随数据库备份。默认保留
              365 天热数据，每次分批处理以减少审批阻塞。
            </p>
            {data.offsite?.error && <ErrorBox>{data.offsite.error}</ErrorBox>}
            {data.externalAlert?.error && (
              <ErrorBox>{data.externalAlert.error}</ErrorBox>
            )}
            <p>
              服务商受理不等于用户已收到。标记“需核实”的电话任务请先在服务商后台确认；系统不会自动重复拨打。网站进程停止时，需由独立监控服务探测健康检查地址。
            </p>
          </div>
        </>
      )}
    </section>
  );
}
