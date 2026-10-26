import React, { useEffect, useState, useRef } from "react";
import { api } from "./api.js";
import { can } from "./permissions.js";
import { Button, Empty, ErrorBox, Pagination } from "./components.jsx";
import { bookingNextStep } from "./booking-next-step.js";
import { dateString } from "./utils.js";
const formatDate = (value) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));

const feeLabels = {
  due: "待缴费",
  submitted: "流水待核对",
  paid: "已核实收款",
  waived: "免缴",
  void: "已作废",
  reconcile: "取消后待核款",
  refunded: "已登记全额退款",
};
const contactLabels = {
  pending: "尚未登记结果电话",
  unreachable: "电话未接通，需继续跟进",
  reached: "已登记电话告知",
};

export function CasePanel({
  id,
  user,
  notify = () => {},
  disabled = false,
  onBusyChange,
}) {
  const [record, setItem] = useState(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [readError, setReadError] = useState(false),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0);
  const paymentInput = useRef(null);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  const item = record?.id === id ? record : null;
  const reviewer = can(user, "bookings.review"),
    finance = can(user, "payments.manage"),
    owner = user.role === "enterprise";
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api(`/casework/${id}`)
      .then((r) => {
        if (active) {
          setItem(r.item);
          setReadError(false);
        }
      })
      .catch((e) => {
        if (active) {
          setReadError(true);
          setError(
            `无法读取最新办理记录：${e.message} 已保留当前输入，请重新读取后再提交。`,
          );
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id, version]);
  async function act(kind, data) {
    if (disabled || busy || loading || readError || !item) return;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    try {
      const v =
        kind === "contact" ? item.contactResult.version : item.fee?.version;
      await api(`/casework/${id}/${kind}`, {
        method: "POST",
        headers: v ? { "If-Match": `"${v}"` } : {},
        body: data,
      });
      notify("办理记录已保存");
      setVersion((v) => v + 1);
    } catch (e) {
      setError(`${e.message}。请刷新办理记录后核对，勿重复确认收款。`);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  function issue(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    if (data.action !== "waive" && !/^\d{1,7}(\.\d{1,2})?$/.test(data.amount))
      return setError("金额须为人民币数字，最多两位小数");
    act("fee", { ...data, amountFen: Math.round(Number(data.amount) * 100) });
  }
  const nextStep = item ? bookingNextStep(item, dateString()) : null;
  const ContactContainer = owner ? "details" : "div";
  const FeeContainer = owner ? "details" : "div";
  const fee = item?.fee,
    active = item?.status === "已通过" && !item?.cancelled;
  return (
    <section className="card case-panel" aria-label="办理与缴费记录">
      <div className="card-header">
        <div>
          <h2>{owner ? "申请办理" : "办理与缴费记录"}</h2>
          <p>
            {item
              ? `${item.company} · ${item.location || "大活A座平台"} · ${item.status}${item.cancelled ? "（已取消）" : ""}`
              : "正在读取办理记录…"}
          </p>
        </div>
        <Button
          className="secondary small"
          disabled={disabled || busy || loading}
          onClick={() => setVersion((v) => v + 1)}
        >
          刷新办理记录
        </Button>
      </div>
      <ErrorBox>{error}</ErrorBox>
      {owner && (
        <section
          className="case-next-step"
          aria-label="当前办理与下一步"
          aria-live="polite"
        >
          <div>
            <strong>
              {loading
                ? "正在核对办理进度…"
                : readError || !item
                  ? "办理进度暂不可用"
                  : nextStep.title}
            </strong>
            <p>
              {loading
                ? "正在读取最新审核和费用记录。"
                : readError || !item
                  ? "点击刷新办理记录，重新加载进度。"
                  : nextStep.detail}
            </p>
            {!loading && !readError && item && (
              <>
                <p className="case-booking-facts">
                  {item.start} 至 {item.end} · {item.location || "大活A座平台"}
                </p>
                {active && fee?.state === "due" && (
                  <div className="case-next-action">
                    <strong>应缴 ¥{(fee.amount_fen / 100).toFixed(2)}</strong>
                    <Button
                      className="primary"
                      disabled={disabled || busy}
                      onClick={() => {
                        const records =
                          paymentInput.current?.closest("details");
                        if (records) records.open = true;
                        paymentInput.current?.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        });
                        paymentInput.current?.focus({ preventScroll: true });
                      }}
                    >
                      填写付款流水
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}
      {item && (
        <fieldset
          disabled={disabled || busy || loading || readError}
          style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
        >
          <ContactContainer
            className={
              owner
                ? "case-contact-record"
                : `info-box ${item.overdue ? "case-overdue" : ""}`
            }
          >
            {owner && (
              <summary>
                电话跟进 · {contactLabels[item.contactResult.state]}
              </summary>
            )}
            <div>
              <strong>
                {item.overdue ? "已超过反馈时限" : "反馈时限"}：
                {formatDate(item.due)}
              </strong>
              <p>
                {contactLabels[item.contactResult.state]}
                {item.contactResult.reached_at
                  ? ` · ${formatDate(item.contactResult.reached_at)}`
                  : ""}
              </p>
              <p>反馈时限按下一个工作日计算，以学校工作日历为准。</p>
            </div>
          </ContactContainer>
          {reviewer && (
            <div className="case-contact">
              <p>
                联系电话：<a href={`tel:${item.phone}`}>{item.phone}</a> ·
                已登记 {item.contactResult.attempts} 次
              </p>
              {item.contactResult.note && (
                <p>最近联系说明：{item.contactResult.note}</p>
              )}
              {!item.cancelled &&
                ["已通过", "未通过"].includes(item.status) &&
                item.contactResult.state !== "reached" && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      act(
                        "contact",
                        Object.fromEntries(new FormData(e.currentTarget)),
                      );
                    }}
                  >
                    <label>
                      结果电话状态
                      <select name="state">
                        <option value="unreachable">未接通，继续跟进</option>
                        <option value="reached">已接通并告知审核结果</option>
                      </select>
                    </label>
                    <label>
                      联系核对说明
                      <textarea
                        name="note"
                        required
                        maxLength={500}
                        rows={2}
                        placeholder="记录实际通话结果，不以自动电话受理代替接通"
                      />
                    </label>
                    <Button loading={busy} className="primary" type="submit">
                      保存电话跟进
                    </Button>
                  </form>
                )}
              {!item.cancelled &&
                ["已通过", "未通过"].includes(item.status) &&
                item.contactResult.state === "reached" && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      act("contact", {
                        action: "reopen",
                        note: new FormData(e.currentTarget).get("note"),
                      });
                    }}
                  >
                    <label>
                      重新跟进原因
                      <textarea
                        name="note"
                        required
                        maxLength={500}
                        rows={2}
                        placeholder="说明原登记需要纠正的原因；保存后将恢复电话跟进待办"
                      />
                    </label>
                    <Button loading={busy} className="secondary" type="submit">
                      纠正登记并重新跟进
                    </Button>
                  </form>
                )}
              {item.status === "待审核" && (
                <p className="field-note">
                  请先在企业申报审核中完成审批，再登记结果告知。
                </p>
              )}
            </div>
          )}
          {(owner || finance) && (
            <FeeContainer
              className="case-fee"
              key={`${id}-${fee?.state || "none"}`}
              open={owner ? active && fee?.state === "due" : undefined}
            >
              {owner ? (
                <summary>
                  费用记录 · {fee ? feeLabels[fee.state] : "待财务安排"}
                </summary>
              ) : (
                <h3>线下费用办理</h3>
              )}
              {!owner && (
                <p className="field-note">
                  按收费依据发单，并核对实际到账和退款记录。
                </p>
              )}
              {fee ? (
                <>
                  <div className="case-fee-facts">
                    <strong>{feeLabels[fee.state]}</strong>
                    <strong>
                      人民币 {(fee.amount_fen / 100).toFixed(2)} 元
                    </strong>
                  </div>
                  {fee.instructions && (
                    <p className="case-preserve">
                      收款说明：{fee.instructions}
                    </p>
                  )}
                  {fee.reference && (
                    <p className="case-preserve">
                      企业付款流水：{fee.reference}
                    </p>
                  )}
                  <p className="case-preserve">办理说明：{fee.note}</p>
                  {item.cancelled && (
                    <div className="error-box">
                      预约已取消，请停止付款。原款项由财务核对并办理退款。
                    </div>
                  )}
                  {owner && active && fee.state === "due" && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        act("fee", {
                          action: "submit",
                          reference: new FormData(e.currentTarget).get(
                            "reference",
                          ),
                        });
                      }}
                    >
                      <label>
                        线下付款时间及流水号
                        <input
                          ref={paymentInput}
                          name="reference"
                          maxLength={200}
                          required
                          placeholder="填写实际付款时间、交易流水号，等待财务核对"
                        />
                      </label>
                      <Button className="primary" loading={busy} type="submit">
                        提交付款流水
                      </Button>
                    </form>
                  )}
                  {finance && item.cancelled && fee.state === "void" && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        act("fee", {
                          action: "late_confirm",
                          ...Object.fromEntries(new FormData(e.currentTarget)),
                        });
                      }}
                    >
                      <p>
                        作废不代表银行未到账。核实取消后到账后，登记收款，再办理线下全额退款。
                      </p>
                      <label>
                        取消后到账流水
                        <input name="reference" required maxLength={200} />
                      </label>
                      <label>
                        迟到到账核对依据
                        <textarea
                          name="note"
                          required
                          maxLength={500}
                          rows={2}
                        />
                      </label>
                      <label className="check-label">
                        <input type="checkbox" required />
                        我已核对单位账户实际到账记录
                      </label>
                      <Button loading={busy} className="primary" type="submit">
                        登记取消后到账
                      </Button>
                    </form>
                  )}
                  {finance &&
                    ["due", "submitted", "reconcile", "paid"].includes(
                      fee.state,
                    ) && (
                      <form
                        key={fee.version}
                        onSubmit={(e) => {
                          e.preventDefault();
                          act(
                            "fee",
                            Object.fromEntries(new FormData(e.currentTarget)),
                          );
                        }}
                      >
                        <label>
                          费用核对操作
                          <select name="action">
                            {((active &&
                              ["due", "submitted"].includes(fee.state)) ||
                              fee.state === "reconcile") && (
                              <option value="confirm">
                                核实单位账户实际到账，确认收款
                              </option>
                            )}
                            {active && fee.state === "submitted" && (
                              <option value="return">
                                流水未核实，退回企业补充
                              </option>
                            )}
                            {["due", "submitted", "reconcile"].includes(
                              fee.state,
                            ) && (
                              <option value="void">
                                核实未收款，作废费用单
                              </option>
                            )}
                            {fee.state === "paid" && (
                              <option value="refund">
                                核实已线下全额退回，登记退款
                              </option>
                            )}
                          </select>
                        </label>
                        <label>
                          财务核对依据
                          <textarea
                            name="note"
                            required
                            maxLength={500}
                            rows={2}
                            placeholder="填写银行核对/退款流水或作废原因，不能仅凭企业声明确认到账"
                          />
                        </label>
                        <label className="check-label">
                          <input type="checkbox" required />
                          我已核对实际资金记录，确认保存此操作
                        </label>
                        <Button
                          loading={busy}
                          className="primary"
                          type="submit"
                        >
                          保存费用核对
                        </Button>
                      </form>
                    )}
                </>
              ) : (
                <p>财务确认费用安排后，金额和收款说明将显示在这里。</p>
              )}
              {finance && active && (!fee || fee.state === "void") && (
                <form onSubmit={issue} key={fee?.version || 0}>
                  <label>
                    费用安排
                    <select name="action">
                      <option value="issue">通知线下缴费</option>
                      <option value="waive">免缴</option>
                    </select>
                  </label>
                  <label>
                    应缴金额（元）
                    <input
                      name="amount"
                      inputMode="decimal"
                      placeholder="按已批准的收费标准填写，免缴可留空"
                    />
                  </label>
                  <label>
                    收款单位与办理说明
                    <textarea
                      name="instructions"
                      maxLength={1500}
                      rows={3}
                      placeholder="填写正式收款单位、办理地点/渠道及缴费要求，勿填个人收款信息"
                    />
                  </label>
                  <label>
                    收费依据或免缴说明
                    <textarea name="note" required maxLength={500} rows={2} />
                  </label>
                  <Button loading={busy} className="primary" type="submit">
                    发送费用办理通知
                  </Button>
                </form>
              )}
            </FeeContainer>
          )}
        </fieldset>
      )}
    </section>
  );
}

function Calendar({ notify }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reading, setReading] = useState(true),
    [readError, setReadError] = useState(false);
  async function load(clearError = true) {
    setReading(true);
    try {
      const r = await api("/casework/calendar");
      setData(r);
      setReadError(false);
      if (clearError) setError("");
      return { ok: true };
    } catch (e) {
      setReadError(true);
      setError(
        `无法读取最新工作日历：${e.message} 已保留输入，请重新读取后再保存。`,
      );
      return { ok: false, error: e.message };
    } finally {
      setReading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function save(e) {
    e.preventDefault();
    if (busy || reading || readError || !data) return;
    setBusy(true);
    setError("");
    const f = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api(`/casework/calendar/${f.date}`, {
        method: "PUT",
        headers: { "If-Match": `"${data.version}"` },
        body: {
          working: f.working === "default" ? null : f.working === "true",
        },
      });
      const refreshed = await load(false);
      if (refreshed.ok) setError("");
      else
        setError(
          `日历调整已保存，但重新读取失败：${refreshed.error}。请重新读取后核对，勿重复提交。`,
        );
      notify("工作日历已更新，办理时限将重新计算");
    } catch (e) {
      const refreshed = await load(false);
      setError(
        refreshed.ok
          ? `${e.message}。已读取最新日历，请核对日期与安排后重新提交。`
          : `${e.message}；重新读取失败：${refreshed.error}。已保留输入，请重新读取后再提交。`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="card case-calendar">
      <summary>维护工作日历（超级管理员）</summary>
      <p>
        默认周一至周五。请按本单位实际安排录入法定节假日、调休和校内停办日；系统不自动推测节假日。变更会重新计算尚未完成的反馈时限。
      </p>
      <ErrorBox>{error}</ErrorBox>
      <Button
        className="secondary small"
        disabled={busy || reading}
        onClick={() => load()}
      >
        重新读取工作日历
      </Button>
      {data && (
        <>
          <form onSubmit={save}>
            <div className="form-columns">
              <label>
                调整日期
                <input
                  name="date"
                  type="date"
                  required
                  disabled={busy || reading || readError}
                />
              </label>
              <label>
                当日安排
                <select name="working" disabled={busy || reading || readError}>
                  <option value="false">休息日</option>
                  <option value="true">工作日</option>
                  <option value="default">恢复默认</option>
                </select>
              </label>
            </div>
            <Button
              className="secondary"
              loading={busy}
              disabled={reading || readError}
              type="submit"
            >
              保存日历调整
            </Button>
          </form>
          <ul>
            {data.items.map((r) => (
              <li key={r.date}>
                {r.date} · {r.working ? "工作日" : "休息日"}
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}

export default function Casework({ user, notify, initialId = "" }) {
  const [data, setData] = useState({ items: [], pages: 1, total: 0 }),
    [page, setPage] = useState(1),
    [scope, setScope] = useState("open"),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState(null),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0),
    [loading, setLoading] = useState(true),
    [caseBusy, setCaseBusy] = useState(false);
  const appliedTarget = useRef("");
  useEffect(() => {
    // An external target can arrive while a record is saving. Apply it after
    // settlement, once, rather than unmounting the pending form or replaying it
    // every time the busy state changes.
    if (caseBusy || initialId === appliedTarget.current) return;
    appliedTarget.current = initialId;
    if (!initialId) return;
    setPage(1);
    setScope("all");
    setQuery(initialId);
    setSelected(initialId);
  }, [initialId, caseBusy]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const t = setTimeout(
      () =>
        api(
          `/casework?scope=${scope}&q=${encodeURIComponent(query)}&page=${page}`,
        )
          .then((r) => {
            if (active) {
              if (page > r.pages) {
                setPage(r.pages);
                return;
              }
              setData(r);
              setError("");
            }
          })
          .catch((e) => active && setError(e.message))
          .finally(() => active && setLoading(false)),
      150,
    );
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [scope, query, page, version]);
  const refresh = (message) => {
    notify(message);
    setVersion((v) => v + 1);
  };
  return (
    <>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>通知与缴费办理</h2>
            <p>
              按提交时间处理。超期表示尚未登记结果电话告知，费用状态独立核对。
            </p>
          </div>
          <Button
            className="secondary"
            disabled={caseBusy}
            onClick={() => setVersion((v) => v + 1)}
          >
            刷新办理队列
          </Button>
        </div>
        <div className="form-columns">
          <label>
            办理范围
            <select
              value={scope}
              disabled={caseBusy}
              onChange={(e) => {
                setScope(e.target.value);
                setPage(1);
              }}
            >
              <option value="open">待跟进事项</option>
              <option value="all">全部办理记录</option>
            </select>
          </label>
          <label>
            搜索办理记录
            <input
              value={query}
              disabled={caseBusy}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="企业名称或申请编号"
            />
          </label>
        </div>
        <ErrorBox>{error}</ErrorBox>
        {loading ? (
          <p>正在读取办理队列…</p>
        ) : data.items.length ? (
          <div className="case-list">
            {data.items.map((r) => (
              <button
                type="button"
                key={r.id}
                className={`case-row ${selected === r.id ? "selected" : ""}`}
                disabled={caseBusy}
                onClick={() => setSelected(r.id)}
              >
                <span>
                  <strong>{r.company}</strong>
                  <small>
                    {r.id} · {r.location || "大活A座平台"} · {r.status}
                    {r.cancelled ? "（已取消）" : ""}
                  </small>
                </span>
                <span>
                  {r.overdue ? (
                    <b className="error-text">超过反馈时限</b>
                  ) : (
                    <span>{contactLabels[r.contactResult.state]}</span>
                  )}
                  <small>反馈时限 {formatDate(r.due)}</small>
                  <small>
                    {r.fee
                      ? feeLabels[r.fee.state]
                      : r.fee === undefined
                        ? "费用由财务核对"
                        : "尚无费用通知"}
                  </small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <Empty title="暂无符合条件的办理事项" />
        )}
        <fieldset
          disabled={caseBusy}
          style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
        >
          <Pagination
            page={page}
            pages={data.pages}
            total={data.total}
            onPage={(next) => !caseBusy && setPage(next)}
          />
        </fieldset>
      </section>
      {selected && (
        <CasePanel
          key={selected}
          id={selected}
          user={user}
          notify={refresh}
          onBusyChange={setCaseBusy}
        />
      )}
      {user.isSuperAdmin && <Calendar notify={refresh} />}
    </>
  );
}
