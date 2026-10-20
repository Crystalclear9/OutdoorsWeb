import React, { useState } from "react";
import { Plus, Megaphone, ArrowUpRight } from "@phosphor-icons/react";
import { api } from "./api.js";
import { can } from "./permissions.js";
import { Button, ErrorBox, Empty, Modal } from "./components.jsx";
import { formatDate } from "./utils.js";

export default function Notices({ items, user, onSaved, connected }) {
  const [modal, setModal] = useState(null),
    [publishing, setPublishing] = useState(false),
    [publishError, setPublishError] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const open = (m) => {
    setError("");
    setModal(m);
  };
  async function publish(e) {
    e.preventDefault();
    const form = e.currentTarget,
      values = Object.fromEntries(new FormData(form));
    setPublishing(true);
    setPublishError("");
    try {
      await api("/notices", {
        method: "POST",
        body: {
          title: values.title,
          content: values.content,
          pinned: values.pinned === "on",
        },
      });
      form.reset();
      onSaved("公告已发布，所有访客可立即查看");
    } catch (e) {
      setPublishError(e.message);
    } finally {
      setPublishing(false);
    }
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = Object.fromEntries(new FormData(e.currentTarget));
      await api(`/notices${modal.item ? "/" + modal.item.id : ""}`, {
        method: modal.item ? "PATCH" : "POST",
        headers: modal.item ? { "If-Match": `"${modal.item.version}"` } : {},
        body: { ...form, pinned: form.pinned === "on" },
      });
      setModal(null);
      onSaved("公告已保存");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api(`/notices/${modal.item.id}`, {
        method: "DELETE",
        headers: { "If-Match": `"${modal.item.version}"` },
      });
      setModal(null);
      onSaved("公告已删除");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
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
              if (
                (e.ctrlKey || e.metaKey) &&
                e.key === "Enter" &&
                !publishing
              ) {
                e.preventDefault();
                e.currentTarget.requestSubmit();
              }
            }}
          >
            <label>
              公告标题
              <input
                name="title"
                required
                maxLength={80}
                placeholder="例如：本周场地开放安排"
              />
            </label>
            <label>
              公告正文
              <textarea
                name="content"
                required
                maxLength={5000}
                rows={4}
                placeholder="输入要发布的活动安排、场地通知或服务信息…"
              />
            </label>
            <div className="notice-compose-footer">
              <label className="check-label">
                <input type="checkbox" name="pinned" />
                置顶此公告
              </label>
              <span className="muted">发布后立即在公告栏显示</span>
              <Button
                type="submit"
                className="primary"
                loading={publishing}
                disabled={!connected}
              >
                <Plus size={18} />
                发布公告
              </Button>
            </div>
            <ErrorBox>{publishError}</ErrorBox>
          </form>
        </section>
      )}
      <section className="card">
        <div className="card-header">
          <div>
            <h2>
              全部公告 <span className="count-badge">{items.length}</span>
            </h2>
            <p>场地使用说明、活动安排与服务通知。</p>
          </div>
        </div>
        {items.map((n) => (
          <article className="notice-article" key={n.id}>
            <div className="notice-calendar">
              <strong>{n.created.slice(8, 10)}</strong>
              <small>{n.created.slice(0, 7).replace("-", ".")}</small>
            </div>
            <div>
              <button
                className="notice-title"
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
                  onClick={() => open({ type: "edit", item: n })}
                >
                  编辑
                </button>
                <button
                  className="text-button danger-text"
                  onClick={() => open({ type: "delete", item: n })}
                >
                  删除
                </button>
              </div>
            ) : (
              <button
                className="icon-button"
                aria-label={`阅读${n.title}`}
                onClick={() => open({ type: "read", item: n })}
              >
                <ArrowUpRight size={21} />
              </button>
            )}
          </article>
        ))}
        {!items.length && (
          <Empty
            icon={Megaphone}
            title={connected ? "暂无已发布公告" : "公告服务未连接"}
          >
            {connected
              ? "新的通知将在这里发布。"
              : "请连接后端后查看最新公告。"}
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
          onClose={() => setModal(null)}
        >
          {modal.type === "read" ? (
            <div className="notice-full">{modal.item.content}</div>
          ) : modal.type === "delete" ? (
            <>
              <p>确认删除《{modal.item.title}》？</p>
              <ErrorBox>{error}</ErrorBox>
              <div className="dialog-actions">
                <Button className="secondary" onClick={() => setModal(null)}>
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
                  required
                  maxLength={80}
                  defaultValue={modal.item?.title}
                />
              </label>
              <label>
                正文内容
                <textarea
                  name="content"
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
                  defaultChecked={!!modal.item?.pinned}
                />
                置顶显示此公告
              </label>
              <ErrorBox>{error}</ErrorBox>
              <div className="dialog-actions">
                <Button
                  className="secondary"
                  type="button"
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
