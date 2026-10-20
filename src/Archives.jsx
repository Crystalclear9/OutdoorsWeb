import React, { useEffect, useState } from "react";
import { api, apiUrl } from "./api.js";
import { ErrorBox, Pagination } from "./components.jsx";
export default function Archives() {
  const [data, setData] = useState(null),
    [page, setPage] = useState(1),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api(`/archives?page=${page}`)
      .then((d) => {
        if (active) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [page]);
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
            {data?.items.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.created).toLocaleString("zh-CN")}</td>
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
        {data && !data.items.length && (
          <p className="empty-state">尚无历史审计归档</p>
        )}
      </div>
      {data && <Pagination {...data} onPage={setPage} />}
    </section>
  );
}
