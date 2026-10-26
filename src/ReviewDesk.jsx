import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowsClockwise,
  CheckCircle,
  ClipboardText,
  MagnifyingGlass,
  WarningCircle,
} from "@phosphor-icons/react";
import { api, getDesign } from "./api.js";
import { Button, Empty, ErrorBox, Modal, Status } from "./components.jsx";
import { dateString } from "./utils.js";

const reasons = [
  "设计图内容不清晰，请上传清晰完整的桁架设计图。",
  "设计方案需调整，请核对场地布展要求后重新申报。",
  "搭建方联系人或联系方式需补充核实，请确认后重新申报。",
  "申请日期已过期，请调整日期后重新申报。",
];
function CheckSummary({ item }) {
  const check = item.reviewCheck;
  return (
    <div
      className={`review-check ${check?.blockers.length ? "has-conflict" : ""}`}
    >
      {check?.blockers.length ? (
        <WarningCircle size={20} />
      ) : (
        <CheckCircle size={20} />
      )}
      <div>
        <strong>
          {check
            ? check.blockers.length
              ? check.blockers.join("；")
              : "日期检查通过"
            : "正在核对申请信息"}
        </strong>
        <p>
          系统核对申请日期；请重点审阅桁架宣传内容、设计方案及搭建方联系方式。
        </p>
      </div>
    </div>
  );
}

export default function ReviewDesk({
  user,
  notify,
  onChange,
  history,
  onBusyChange,
  initialMode = "pending",
}) {
  const [mode, setMode] = useState(initialMode),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [order, setOrder] = useState("oldest");
  const [data, setData] = useState({ items: [], total: 0, pages: 1 }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [resultKey, setResultKey] = useState("");
  const [focused, setFocused] = useState(""),
    [selected, setSelected] = useState([]),
    [revision, setRevision] = useState(0),
    [batch, setBatch] = useState(null),
    [report, setReport] = useState(null),
    [busy, setBusy] = useState(false);
  function changeBusy(value) {
    // The shell must block navigation before a request yields, including before
    // React commits the local disabled controls.
    onBusyChange?.(value);
    setBusy(value);
  }
  const criteriaKey = JSON.stringify([query, page, order]);
  const snapshotVisible = resultKey === criteriaKey && !error;
  const ready = snapshotVisible && !loading;
  const refresh = () => setRevision((v) => v + 1);
  useEffect(() => {
    if (mode !== "pending") return;
    let active = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      api(
        `/bookings?status=${encodeURIComponent("待审核")}&q=${encodeURIComponent(query)}&page=${page}&order=${order}`,
      )
        .then((r) => {
          if (!active) return;
          if (page > r.pages) {
            setPage(r.pages);
            return;
          }
          setData(r);
          setResultKey(criteriaKey);
          setError("");
          setFocused((id) =>
            r.items.some((b) => b.id === id) ? id : r.items[0]?.id || "",
          );
        })
        .catch((e) => {
          if (!active) return;
          setError(e.message);
          setResultKey("");
        })
        .finally(() => active && setLoading(false));
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, page, order, revision, mode]);
  useEffect(() => {
    if (busy || batch || mode !== "pending") return;
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [busy, batch, mode]);
  const active = data.items.find((b) => b.id === focused);
  const index = data.items.findIndex((b) => b.id === focused);
  function processed(message) {
    setFocused(data.items[index + 1]?.id || data.items[index - 1]?.id || "");
    setSelected((rows) => rows.filter((b) => b.id !== focused));
    refresh();
    onChange();
    notify(message);
  }
  function changeFilter(update) {
    setSelected([]);
    setPage(1);
    update();
  }
  return (
    <div className="review-workspace">
      <div className="review-topbar">
        <div className="tabs" aria-label="审批视图">
          <button
            className={mode === "pending" ? "selected" : ""}
            onClick={() => setMode("pending")}
            disabled={busy}
          >
            待办审批
          </button>
          <button
            className={mode === "history" ? "selected" : ""}
            onClick={() => setMode("history")}
            disabled={busy}
          >
            全部申请与历史
          </button>
        </div>
        <span>重点审核宣传内容 · 系统核对日期</span>
      </div>
      {mode === "history" ? (
        history
      ) : (
        <>
          <section className="review-intro">
            <ClipboardText size={27} />
            <div>
              <h2>
                待办审批台 <strong>{snapshotVisible ? data.total : "—"}</strong>
              </h2>
              <p>
                左侧选申请，右侧核对材料；确认后自动切换下一条。批量处理仅作用于勾选的记录。
              </p>
            </div>
          </section>
          <div className="review-controls">
            <label className="search-input">
              <MagnifyingGlass size={18} />
              <input
                aria-label="搜索待办申请"
                placeholder="搜索企业、联系人、编号"
                value={query}
                disabled={busy}
                onChange={(e) => changeFilter(() => setQuery(e.target.value))}
              />
            </label>
            <select
              aria-label="待办排序"
              value={order}
              disabled={busy}
              onChange={(e) => changeFilter(() => setOrder(e.target.value))}
            >
              <option value="oldest">提交时间从早到晚</option>
              <option value="newest">最新提交优先</option>
            </select>
            <Button
              className="secondary small"
              onClick={refresh}
              disabled={loading || busy}
            >
              <ArrowsClockwise size={17} />
              刷新
            </Button>
          </div>
          <ErrorBox>{error}</ErrorBox>
          {report && (
            <div className="review-report" role="status">
              <strong>
                本次批量处理：成功 {report.filter((r) => r.ok).length}{" "}
                条，未完成 {report.filter((r) => !r.ok).length} 条
              </strong>
              {report
                .filter((r) => !r.ok)
                .map((r) => (
                  <p key={r.id}>
                    {r.company}：{r.error}
                  </p>
                ))}
              <button className="text-button" onClick={() => setReport(null)}>
                收起结果
              </button>
            </div>
          )}
          <div className="review-layout" aria-busy={loading}>
            <section className="card review-queue" aria-label="待办队列">
              <div className="review-queue-heading">
                <label>
                  <input
                    type="checkbox"
                    aria-label="选择本页全部申请"
                    checked={
                      !!data.items.length &&
                      data.items.every((b) =>
                        selected.some((s) => s.id === b.id),
                      )
                    }
                    disabled={!ready || busy}
                    onChange={(e) =>
                      setSelected(e.target.checked ? data.items : [])
                    }
                  />
                  本页全选
                </label>
                <span>
                  {loading
                    ? "正在同步…"
                    : ready
                      ? `共 ${data.total} 条`
                      : "请重新读取队列"}
                </span>
              </div>
              <div className="review-queue-items">
                <table>
                  <colgroup>
                    <col style={{ width: 38 }} />
                    <col />
                  </colgroup>
                  <thead className="sr-only">
                    <tr>
                      <th>选择</th>
                      <th>申请</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(snapshotVisible ? data.items : []).map((b) => (
                      <tr
                        key={b.id}
                        className={focused === b.id ? "is-active" : ""}
                      >
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`选择 ${b.company} ${b.id}`}
                            disabled={!ready || busy}
                            checked={selected.some((s) => s.id === b.id)}
                            onChange={(e) =>
                              setSelected((rows) =>
                                e.target.checked
                                  ? [...rows, b]
                                  : rows.filter((s) => s.id !== b.id),
                              )
                            }
                          />
                        </td>
                        <td>
                          <button
                            className="review-queue-item"
                            aria-label={`审核申请 ${b.company}`}
                            aria-pressed={focused === b.id}
                            disabled={busy || !ready}
                            onClick={() => setFocused(b.id)}
                          >
                            <strong>{b.company}</strong>
                            <span>大活A座平台</span>
                            <small>
                              {b.start} 至 {b.end}
                            </small>
                            <span
                              className={`review-flag ${b.reviewCheck?.blockers.length ? "blocked" : ""}`}
                            >
                              {b.reviewCheck?.blockers.length
                                ? b.reviewCheck.blockers.join("；")
                                : b.start === dateString()
                                  ? "今日开始 · 优先处理"
                                  : "日期检查通过"}
                            </span>
                            <small>
                              {b.contact} · {b.phone}
                            </small>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.items.length && ready && (
                  <Empty icon={CheckCircle} title="暂无待办申请">
                    新的申请会进入此队列，可调整搜索或查看历史。
                  </Empty>
                )}
              </div>
              <div className="review-selection">
                <span>已选 {selected.length} 条</span>
                <Button
                  className="secondary small"
                  disabled={!selected.length || !ready || busy}
                  onClick={() =>
                    setBatch({ rows: [...selected], status: "未通过" })
                  }
                >
                  批量退回
                </Button>
                <Button
                  className="primary small"
                  disabled={!selected.length || !ready || busy}
                  onClick={() =>
                    setBatch({ rows: [...selected], status: "已通过" })
                  }
                >
                  批量通过
                </Button>
              </div>
              <div className="pagination">
                <span>
                  {snapshotVisible
                    ? `${page} / ${data.pages} 页`
                    : "等待队列同步"}
                </span>
                <div>
                  <Button
                    className="secondary small"
                    aria-label="上一页待办"
                    disabled={page <= 1 || busy || !ready}
                    onClick={() => {
                      setSelected([]);
                      setPage((p) => p - 1);
                    }}
                  >
                    <ArrowLeft size={16} />
                  </Button>
                  <Button
                    className="secondary small"
                    aria-label="下一页待办"
                    disabled={page >= data.pages || busy || !ready}
                    onClick={() => {
                      setSelected([]);
                      setPage((p) => p + 1);
                    }}
                  >
                    <ArrowRight size={16} />
                  </Button>
                </div>
              </div>
            </section>
            {active && (
              <ReviewDetail
                key={active.id}
                item={active}
                user={user}
                disabled={!ready || busy}
                hidden={!snapshotVisible}
                setBusy={changeBusy}
                onProcessed={processed}
                onRefresh={(message) => {
                  refresh();
                  if (message) notify(message);
                }}
                onPrevious={() => setFocused(data.items[index - 1]?.id)}
                onNext={() => setFocused(data.items[index + 1]?.id)}
                hasPrevious={index > 0}
                hasNext={index < data.items.length - 1}
              />
            )}
            {(!active || !snapshotVisible) && (
              <section className="card review-detail">
                <Empty
                  title={
                    error
                      ? "审批队列读取失败"
                      : !ready
                        ? "正在加载审批队列"
                        : "当前没有待审材料"
                  }
                >
                  {error
                    ? "旧查询结果已暂停使用，请点击刷新重新核对后再审批。"
                    : "选择申请后，这里将展示桁架宣传内容、搭建方信息和审批操作。"}
                </Empty>
              </section>
            )}
          </div>
        </>
      )}
      {batch && (
        <BatchReview
          batch={batch}
          onClose={() => !busy && setBatch(null)}
          onBusy={changeBusy}
          onSaved={(results) => {
            setReport(
              results.map((r) => ({
                ...r,
                company: batch.rows.find((b) => b.id === r.id)?.company || r.id,
              })),
            );
            setBatch(null);
            setSelected([]);
            refresh();
            onChange();
            notify("批量处理完成，请查看逐条结果");
          }}
        />
      )}
    </div>
  );
}

function ReviewDetail({
  item,
  user,
  disabled,
  hidden,
  setBusy,
  onProcessed,
  onRefresh,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
}) {
  const imageSource = useRef(null);
  const requestPending = useRef(false);
  const [image, setImage] = useState(null),
    [imageError, setImageError] = useState(""),
    [imageReady, setImageReady] = useState(false),
    [imageLoading, setImageLoading] = useState(true),
    [imageRevision, setImageRevision] = useState(0),
    [error, setError] = useState(""),
    [reason, setReason] = useState(""),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true,
      blob;
    imageSource.current = null;
    setImage(null);
    setImageError("");
    setImageReady(false);
    setImageLoading(true);
    getDesign(item.id)
      .then((url) => {
        blob = url;
        if (active) {
          imageSource.current = url;
          setImage(url);
        } else URL.revokeObjectURL(url);
      })
      .catch((e) => {
        if (active) {
          setImageError(e.message);
          setImageLoading(false);
        }
      });
    return () => {
      active = false;
      if (imageSource.current === blob) imageSource.current = null;
      if (blob) URL.revokeObjectURL(blob);
    };
  }, [item.id, imageRevision]);
  function retryDesign() {
    if (disabled || saving || imageLoading) return;
    imageSource.current = null;
    setImage(null);
    setImageReady(false);
    setImageError("");
    setImageLoading(true);
    setImageRevision((value) => value + 1);
  }
  const reviewable = item.status === "待审核" && !item.reviewExpired;
  async function decide(status) {
    if (requestPending.current || disabled || saving || !reviewable) return;
    if (status === "已通过" && (!imageReady || imageLoading)) {
      setError("请先成功加载并核对桁架设计图后再通过审核");
      return;
    }
    if (status === "未通过" && !reason.trim()) {
      setError("请填写退回原因，或选择下方快捷意见");
      return;
    }
    requestPending.current = true;
    setBusy(true);
    setSaving(true);
    setError("");
    try {
      await api(`/bookings/${item.id}/review`, {
        method: "POST",
        headers: { "If-Match": `"${item.version}"` },
        body: { status, reason },
      });
      onProcessed(
        status === "已通过"
          ? "已通过，已切换至下一条待办"
          : "已退回，已切换至下一条待办",
      );
    } catch (e) {
      setError(e.message);
      if (e.status === 409) onRefresh(e.message);
    } finally {
      requestPending.current = false;
      setSaving(false);
      setBusy(false);
    }
  }
  return (
    <section
      className="card review-detail"
      aria-label="申请审阅区"
      hidden={hidden}
      style={hidden ? { display: "none" } : undefined}
    >
      <div
        className="review-material"
        tabIndex={0}
        aria-label="申请材料与设计图"
      >
        <div className="review-detail-heading">
          <div>
            <Status value={item.status} />
            <h2>{item.company}</h2>
            <small className="monospace">{item.id}</small>
            {item.reschedule_of && (
              <p className="field-note">
                改期申请 · 批准后替换原预约 {item.reschedule_of}
                ，退回时保留原预约。
              </p>
            )}
          </div>
          <div>
            <button
              className="icon-button"
              aria-label="上一条申请"
              disabled={!hasPrevious || disabled}
              onClick={onPrevious}
            >
              <ArrowLeft size={19} />
            </button>
            <button
              className="icon-button"
              aria-label="下一条申请"
              disabled={!hasNext || disabled}
              onClick={onNext}
            >
              <ArrowRight size={19} />
            </button>
          </div>
        </div>
        <dl className="review-facts">
          <div>
            <dt>布展地点</dt>
            <dd>大活A座平台</dd>
          </div>
          <div>
            <dt>布展日期</dt>
            <dd>
              {item.start} 至 {item.end}
            </dd>
          </div>
          <div>
            <dt>联系人</dt>
            <dd>
              {item.contact} · <a href={`tel:${item.phone}`}>{item.phone}</a>
            </dd>
          </div>
          <div>
            <dt>搭建方联系人</dt>
            <dd>{item.builder_contact || "历史申请未提供"}</dd>
          </div>
          <div>
            <dt>搭建方联系电话</dt>
            <dd>
              {item.builder_phone ? (
                <a href={`tel:${item.builder_phone}`}>{item.builder_phone}</a>
              ) : (
                "历史申请未提供"
              )}
            </dd>
          </div>
        </dl>
        <CheckSummary item={item} />
        <div className="review-design">
          <div>
            <h3>桁架设计图</h3>
            {image && (
              <a
                href={image}
                target="_blank"
                rel="noreferrer"
                className="text-button"
              >
                打开原图
              </a>
            )}
          </div>
          {image ? (
            <a href={image} target="_blank" rel="noreferrer">
              <img
                src={image}
                alt={`${item.company}的桁架设计图`}
                onLoad={() => {
                  if (imageSource.current !== image) return;
                  setImageReady(true);
                  setImageLoading(false);
                }}
                onError={() => {
                  if (imageSource.current !== image) return;
                  imageSource.current = null;
                  setImage(null);
                  setImageReady(false);
                  setImageLoading(false);
                  setImageError("设计图无法显示，请重新加载后再核对内容");
                }}
              />
            </a>
          ) : (
            <div className="image-placeholder">
              <p>{imageError || "正在加载设计图…"}</p>
              {imageError && (
                <Button
                  className="secondary small"
                  disabled={disabled || saving || imageLoading}
                  onClick={retryDesign}
                >
                  重新加载设计图
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="review-decision">
        <label>
          审核意见 <span className="muted">退回必填，通过可选</span>
          <textarea
            aria-label="审批意见"
            rows={2}
            maxLength={500}
            value={reason}
            disabled={disabled || saving || !reviewable}
            onChange={(e) => setReason(e.target.value)}
            placeholder="填写意见，或点选快捷原因后修改"
          />
        </label>
        <div className="review-templates" aria-label="快捷退回原因">
          {reasons.map((r, i) => (
            <button
              key={r}
              disabled={disabled || saving || !reviewable}
              onClick={() => setReason(r)}
            >
              {["设计图不清晰", "方案需调整", "搭建方需核实", "日期过期"][i]}
            </button>
          ))}
        </div>
        <ErrorBox>{error}</ErrorBox>
        <div className="review-decision-actions">
          <Button
            className="danger-outline"
            disabled={disabled || saving || !reviewable}
            onClick={() => decide("未通过")}
          >
            退回并审阅下一条
          </Button>
          <Button
            className="primary"
            loading={saving}
            disabled={
              disabled ||
              !reviewable ||
              imageLoading ||
              !imageReady ||
              !item.reviewCheck ||
              !!item.reviewCheck.blockers.length ||
              user.id === item.user_id
            }
            onClick={() => decide("已通过")}
          >
            <CheckCircle size={18} />
            通过并审阅下一条
          </Button>
        </div>
      </div>
    </section>
  );
}

function BatchReview({ batch, onClose, onBusy, onSaved }) {
  const requestPending = useRef(false);
  const [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const approve = batch.status === "已通过";
  const unreviewable = batch.rows.some(
    (b) => b.status !== "待审核" || b.reviewExpired,
  );
  const blocked =
    unreviewable ||
    (approve && batch.rows.some((b) => b.reviewCheck?.blockers.length));
  async function submit(e) {
    e.preventDefault();
    if (
      requestPending.current ||
      busy ||
      blocked ||
      !confirmed ||
      (!approve && !reason.trim())
    )
      return;
    requestPending.current = true;
    onBusy(true);
    setBusy(true);
    setError("");
    try {
      const r = await api("/bookings/review-batch", {
        method: "POST",
        body: {
          status: batch.status,
          reason,
          items: batch.rows.map((b) => ({ id: b.id, version: b.version })),
        },
      });
      onSaved(r.results);
    } catch (e) {
      setError(
        `${e.message}。若请求曾到达服务端，部分记录可能已处理，请刷新队列核对后再操作。`,
      );
    } finally {
      requestPending.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <Modal
      title={approve ? "确认批量通过" : "确认批量退回"}
      description={`将处理以下 ${batch.rows.length} 条申请，每条结果独立保存，已过期、版本变化或已处理的申请会跳过。`}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        <div className="batch-preview">
          {batch.rows.map((b) => (
            <div key={b.id}>
              <strong>{b.company}</strong>
              <span>
                大活A座平台 · {b.start} 至 {b.end}
              </span>
              <small>
                {b.reviewCheck?.blockers.join("；") ||
                  "日期检查通过，请确认宣传内容及搭建方信息"}
              </small>
            </div>
          ))}
        </div>
        {blocked && (
          <ErrorBox>
            所选申请包含无法通过的记录，请核对日期及申请信息后重新勾选。
          </ErrorBox>
        )}
        <label>
          统一审核意见{!approve && "（必填）"}
          <textarea
            aria-label="批量审核意见"
            required={!approve}
            maxLength={500}
            rows={3}
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {!approve && (
          <div className="review-templates">
            {reasons.map((r, i) => (
              <button
                type="button"
                disabled={busy}
                key={r}
                onClick={() => setReason(r)}
              >
                {["设计图不清晰", "方案需调整", "搭建方需核实", "日期过期"][i]}
              </button>
            ))}
          </div>
        )}
        <label className="checkbox-label">
          <input
            type="checkbox"
            required
            checked={confirmed}
            disabled={busy}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          {approve
            ? "我已核对所选申请及设计图，确认通过"
            : "我已核对所选申请，确认以以上意见退回"}
        </label>
        <ErrorBox>{error}</ErrorBox>
        <div className="dialog-actions">
          <Button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            type="submit"
            className={approve ? "primary" : "danger-outline"}
            loading={busy}
            disabled={!confirmed || blocked || (!approve && !reason.trim())}
          >
            确认{approve ? "通过" : "退回"} {batch.rows.length} 条
          </Button>
        </div>
      </form>
    </Modal>
  );
}
