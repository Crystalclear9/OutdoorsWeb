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
        <div className="showcase-roles" role="group" aria-label="切换演示身份">
          {ROLES.map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-pressed={role === key}
              onClick={() => {
                chooseRole(key);
                remount();
              }}
            >
              {label}
            </button>
          ))}
        </div>
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
