import React, { useEffect, useRef, useState } from "react";
import { Plus, Megaphone, ArrowUpRight } from "@phosphor-icons/react";
import { api } from "./api.js";
import { can } from "./permissions.js";
import { Button, ErrorBox, Empty, Modal } from "./components.jsx";
import { dateString, formatDate } from "./utils.js";

export default function Notices({
  items,
  user,
  onSaved,
  readError,
  onBusyChange,
}) {
  const [modal, setModal] = useState(null),
    [publishing, setPublishing] = useState(false),
    [publishError, setPublishError] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false),
    createIntent = useRef(null),
    mounted = useRef(true),
    busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  const writing = publishing || busy;
  useEffect(() => {
    mounted.current = true;
    const prevent = (event) => {
      if (!pending.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => {
      mounted.current = false;
      pending.current = false;
      window.removeEventListener("beforeunload", prevent);
      busyCallback.current?.(false);
    };
  }, []);
  function beginWrite(quick = false) {
    if (pending.current) return false;
    pending.current = true;
    busyCallback.current?.(true);
    if (quick) setPublishing(true);
    else setBusy(true);
    return true;
  }
  function endWrite() {
    pending.current = false;
    if (!mounted.current) return;
    setPublishing(false);
    setBusy(false);
    busyCallback.current?.(false);
  }
  const open = (m) => {
    if (pending.current) return;
    setError("");
    setModal(m);
  };
  function createHeaders(body) {
    const fingerprint = JSON.stringify({
      actor: user?.id,
      title: body.title,
      content: body.content,
      pinned: !!body.pinned,
    });
    if (createIntent.current?.fingerprint !== fingerprint)
      createIntent.current = { fingerprint, key: crypto.randomUUID() };
    return { "Idempotency-Key": createIntent.current.key };
  }
  async function publish(e) {
    e.preventDefault();
    if (pending.current) return;
    const form = e.currentTarget,
      values = Object.fromEntries(new FormData(form));
    if (!beginWrite(true)) return;
    setPublishError("");
    try {
      const body = {
        title: values.title,
        content: values.content,
        pinned: values.pinned === "on",
      };
      await api("/notices", {
        method: "POST",
        headers: createHeaders(body),
        body,
      });
      if (mounted.current) {
        createIntent.current = null;
        form.reset();
        onSaved("公告已发布，所有访客可立即查看");
      }
    } catch (e) {
      if (mounted.current) setPublishError(e.message);
    } finally {
      endWrite();
    }
  }
  async function save(e) {
    e.preventDefault();
    if (pending.current) return;
    const form = Object.fromEntries(new FormData(e.currentTarget));
    if (!beginWrite()) return;
    setError("");
    try {
      const body = { ...form, pinned: form.pinned === "on" };
      await api(`/notices${modal.item ? "/" + modal.item.id : ""}`, {
        method: modal.item ? "PATCH" : "POST",
        headers: modal.item
          ? { "If-Match": `"${modal.item.version}"` }
          : createHeaders(body),
        body,
      });
      if (mounted.current) {
        if (!modal.item) createIntent.current = null;
        setModal(null);
        onSaved("公告已保存");
      }
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      endWrite();
    }
  }
  async function remove() {
    if (!beginWrite()) return;
    try {
      await api(`/notices/${modal.item.id}`, {
        method: "DELETE",
        headers: { "If-Match": `"${modal.item.version}"` },
      });
      if (mounted.current) {
        setModal(null);
        onSaved("公告已删除");
      }
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      endWrite();
    }
  }
  return (
    <>
      {can(user, "notices.manage") && (
        <section className="card notice-composer">
          <div className="card-header">
            <div>
              <h2>快捷发布公告</h2>
              <p>填写标题与正文，直接投递到公告栏，所有访客可见。</p>
            </div>
            <Megaphone size={25} />
          </div>
          <form
            aria-label="快捷公告投递"
            onSubmit={publish}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !writing) {
                e.preventDefault();
                e.currentTarget.requestSubmit();
              }
            }}
          >
            <label>
              公告标题
              <input
                name="title"
                disabled={writing}
                required
                maxLength={80}
                placeholder="例如：本周桁架内容申报说明"
              />
            </label>
            <label>
              公告正文
              <textarea
                name="content"
                disabled={writing}
                required
                maxLength={5000}
                rows={4}
                placeholder="输入要发布的活动安排、场地通知或服务信息…"
              />
            </label>
            <div className="notice-compose-footer">
              <label className="check-label">
                <input type="checkbox" name="pinned" disabled={writing} />
                置顶此公告
              </label>
              <span className="muted">发布后立即在公告栏显示</span>
              <Button
                type="submit"
                className="primary"
                loading={publishing}
                disabled={busy}
              >
                <Plus size={18} />
                发布公告
              </Button>
            </div>
            <ErrorBox>{publishError}</ErrorBox>
          </form>
        </section>
      )}
      <section className="card notice-list">
        <div className="card-header">
          <div>
            <h2>
              全部公告 <span className="count-badge">{items.length}</span>
            </h2>
            <p>场地使用说明、活动安排与服务通知。</p>
          </div>
        </div>
        <ErrorBox>{readError}</ErrorBox>
        {items.map((n) => (
          <article className="notice-article service-notice" key={n.id}>
            <time className="notice-published" dateTime={n.created}>
              {dateString(new Date(n.created))}
            </time>
            <div>
              <button
                className="notice-title"
                disabled={writing}
                onClick={() => open({ type: "read", item: n })}
              >
                <h3>
                  {!!n.pinned && <span className="pin-tag">置顶</span>}
                  {n.title}
                </h3>
              </button>
              <p>
                {n.content.slice(0, 120)}
                {n.content.length > 120 ? "…" : ""}
              </p>
              <small>大学生活动中心 · {formatDate(n.updated)}</small>
            </div>
            {can(user, "notices.manage") ? (
              <div className="row-actions">
                <button
                  className="text-button"
                  disabled={writing}
                  onClick={() => open({ type: "edit", item: n })}
                >
                  编辑
                </button>
                <button
                  className="text-button danger-text"
                  disabled={writing}
                  onClick={() => open({ type: "delete", item: n })}
                >
                  删除
                </button>
              </div>
            ) : (
              <button
                className="icon-button"
                disabled={writing}
                aria-label={`阅读${n.title}`}
                onClick={() => open({ type: "read", item: n })}
              >
                <ArrowUpRight size={21} />
              </button>
            )}
          </article>
        ))}
        {!items.length && !readError && (
          <Empty icon={Megaphone} title="暂无已发布公告">
            新的通知将在这里发布。
          </Empty>
        )}
      </section>
      {modal && (
        <Modal
          title={
            modal.type === "edit"
              ? modal.item
                ? "编辑公告"
                : "发布公告"
              : modal.type === "delete"
                ? "删除公告"
                : modal.item.title
          }
          description={
            modal.type === "read"
              ? `大学生活动中心 · ${formatDate(modal.item.created)}`
              : undefined
          }
          onClose={() => !busy && setModal(null)}
        >
          {modal.type === "read" ? (
            <div className="notice-full">{modal.item.content}</div>
          ) : modal.type === "delete" ? (
            <>
              <p>确认删除《{modal.item.title}》？</p>
              <ErrorBox>{error}</ErrorBox>
              <div className="dialog-actions">
                <Button
                  className="secondary"
                  disabled={busy}
                  onClick={() => setModal(null)}
                >
                  取消
                </Button>
                <Button
                  className="danger-outline"
                  loading={busy}
                  onClick={remove}
                >
                  删除公告
                </Button>
              </div>
            </>
          ) : (
            <form onSubmit={save}>
              <label>
                公告标题
                <input
                  name="title"
                  disabled={busy}
                  required
                  maxLength={80}
                  defaultValue={modal.item?.title}
                />
              </label>
              <label>
                正文内容
                <textarea
                  name="content"
                  disabled={busy}
                  rows={8}
                  required
                  maxLength={5000}
                  defaultValue={modal.item?.content}
                />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  name="pinned"
                  disabled={busy}
                  defaultChecked={!!modal.item?.pinned}
                />
                置顶显示此公告
              </label>
              <ErrorBox>{error}</ErrorBox>
              <div className="dialog-actions">
                <Button
                  className="secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => setModal(null)}
                >
                  取消
                </Button>
                <Button className="primary" loading={busy}>
                  保存公告
                </Button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
