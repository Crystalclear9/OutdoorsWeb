import React, { useEffect, useState } from "react";
import { api, apiUrl } from "./api.js";
import { Button, ErrorBox, Pagination } from "./components.jsx";
export default function Archives() {
  const [data, setData] = useState(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api(`/archives?page=${page}`)
      .then((d) => {
        if (active) {
          if (page > d.pages) {
            setPage(d.pages);
            return;
          }
          setData(d);
          setError("");
        }
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [page, refresh]);
  const ready = !loading && !error && data?.page === page;
  return (
    <section className="card archives-card">
      <div className="card-header">
        <div>
          <h2>历史审计归档</h2>
          <p>
            超过保留期的日志按批次完整归档，下载时验证
            SHA-256。历史设计图仍可在原申请中查看。
          </p>
        </div>
        <Button
          className="secondary small"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          刷新归档
        </Button>
      </div>
      <ErrorBox>{error}</ErrorBox>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>归档时间</th>
              <th>历史截止时间</th>
              <th>日志数量</th>
              <th>文件</th>
            </tr>
          </thead>
          <tbody>
            {ready &&
              data.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    {new Date(r.created).toLocaleString("zh-CN", {
                      timeZone: "Asia/Shanghai",
                    })}
                  </td>
                  <td>{r.cutoff.slice(0, 10)}</td>
                  <td>{r.records}</td>
                  <td>
                    <a href={apiUrl(`/archives/${r.id}`)} download>
                      下载 JSONL · {(r.bytes / 1024).toFixed(1)} KB
                    </a>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {loading && <p className="field-note">正在读取历史审计归档…</p>}
        {ready && !data.items.length && (
          <p className="empty-state">尚无历史审计归档</p>
        )}
      </div>
      {ready && <Pagination {...data} onPage={setPage} />}
    </section>
  );
}
