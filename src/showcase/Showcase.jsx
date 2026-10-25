// TEMPORARY_PAGES_SHOWCASE — deletion checklist: docs/temporary-showcase.md.
import React, { useEffect, useRef, useState } from "react";
import { ROLES, getRole, chooseRole, resetShowcase } from "./runtime.js";
import "./showcase.css";

export default function Showcase({ App }) {
  const [revision, setRevision] = useState(0),
    banner = useRef(null),
    shell = useRef(null);
  const role = getRole();
  const remount = () => setRevision((value) => value + 1);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [revision]);
  useEffect(() => {
    const size = () =>
      shell.current?.style.setProperty(
        "--showcase-height",
        `${banner.current?.offsetHeight || 0}px`,
      );
    const observer = new ResizeObserver(size);
    observer.observe(banner.current);
    size();
    window.addEventListener("showcase-role-changed", remount);
    return () => {
      observer.disconnect();
      window.removeEventListener("showcase-role-changed", remount);
    };
  }, []);
  return (
    <div className="showcase-shell" ref={shell}>
      <aside className="showcase-banner" ref={banner} aria-label="临时成果演示">
        <div className="showcase-copy">
          <strong>
            阶段成果演示 <span>临时</span>
          </strong>
          <p>
            虚构数据，仅保存在当前标签页；请勿输入真实资料或付款。后续移除此入口。
          </p>
        </div>
        <label className="showcase-role">
          查看身份
          <select
            aria-label="切换演示身份"
            value={role}
            onChange={(event) => {
              chooseRole(event.target.value);
              remount();
            }}
          >
            {ROLES.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button secondary small"
          onClick={() => {
            resetShowcase();
            remount();
          }}
        >
          重置演示
        </button>
      </aside>
      <App
        key={revision}
        initialPage={ROLES.find(([key]) => key === role)?.[2] || "overview"}
      />
    </div>
  );
}
