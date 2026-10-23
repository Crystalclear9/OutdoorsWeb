import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { Button, ErrorBox } from "./components.jsx";
import { dateString, slotName } from "./utils.js";

export default function Onsite({ notify, onChange }) {
  const [date, setDate] = useState(dateString()),
    [data, setData] = useState(null),
    [draft, setDraft] = useState({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [needsRefresh, setNeedsRefresh] = useState(false);
  useEffect(() => {
    let active = true;
    setData(null);
    setDraft({});
    setNeedsRefresh(false);
    api(`/onsite?date=${date}`)
      .then((r) => {
        if (active) {
          setData(r);
          setError("");
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setNeedsRefresh(true);
        }
      });
    return () => {
      active = false;
    };
  }, [date]);
  const row = (slot) => ({
    slot,
    present: false,
    note: "",
    version: 0,
    ...data?.items.find((i) => i.slot === slot),
    ...draft[slot],
  });
  const update = (slot, value) =>
    setDraft((d) => ({ ...d, [slot]: { ...row(slot), ...value } }));
  async function save() {
    if (busy || needsRefresh || !data || date !== dateString()) return;
    setBusy(true);
    setError("");
    let written = false;
    try {
      await api("/onsite", {
        method: "POST",
        body: {
          date,
          items: Object.values(draft).map((i) => ({
            ...i,
            present: !!i.present,
          })),
        },
      });
      written = true;
      setData(await api(`/onsite?date=${date}`));
      setDraft({});
      onChange();
      notify("现场摆放状态已保存");
    } catch (e) {
      if (written) {
        setNeedsRefresh(true);
        setError(
          `现场登记已保存，但重新读取失败：${e.message}。请重新读取后核对，勿重复提交。`,
        );
        onChange();
        return;
      }
      setError(e.message);
      if (e.status === 409) {
        try {
          setData(await api(`/onsite?date=${date}`));
          setDraft({});
        } catch (refreshError) {
          setNeedsRefresh(true);
          setError(
            `${e.message}；重新读取失败：${refreshError.message}。请重新读取后核对。`,
          );
        }
      }
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    if (busy) return;
    setBusy(true);
    try {
      const latest = await api(`/onsite?date=${date}`);
      setData(latest);
      setDraft({});
      setNeedsRefresh(false);
      setError("");
    } catch (e) {
      setNeedsRefresh(true);
      setError(`重新读取失败：${e.message}。已保留输入，请稍后重试。`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card onsite-card">
      <div className="card-header">
        <div>
          <h2>现场摆放登记</h2>
          <p>
            按现场情况登记实际摆放，与审批占位分别统计。仅能修改今天的状态。
          </p>
        </div>
        <label>
          登记日期
          <input
            type="date"
            disabled={busy}
            value={date}
            max={dateString()}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </div>
      <ErrorBox>{error}</ErrorBox>
      {needsRefresh && (
        <div className="info-box">
          <p>
            当前输入暂时保留。重新读取成功后将显示服务器最新记录，并清除本页未保存的更改，请先核对或留存所需内容。
          </p>
          <Button className="secondary" loading={busy} onClick={reload}>
            重新读取并核对现场状态
          </Button>
        </div>
      )}
      {data && (
        <>
          <div className="onsite-summary">
            <strong>
              实际已摆放{" "}
              {
                Array.from({ length: 29 }, (_, i) => row(i + 1)).filter(
                  (i) => i.present,
                ).length
              }{" "}
              / 29
            </strong>
            <span>当日生效预约 {data.approved.length} 个位置</span>
            <Button
              className="secondary"
              disabled={busy || needsRefresh || date !== dateString()}
              onClick={() => {
                const d = {};
                for (const b of data.approved)
                  d[b.slot] = { ...row(b.slot), present: true };
                setDraft((v) => ({ ...v, ...d }));
              }}
            >
              按批准清单填入，再现场核对
            </Button>
          </div>
          <div className="onsite-grid">
            {Array.from({ length: 29 }, (_, i) => {
              const r = row(i + 1),
                booking = data.approved.find((b) => b.slot === r.slot);
              return (
                <div
                  className={`onsite-position ${r.present ? "present" : ""}`}
                  key={r.slot}
                >
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={!!r.present}
                      disabled={busy || needsRefresh || date !== dateString()}
                      onChange={(e) =>
                        update(r.slot, { present: e.target.checked })
                      }
                    />
                    <strong>{slotName(r.slot)}</strong>
                    <span>{r.present ? "已摆放" : "未摆放"}</span>
                  </label>
                  <small>{booking?.company || "当日无批准预约"}</small>
                  <input
                    aria-label={`${r.slot}号现场备注`}
                    placeholder="现场备注（选填）"
                    maxLength={300}
                    disabled={busy || needsRefresh || date !== dateString()}
                    value={r.note}
                    onChange={(e) => update(r.slot, { note: e.target.value })}
                  />
                  {!!r.present && !booking && (
                    <small className="error-text">未匹配批准预约，请核查</small>
                  )}
                </div>
              );
            })}
          </div>
          <div className="dialog-actions">
            <span>更改 {Object.keys(draft).length} 个位置</span>
            <Button
              className="primary"
              loading={busy}
              disabled={
                needsRefresh ||
                !Object.keys(draft).length ||
                date !== dateString()
              }
              onClick={save}
            >
              保存现场登记
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
