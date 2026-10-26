import React from "react";

export default function AllowedArea({ compact = false }) {
  return (
    <figure className={`allowed-area ${compact ? "is-compact" : ""}`}>
      <svg
        viewBox="0 0 840 380"
        role="img"
        aria-label="大活A座平台允许摆放区域示意图"
      >
        <rect width="840" height="380" rx="16" fill="#f5f7f8" />
        <rect x="40" y="50" width="235" height="280" rx="8" fill="#dfe5e9" />
        <text x="157" y="175" textAnchor="middle" className="area-building">
          大学生活动中心
        </text>
        <text x="157" y="210" textAnchor="middle" className="area-building">
          A 座
        </text>
        <rect x="275" y="158" width="20" height="64" rx="3" fill="#698294" />
        <path
          d="M310 50H785M310 330H785"
          stroke="#b7c3cb"
          strokeWidth="2"
          strokeDasharray="8 7"
        />
        <rect
          x="330"
          y="95"
          width="430"
          height="190"
          rx="12"
          fill="#e2efe9"
          stroke="#387760"
          strokeWidth="3"
          strokeDasharray="10 6"
        />
        <text x="545" y="158" textAnchor="middle" className="area-title">
          大活A座平台
        </text>
        <text x="545" y="200" textAnchor="middle" className="area-label">
          允许摆放区域
        </text>
        <text x="545" y="239" textAnchor="middle" className="area-note">
          按审核通过的内容与现场要求搭建
        </text>
        <text x="545" y="34" textAnchor="middle" className="area-note">
          通行区域 · 保持畅通
        </text>
        <text x="545" y="362" textAnchor="middle" className="area-note">
          通行区域 · 保持畅通
        </text>
      </svg>
      <figcaption>
        区域示意，不按实际比例绘制；具体边界以现场标识和管理人员指引为准。请勿占用出入口及消防通道。
      </figcaption>
    </figure>
  );
}
