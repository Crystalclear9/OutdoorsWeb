import React, { lazy, Suspense, useState, useEffect, useRef } from "react";
import {
  UploadSimple,
  FileImage,
  CheckCircle,
  ArrowRight,
  DownloadSimple,
  Clock,
  XCircle,
} from "@phosphor-icons/react";
import { Button, ErrorBox, Modal, Status } from "./components.jsx";
import { api, getDesign } from "./api.js";
import { can } from "./permissions.js";
import { dateString, slotName, zoneName, formatDate } from "./utils.js";
import LazyPageBoundary from "./LazyPageBoundary.jsx";
const CasePanel = lazy(() =>
  import("./Casework.jsx").then((module) => ({ default: module.CasePanel })),
);

export function BookingForm({ user, slot, date, onClose, onSaved }) {
  const request = useRef(null);
  const currentReader = useRef(null);
  const [image, setImage] = useState(null),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [imageLoading, setImageLoading] = useState(false);
  useEffect(
    () => () => {
      const reader = currentReader.current;
      currentReader.current = null;
      reader?.abort();
    },
    [],
  );
  function upload(e) {
    if (busy) return;
    const f = e.target.files[0];
    if (!f) return;
    const previous = currentReader.current;
    currentReader.current = null;
    previous?.abort();
    setImage(null);
    setName("");
    setImageLoading(false);
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(f.type) ||
      f.size > 3 * 1024 * 1024
    ) {
      setError("请选择 3 MB 以内的 JPG、PNG 或 WebP 图片");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    currentReader.current = reader;
    setImageLoading(true);
    setError("");
    reader.onload = () => {
      if (currentReader.current !== reader) return;
      currentReader.current = null;
      setImage(reader.result);
      setName(f.name);
      setError("");
      setImageLoading(false);
    };
    reader.onerror = () => {
      if (currentReader.current !== reader) return;
      currentReader.current = null;
      setImageLoading(false);
      setError("无法读取图片，请重试");
    };
    reader.readAsDataURL(f);
  }
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (imageLoading) return setError("设计图仍在读取，请稍后提交");
    if (!image) return setError("请上传桁架设计图");
    const payload = {
      ...Object.fromEntries(new FormData(e.currentTarget)),
      image,
    };
    setBusy(true);
    try {
      const fingerprint = JSON.stringify(payload);
      if (request.current?.fingerprint !== fingerprint)
        request.current = {
          fingerprint,
          key: Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
            b.toString(16).padStart(2, "0"),
          ).join(""),
        };
      await api("/bookings", {
        method: "POST",
        headers: { "Idempotency-Key": request.current.key },
        body: payload,
      });
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="提交布展申请"
      description="信息将提交至大学生活动中心审核，您可在申请记录中查看结果。"
      onClose={() => !busy && onClose()}
      wide
    >
      <form onSubmit={submit}>
        <div className="booking-form-grid">
          <div>
            <h3 className="form-section-title">
              <span>01</span>企业与联系人
            </h3>
            <label>
              企业名称
              <input
                name="company"
                disabled={busy}
                required
                maxLength={80}
                defaultValue={user.company}
              />
            </label>
            <div className="form-columns">
              <label>
                联系人
                <input
                  name="contact"
                  disabled={busy}
                  required
                  maxLength={30}
                  defaultValue={user.contact}
                />
              </label>
              <label>
                联系电话
                <input
                  name="phone"
                  disabled={busy}
                  type="tel"
                  pattern="1[0-9]{10}"
                  maxLength={11}
                  required
                  defaultValue={user.phone}
                />
              </label>
            </div>
            <h3 className="form-section-title">
              <span>02</span>布展时间与位置
            </h3>
            <div className="form-columns">
              <label>
                开始日期
                <input
                  name="start"
                  disabled={busy}
                  required
                  type="date"
                  min={dateString()}
                  defaultValue={date < dateString() ? dateString() : date}
                />
              </label>
              <label>
                结束日期
                <input
                  name="end"
                  disabled={busy}
                  required
                  type="date"
                  min={dateString()}
                  defaultValue={date < dateString() ? dateString() : date}
                />
              </label>
            </div>
            <p className="field-note">
              每次申请最多 3 天，包含开始和结束日期。
            </p>
            <label>
              桁架位置
              <select name="slot" defaultValue={slot} disabled={busy}>
                {Array.from({ length: 29 }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {slotName(i + 1)} · {zoneName(i + 1)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <h3 className="form-section-title">
              <span>03</span>桁架设计图
            </h3>
            <label className={`upload-area ${image ? "has-image" : ""}`}>
              <input
                aria-label="上传桁架设计图"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={upload}
              />
              {image ? (
                <>
                  <img src={image} alt="待提交桁架设计图" />
                  <strong>{name}</strong>
                  <span>点击更换图片</span>
                </>
              ) : (
                <>
                  <span className="upload-icon">
                    <UploadSimple size={31} />
                  </span>
                  <strong>
                    {imageLoading ? "正在读取设计图…" : "上传您的设计方案"}
                  </strong>
                  <span>点击选择图片</span>
                  <small>JPG、PNG、WebP · 最大 3 MB</small>
                </>
              )}
            </label>
            <div className="info-box">
              <FileImage size={20} />
              <p>
                设计图应清晰展示活动主题、宣传内容及桁架方案，便于管理员审核。
              </p>
            </div>
          </div>
        </div>
        <label className="check-label">
          <input type="checkbox" required disabled={busy} />
          我确认申报信息真实，并遵守校园场地管理要求。
        </label>
        <ErrorBox>{error}</ErrorBox>
        <div className="dialog-actions">
          <span>
            <CheckCircle size={16} />
            提交后可在审核前撤回
          </span>
          <Button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            loading={busy}
            disabled={imageLoading || !image}
            className="primary"
            type="submit"
          >
            提交申请
            <ArrowRight size={17} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function BookingDetail({ item: initial, user, onClose, onSaved }) {
  const [caseOpen, setCaseOpen] = useState(false);
  const [caseBusy, setCaseBusy] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [item, setItem] = useState(initial);
  const [cancelling, setCancelling] = useState(false),
    [cancelReason, setCancelReason] = useState(""),
    [cancelConfirmed, setCancelConfirmed] = useState(false);
  const [image, setImage] = useState(null),
    [imageError, setImageError] = useState(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const blocked = !!busy || caseBusy;
  useEffect(() => {
    let active = true,
      url;
    getDesign(item.id)
      .then((value) => {
        url = value;
        if (active) setImage(value);
        else URL.revokeObjectURL(value);
      })
      .catch((e) => active && setImageError(e.message));
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.id]);
  async function action(type, status) {
    if (blocked) return;
    setBusy(status || type);
    setError("");
    try {
      await api(`/bookings/${item.id}/${type}`, {
        method: "POST",
        headers: { "If-Match": `"${item.version}"` },
        ...(type === "review"
          ? { body: { status, reason } }
          : type === "cancel"
            ? { body: { reason: cancelReason } }
            : {}),
      });
      onSaved(
        type === "withdraw"
          ? "申请已撤回"
          : type === "cancel"
            ? "预约已取消，桁架位置已释放"
            : `申请${status}`,
      );
    } catch (e) {
      setError(e.message);
      if (e.status === 409) {
        try {
          setItem((await api(`/bookings/${item.id}`)).booking);
        } catch {
          /* Authorization failures are handled globally. */
        }
      }
    } finally {
      setBusy("");
    }
  }
  async function reschedule(e) {
    e.preventDefault();
    if (blocked) return;
    setBusy("reschedule");
    setError("");
    try {
      await api(`/bookings/${item.id}/reschedule`, {
        method: "POST",
        headers: { "If-Match": `"${item.version}"` },
        body: Object.fromEntries(new FormData(e.currentTarget)),
      });
      onSaved("改期申请已提交，原预约继续保留至改期批准");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  if (rescheduling)
    return (
      <Modal
        title="申请改期或更换位置"
        description={`原预约：${item.start} 至 ${item.end} · ${slotName(item.slot)}`}
        onClose={() => !blocked && setRescheduling(false)}
      >
        <form onSubmit={reschedule}>
          <div className="info-box">
            <p>
              审批前保留原预约。新申请被退回或撤回时，原预约不受影响；批准后自动替换。沿用原企业资料和设计图。
            </p>
          </div>
          <div className="form-columns">
            <label>
              新开始日期
              <input
                type="date"
                name="start"
                min={dateString()}
                defaultValue={item.start}
                disabled={blocked}
                required
              />
            </label>
            <label>
              新结束日期
              <input
                type="date"
                name="end"
                min={dateString()}
                defaultValue={item.end}
                disabled={blocked}
                required
              />
            </label>
          </div>
          <label>
            新桁架位置
            <select name="slot" defaultValue={item.slot} disabled={blocked}>
              {Array.from({ length: 29 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {slotName(i + 1)} · {zoneName(i + 1)}
                </option>
              ))}
            </select>
          </label>
          <ErrorBox>{error}</ErrorBox>
          <div className="dialog-actions">
            <Button
              className="secondary"
              disabled={blocked}
              onClick={() => setRescheduling(false)}
            >
              返回详情
            </Button>
            <Button className="primary" loading={!!busy} type="submit">
              提交改期申请
            </Button>
          </div>
        </form>
      </Modal>
    );
  return (
    <Modal
      title={
        can(user, "bookings.review") && item.status === "待审核"
          ? "审核布展申请"
          : "申请详情"
      }
      description={item.id}
      onClose={() => !blocked && onClose()}
      wide
    >
      {user.role === "enterprise" && (
        <LazyPageBoundary key={item.id}>
          <Suspense fallback={<p>正在读取办理进度与下一步…</p>}>
            <CasePanel
              id={item.id}
              user={user}
              disabled={!!busy}
              onBusyChange={setCaseBusy}
            />
          </Suspense>
        </LazyPageBoundary>
      )}
      <div className="detail-layout">
        <div>
          <Status value={item.status} />
          {item.reschedule_of && (
            <div className="info-box">
              <p>
                这是改期申请，原预约 {item.reschedule_of} 在本次申请批准前保留。
              </p>
            </div>
          )}
          <h3 className="detail-company">{item.company}</h3>
          <dl className="detail-dl">
            {[
              ["联系人", item.contact],
              ["联系电话", item.phone],
              ["申报时间", `${item.start} 至 ${item.end}`],
              ["桁架位置", `${slotName(item.slot)} · ${zoneName(item.slot)}`],
              ["提交时间", formatDate(item.created)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="detail-design">
          <h3>桁架设计图</h3>
          {image ? (
            <>
              <a href={image} target="_blank" rel="noreferrer" title="打开原图">
                <img src={image} alt="企业提交的桁架设计图" />
              </a>
              <a
                className="text-button"
                href={image}
                download={`${item.id}.image`}
              >
                <DownloadSimple size={16} />
                下载原图
              </a>
            </>
          ) : (
            <div className="image-placeholder">
              {imageError || "正在加载设计图…"}
            </div>
          )}
        </div>
      </div>
      <div className="detail-timeline">
        <span>
          <CheckCircle size={18} />
          申请已提交<small>{formatDate(item.created)}</small>
        </span>
        <span>
          {item.status === "待审核" ? (
            <Clock size={18} />
          ) : item.status === "未通过" ? (
            <XCircle size={18} />
          ) : (
            <CheckCircle size={18} />
          )}
          <b>{item.status === "待审核" ? "等待管理员审核" : item.status}</b>
          {item.reviewed && <small>{formatDate(item.reviewed)}</small>}
        </span>
      </div>
      {item.reason && (
        <div className={item.status === "未通过" ? "error-box" : "info-box"}>
          <div>
            <strong>审核意见</strong>
            <p>{item.reason}</p>
          </div>
        </div>
      )}
      {can(user, "bookings.review") && item.status === "待审核" && (
        <label>
          审核意见 <span className="muted">未通过时必填</span>
          <textarea
            rows={3}
            maxLength={500}
            value={reason}
            disabled={blocked}
            onChange={(e) => setReason(e.target.value)}
            placeholder="请说明审核结果或需要企业修改的内容"
          />
        </label>
      )}
      {user.role !== "enterprise" && (
        <details
          className="case-details"
          onToggle={(e) => setCaseOpen(e.currentTarget.open)}
        >
          <summary onClick={(e) => blocked && e.preventDefault()}>
            查看办理时限、电话跟进与费用记录
          </summary>
          {caseOpen && (
            <LazyPageBoundary key={item.id}>
              <Suspense fallback={<p>正在加载办理记录…</p>}>
                <CasePanel
                  id={item.id}
                  user={user}
                  disabled={!!busy}
                  onBusyChange={setCaseBusy}
                />
              </Suspense>
            </LazyPageBoundary>
          )}
        </details>
      )}
      <ErrorBox>{error}</ErrorBox>
      {item.cancel_reason && (
        <div className="info-box">
          <p>取消原因：{item.cancel_reason}</p>
        </div>
      )}
      {cancelling && (
        <div className="cancellation-form">
          <label>
            取消原因
            <textarea
              aria-label="取消预约原因"
              maxLength={500}
              value={cancelReason}
              disabled={blocked}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={2}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={cancelConfirmed}
              disabled={blocked}
              onChange={(e) => setCancelConfirmed(e.target.checked)}
            />
            确认取消并释放位置，待审的改期申请也将撤回。
          </label>
        </div>
      )}
      <div className="dialog-actions">
        {user.role === "enterprise" &&
          item.status === "已通过" &&
          item.start >= dateString() &&
          !cancelling && (
            <Button
              className="secondary"
              disabled={blocked}
              onClick={() => setRescheduling(true)}
            >
              申请改期 / 换位
            </Button>
          )}
        {item.status === "已通过" &&
          item.end >= dateString() &&
          (can(user, "bookings.review") ||
            (user.role === "enterprise" && item.start >= dateString())) &&
          (cancelling ? (
            <>
              <Button
                className="secondary"
                disabled={blocked}
                onClick={() => setCancelling(false)}
              >
                保留预约
              </Button>
              <Button
                className="danger-outline"
                loading={busy === "cancel"}
                disabled={!cancelConfirmed || !cancelReason.trim() || blocked}
                onClick={() => action("cancel")}
              >
                确认取消预约
              </Button>
            </>
          ) : (
            <Button
              className="danger-outline"
              disabled={blocked}
              onClick={() => setCancelling(true)}
            >
              取消已通过预约
            </Button>
          ))}
        {can(user, "bookings.review") && item.status === "待审核" ? (
          <>
            <Button
              className="danger-outline"
              disabled={blocked}
              onClick={() => action("review", "未通过")}
            >
              未通过
            </Button>
            <Button
              className="primary"
              loading={busy === "已通过"}
              disabled={blocked}
              onClick={() => action("review", "已通过")}
            >
              审核通过
              <CheckCircle size={18} />
            </Button>
          </>
        ) : (
          <>
            {user.role === "enterprise" && item.status === "待审核" && (
              <Button
                className="danger-outline"
                loading={!!busy}
                disabled={blocked}
                onClick={() => action("withdraw")}
              >
                撤回申请
              </Button>
            )}
            <Button className="secondary" disabled={blocked} onClick={onClose}>
              关闭
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
