import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { Button, ErrorBox, Modal } from "./components.jsx";

export const verificationLabel = (state) =>
  ({
    pending: "待核验",
    verified: "已核验",
    rejected: "核验退回",
    needs_review: "资料变更待复核",
  })[state] || "待核验";
export default function EnterpriseVerification({
  userId,
  manage = false,
  disabled = false,
  application,
}) {
  const [open, setOpen] = useState(!manage),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [state, setState] = useState("pending"),
    [evidence, setEvidence] = useState(""),
    [note, setNote] = useState("");
  const generation = useRef(0),
    mounted = useRef(true),
    dirty = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  async function load(historyPage = 1) {
    if (typeof historyPage !== "number") historyPage = 1;
    const request = ++generation.current;
    setLoading(true);
    setData(null);
    setError("");
    try {
      const latest = await api(
        `/enterprise-verifications/${encodeURIComponent(userId)}?historyPage=${historyPage}`,
      );
      if (!mounted.current || request !== generation.current) return;
      setData(latest);
      if (!dirty.current) {
        setState(latest.state === "needs_review" ? "pending" : latest.state);
        setEvidence(latest.evidence || "");
        setNote(latest.note || "");
      }
    } catch (e) {
      if (mounted.current && request === generation.current)
        setError(e.message);
    } finally {
      if (mounted.current && request === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (open) void load();
  }, [open, userId]);
  async function save(e) {
    e.preventDefault();
    if (busy || loading || !data) return;
    setBusy(true);
    setError("");
    try {
      const latest = await api(
        `/enterprise-verifications/${encodeURIComponent(userId)}`,
        {
          method: "POST",
          body: {
            state,
            evidence,
            note,
            version: data.version,
            profileVersion: data.profileVersion,
          },
        },
      );
      if (mounted.current) {
        dirty.current = false;
        setData(latest);
        setState(latest.state);
      }
    } catch (e) {
      if (mounted.current) {
        setError(e.message);
        if (e.status === 409) setData(null);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const content = (
    <>
      <ErrorBox>{error}</ErrorBox>
      {loading ? (
        <p>正在读取核验记录…</p>
      ) : (
        data && (
          <>
            <p>
              <strong>{verificationLabel(data.state)}</strong>
              {data.reviewed
                ? ` · ${new Date(data.reviewed).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`
                : ""}
            </p>
            <p>
              核验范围：{data.profile.company} · {data.profile.contact} ·{" "}
              {data.profile.phone}
            </p>
            {data.state === "needs_review" && (
              <p className="field-note">
                资料已变化，之前的核验结论不能代替当前资料复核。
              </p>
            )}
            {application &&
              ["company", "contact", "phone"].some(
                (key) => application[key] !== data.profile[key],
              ) && (
                <p className="info-box">
                  本次申报资料与当前核验范围不一致，请单独核实本次企业及联系人授权。
                </p>
              )}
            {manage && data.history?.length > 0 && (
              <details>
                <summary>
                  历史核验记录（第 {data.historyPage} / {data.historyPages} 页）
                </summary>
                {data.history.map((r) => (
                  <article key={r.version}>
                    <strong>
                      版本 {r.version} · {verificationLabel(r.state)}
                    </strong>
                    <p>
                      {r.profile.company} · {r.profile.contact} ·{" "}
                      {r.profile.phone}
                    </p>
                    <p>{r.evidence}</p>
                    <p>{r.note}</p>
                    <small>
                      {r.reviewed} · 经办账号 {r.reviewer}
                    </small>
                  </article>
                ))}
                <Button
                  className="secondary"
                  disabled={busy || loading || data.historyPage <= 1}
                  onClick={() => load(data.historyPage - 1)}
                >
                  上一页核验历史
                </Button>
                <Button
                  className="secondary"
                  disabled={
                    busy || loading || data.historyPage >= data.historyPages
                  }
                  onClick={() => load(data.historyPage + 1)}
                >
                  下一页核验历史
                </Button>
              </details>
            )}
            {manage ? (
              <form
                onSubmit={save}
                onChange={() => {
                  dirty.current = true;
                }}
              >
                <label>
                  核验结论
                  <select
                    aria-label="核验结论"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    disabled={busy}
                  >
                    <option value="pending">待核验</option>
                    <option value="verified">已核验</option>
                    <option value="rejected">核验退回</option>
                  </select>
                </label>
                <label>
                  内部核验依据
                  <textarea
                    aria-label="内部核验依据"
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                    maxLength={2000}
                    required={state !== "pending"}
                    disabled={busy}
                    placeholder="记录核实方式、经办依据和必要编号，请勿录入无关证件信息。"
                  />
                </label>
                <label>
                  企业可见说明
                  <textarea
                    aria-label="企业可见说明"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={500}
                    required={state === "rejected"}
                    disabled={busy}
                  />
                </label>
                <Button className="primary" type="submit" loading={busy}>
                  保存核验记录
                </Button>
              </form>
            ) : (
              <p>
                {data.note ||
                  "企业真实性由活动中心核实；此状态作为审核参考，不自动替代内容审核。"}
              </p>
            )}
          </>
        )
      )}
      {!data && manage && dirty.current && (
        <p>
          尚未保存的核验输入已保留：{evidence} {note}
          。重新读取后请核对企业资料再保存。
        </p>
      )}
      <Button className="secondary" disabled={busy || loading} onClick={load}>
        重新读取核验记录
      </Button>
    </>
  );
  return manage ? (
    <>
      <Button
        className="secondary small"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        企业核验
      </Button>
      {open && (
        <Modal
          title="企业资料核验"
          onClose={() => {
            if (!busy) {
              generation.current++;
              dirty.current = false;
              setOpen(false);
            }
          }}
        >
          {content}
        </Modal>
      )}
    </>
  ) : (
    <section className="card">
      <div className="card-header">
        <h2>企业资料核验</h2>
      </div>
      <div className="verification-content">{content}</div>
    </section>
  );
}
