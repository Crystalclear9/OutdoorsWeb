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
import { dateString, formatDate } from "./utils.js";
import AllowedArea from "./AllowedArea.jsx";
import { BUILDER_PHONE_PATTERN } from "../shared/booking-contact.js";
import useBeijingDay from "./useBeijingDay.js";
import LazyPageBoundary from "./LazyPageBoundary.jsx";
const CasePanel = lazy(() =>
  import("./Casework.jsx").then((module) => ({ default: module.CasePanel })),
);

export function BookingForm({ user, date, onClose, onSaved }) {
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
              <span>02</span>布展日期与搭建方
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
            <div className="form-columns">
              <label>
                搭建方联系人
                <input
                  name="builder_contact"
                  disabled={busy}
                  required
                  maxLength={30}
                />
              </label>
              <label>
                搭建方联系电话
                <input
                  name="builder_phone"
                  disabled={busy}
                  type="tel"
                  pattern={BUILDER_PHONE_PATTERN}
                  maxLength={25}
                  title="手机号或区号-座机号（可选分机）"
                  required
                />
              </label>
            </div>
            <p className="field-note">
              布展地点统一为大活A座平台，无需申请具体桁架位置。请在下方示意区域内摆放，并保持出入口和通道畅通。
            </p>
            <AllowedArea compact />
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
  const day = useBeijingDay();
  const [checkedDay, setCheckedDay] = useState(() =>
    initial.status === "待审核" && initial.start < day ? "" : day,
  );
  const attemptedDay = useRef(checkedDay);
  const [caseOpen, setCaseOpen] = useState(false);
  const [caseBusy, setCaseBusy] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [item, setItem] = useState(initial);
  const [cancelling, setCancelling] = useState(false),
    [cancelReason, setCancelReason] = useState(""),
    [cancelConfirmed, setCancelConfirmed] = useState(false);
  const imageSource = useRef(null);
  const mounted = useRef(true),
    statusReadRequest = useRef(0),
    statusReadPending = useRef(false);
  const [statusLoading, setStatusLoading] = useState(false),
    [statusReadFailed, setStatusReadFailed] = useState(false),
    [statusReadError, setStatusReadError] = useState(""),
    [statusReadMessage, setStatusReadMessage] = useState("");
  const [image, setImage] = useState(null),
    [imageError, setImageError] = useState(""),
    [imageLoading, setImageLoading] = useState(true),
    [imageReady, setImageReady] = useState(false),
    [imageRevision, setImageRevision] = useState(0),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const blocked = !!busy || caseBusy;
  const writeBlocked =
    blocked || statusLoading || statusReadFailed || checkedDay !== day;
  const rescheduleAllowed =
    item.status === "已通过" && !item.cancelled && item.start >= dateString();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      statusReadRequest.current++;
      statusReadPending.current = false;
    };
  }, []);
  async function readBooking() {
    if (!mounted.current || statusReadPending.current) return;
    attemptedDay.current = day;
    const request = ++statusReadRequest.current;
    statusReadPending.current = true;
    setStatusLoading(true);
    setStatusReadError("");
    setStatusReadMessage("");
    try {
      const result = await api(`/bookings/${item.id}`);
      if (!mounted.current || request !== statusReadRequest.current) return;
      setItem(result.booking);
      setCheckedDay(day);
      setStatusReadFailed(false);
      setStatusReadMessage(
        "最新申请状态已读取，请核对后再操作；原输入已保留。",
      );
    } catch (e) {
      if (!mounted.current || request !== statusReadRequest.current) return;
      setStatusReadFailed(true);
      setStatusReadError(
        `申请状态待核对，重新读取当前状态失败：${e.message}。业务操作已暂停，请重新读取申请状态后核对。`,
      );
    } finally {
      if (mounted.current && request === statusReadRequest.current) {
        statusReadPending.current = false;
        setStatusLoading(false);
      }
    }
  }
  useEffect(() => {
    if (
      checkedDay !== day &&
      attemptedDay.current !== day &&
      !blocked &&
      !statusLoading
    ) {
      void readBooking();
    }
  }, [day, checkedDay, blocked, statusLoading]);
  const statusFeedback = (
    <>
      <ErrorBox>{statusReadError || error}</ErrorBox>
      {statusLoading && (
        <p role="status">正在重新读取申请状态，业务操作已暂停…</p>
      )}
      {statusReadMessage && <p role="status">{statusReadMessage}</p>}
      {(statusLoading || statusReadFailed || statusReadMessage) && (
        <Button
          type="button"
          className="secondary small"
          disabled={blocked || statusLoading}
          onClick={readBooking}
        >
          重新读取申请状态
        </Button>
      )}
    </>
  );
  useEffect(() => {
    let active = true,
      url;
    imageSource.current = null;
    setImage(null);
    setImageError("");
    setImageReady(false);
    setImageLoading(true);
    getDesign(item.id)
      .then((value) => {
        url = value;
        if (active) {
          imageSource.current = value;
          setImage(value);
        } else URL.revokeObjectURL(value);
      })
      .catch((e) => {
        if (active) {
          setImageError(e.message);
          setImageLoading(false);
        }
      });
    return () => {
      active = false;
      if (imageSource.current === url) imageSource.current = null;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.id, imageRevision]);
  function retryDesign() {
    if (blocked || imageLoading) return;
    imageSource.current = null;
    setImage(null);
    setImageReady(false);
    setImageError("");
    setImageLoading(true);
    setImageRevision((value) => value + 1);
  }
  async function action(type, status) {
    if (writeBlocked) return;
    if (
      type === "review" &&
      status === "已通过" &&
      (!imageReady || imageLoading)
    ) {
      setError("请先成功加载并核对桁架设计图后再通过审核");
      return;
    }
    setBusy(status || type);
    setError("");
    setStatusReadMessage("");
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
      if (!mounted.current) return;
      onSaved(
        type === "withdraw"
          ? "申请已撤回"
          : type === "cancel"
            ? "布展申请已取消"
            : `申请${status}`,
      );
    } catch (e) {
      if (!mounted.current) return;
      setError(e.message);
      if (e.status === 409) {
        setBusy("");
        await readBooking();
      }
    } finally {
      if (mounted.current) setBusy("");
    }
  }
  async function reschedule(e) {
    e.preventDefault();
    if (writeBlocked || !rescheduleAllowed) return;
    setBusy("reschedule");
    setError("");
    setStatusReadMessage("");
    try {
      await api(`/bookings/${item.id}/reschedule`, {
        method: "POST",
        headers: { "If-Match": `"${item.version}"` },
        body: Object.fromEntries(new FormData(e.currentTarget)),
      });
      if (mounted.current) onSaved("改期申请已提交，原预约继续保留至改期批准");
    } catch (e) {
      if (!mounted.current) return;
      setError(e.message);
      if (e.status === 409) {
        setBusy("");
        await readBooking();
      }
    } finally {
      if (mounted.current) setBusy("");
    }
  }
  if (rescheduling)
    return (
      <Modal
        title="申请改期"
        description={`原申请：${item.start} 至 ${item.end} · 大活A座平台`}
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
                disabled={writeBlocked}
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
                disabled={writeBlocked}
                required
              />
            </label>
          </div>
          <div className="form-columns">
            <label>
              搭建方联系人
              <input
                name="builder_contact"
                defaultValue={item.builder_contact || ""}
                disabled={writeBlocked}
                required
                maxLength={30}
              />
            </label>
            <label>
              搭建方联系电话
              <input
                name="builder_phone"
                defaultValue={item.builder_phone || ""}
                disabled={writeBlocked}
                type="tel"
                pattern={BUILDER_PHONE_PATTERN}
                maxLength={25}
                title="手机号或区号-座机号（可选分机）"
                required
              />
            </label>
          </div>
          <p className="field-note">
            布展地点：大活A座平台。请核对搭建方信息，改期沿用原桁架设计图。
          </p>
          {statusFeedback}
          {!rescheduleAllowed && !statusReadFailed && !statusLoading && (
            <div className="info-box">
              <p>
                原申请当前状态：{item.status}
                。当前申请无法继续改期，草稿已保留，请返回最新详情核对。
              </p>
            </div>
          )}
          <div className="dialog-actions">
            <Button
              className="secondary"
              disabled={blocked}
              onClick={() => setRescheduling(false)}
            >
              {!rescheduleAllowed && !statusReadFailed && !statusLoading
                ? "返回最新详情"
                : "返回详情"}
            </Button>
            <Button
              className="primary"
              loading={!!busy}
              disabled={writeBlocked || !rescheduleAllowed}
              type="submit"
            >
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
              ["布展地点", "大活A座平台"],
              ["搭建方联系人", item.builder_contact || "历史申请未提供"],
              ["搭建方联系电话", item.builder_phone || "历史申请未提供"],
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
                <img
                  src={image}
                  alt="企业提交的桁架设计图"
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
              <p>{imageError || "正在加载设计图…"}</p>
              {imageError && (
                <Button
                  className="secondary small"
                  disabled={blocked || imageLoading}
                  onClick={retryDesign}
                >
                  重新加载设计图
                </Button>
              )}
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
          ) : ["未通过", "过期未审核"].includes(item.status) ? (
            <XCircle size={18} />
          ) : (
            <CheckCircle size={18} />
          )}
          <b>{item.status === "待审核" ? "等待管理员审核" : item.status}</b>
          {item.reviewed && <small>{formatDate(item.reviewed)}</small>}
        </span>
      </div>
      {item.reason && (
        <div
          className={
            ["未通过", "过期未审核"].includes(item.status)
              ? "error-box"
              : "info-box"
          }
        >
          <div>
            <strong>{item.reviewExpired ? "过期说明" : "审核意见"}</strong>
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
            disabled={writeBlocked}
            onChange={(e) => setReason(e.target.value)}
            placeholder="请说明审核结果或需要企业修改的内容"
          />
        </label>
      )}
      {user.role !== "enterprise" && !item.content_only && (
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
                  disabled={writeBlocked}
                  onBusyChange={setCaseBusy}
                />
              </Suspense>
            </LazyPageBoundary>
          )}
        </details>
      )}
      {statusFeedback}
      {!!reason &&
        !!statusReadMessage &&
        (item.status !== "待审核" || item.reviewExpired) && (
          <div className="info-box">
            <div>
              <strong>保留的审核意见草稿</strong>
              <p>{reason}</p>
            </div>
          </div>
        )}
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
              disabled={writeBlocked}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={2}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={cancelConfirmed}
              disabled={writeBlocked}
              onChange={(e) => setCancelConfirmed(e.target.checked)}
            />
            确认取消本次布展申请，待审的改期申请也将撤回。
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
              disabled={writeBlocked}
              onClick={() => setRescheduling(true)}
            >
              申请改期
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
                disabled={
                  !cancelConfirmed || !cancelReason.trim() || writeBlocked
                }
                onClick={() => action("cancel")}
              >
                确认取消预约
              </Button>
            </>
          ) : (
            <Button
              className="danger-outline"
              disabled={writeBlocked}
              onClick={() => setCancelling(true)}
            >
              取消已通过预约
            </Button>
          ))}
        {can(user, "bookings.review") && item.status === "待审核" ? (
          <>
            <Button
              className="danger-outline"
              disabled={writeBlocked}
              onClick={() => action("review", "未通过")}
            >
              未通过
            </Button>
            <Button
              className="primary"
              loading={busy === "已通过"}
              disabled={writeBlocked || imageLoading || !imageReady}
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
                disabled={writeBlocked}
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
