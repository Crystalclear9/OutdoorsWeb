import React from "react";
import { Buildings } from "@phosphor-icons/react";
import { slotName } from "./utils.js";

export default function VenueMap({
  occupied,
  closed = [],
  selected,
  onSelect,
  zone,
  connected = true,
}) {
  const positions = Array.from({ length: 29 }, (_, i) => {
    let x,
      y,
      r = 0;
    if (i < 9) {
      if (i < 4) {
        x = 160 + i * 46;
        y = 162;
      } else if (i < 7) {
        x = 356;
        y = 183 + (i - 4) * 40;
        r = 90;
      } else {
        x = 159 + (i - 7) * 48;
        y = 332;
      }
    } else if (i < 19) {
      const j = i - 9;
      if (j < 5) {
        x = 409 + j * 41;
        y = 298 + j * 13;
        r = 18;
      } else {
        x = 401 + (j - 5) * 14;
        y = 403 + (j - 5) * 35;
        r = 68;
      }
    } else {
      const j = i - 19;
      if (j < 5) {
        x = 650;
        y = 349 + j * 39;
        r = 90;
      } else {
        x = 401 + (j - 5) * 44;
        y = 609;
      }
    }
    return { x, y, r, n: i + 1 };
  });
  return (
    <svg
      viewBox="0 0 820 690"
      className="venue-svg"
      role="img"
      aria-label="户外广场29个桁架位置示意图"
    >
      <defs>
        <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".7" fill="#d8e1e9" />
        </pattern>
        <pattern
          id="grass"
          width="12"
          height="12"
          patternUnits="userSpaceOnUse"
        >
          <path d="M2 6h2m3 3h2" stroke="#c2d9ca" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="820" height="690" fill="#f7f9fb" />
      <rect width="820" height="690" fill="url(#grid)" />
      <path d="M105 114H322V290H105Z" fill="#e0eee3" stroke="#ccdfd1" />
      <path d="M105 114H322V290H105Z" fill="url(#grass)" />
      <text x="212" y="231" textAnchor="middle" className="map-label">
        中心绿地
      </text>
      <path
        d="M458 114h123v86c0 186-104 359-311 359H107V433h130c131 0 221-104 221-233Z"
        fill="#e8edf1"
        stroke="#d8e0e6"
        strokeWidth="2"
      />
      <path
        d="M482 200c0 190-116 306-253 306"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeDasharray="7 8"
      />
      <path d="M107 434h112v126H107Z" fill="#dde5ec" />
      <rect x="113" y="442" width="100" height="108" rx="3" fill="#e4eaf0" />
      <Buildings
        x="144"
        y="469"
        width="34"
        height="34"
        color="#65849f"
        weight="light"
      />
      <text x="163" y="526" textAnchor="middle" className="map-small">
        大学生活动中心
      </text>
      <path
        d="M102 374H330M603 123v180M103 586h245M693 339v220"
        stroke="#e4e9ee"
        strokeWidth="12"
        strokeLinecap="round"
      />
      <text x="200" y="100" textAnchor="middle" className="map-zone">
        A 区 · 绿地周边
      </text>
      <text x="529" y="250" textAnchor="middle" className="map-zone">
        B 区 · 环形广场
      </text>
      <text x="572" y="650" textAnchor="middle" className="map-zone">
        C 区 · 东南侧步道
      </text>
      {[
        { x: 92, y: 337 },
        { x: 367, y: 565 },
        { x: 688, y: 590 },
        { x: 599, y: 189 },
      ].map((t, i) => (
        <g key={i}>
          <circle cx={t.x} cy={t.y} r="14" fill="#e2ede4" />
          <circle cx={t.x - 4} cy={t.y - 4} r="10" fill="#d3e4d6" />
        </g>
      ))}
      {positions.map(({ x, y, r, n }) => {
        const busy = occupied.some((a) => a.slot === n);
        const isClosed = closed.some((a) => a.slot === n);
        const active = selected === n;
        const dim = zone !== "全部区域" && zone !== slotName(n)[0] + " 区";
        return (
          <g
            key={n}
            role="button"
            tabIndex={dim ? -1 : 0}
            aria-label={`${slotName(n)} ${!connected ? "状态待同步" : isClosed ? "暂停开放" : busy ? "已占用" : "可预约"}`}
            onClick={() => !dim && onSelect(n)}
            onKeyDown={(e) =>
              ["Enter", " "].includes(e.key) && !dim && onSelect(n)
            }
            className="map-slot"
            opacity={dim ? 0.2 : 1}
            transform={`translate(${x} ${y})`}
          >
            <title>
              {slotName(n)} ·{" "}
              {!connected
                ? "状态待同步"
                : isClosed
                  ? "暂停开放"
                  : busy
                    ? "已占用"
                    : "可预约"}
            </title>
            {active && (
              <rect
                x="-24"
                y="-17"
                width="48"
                height="34"
                rx="8"
                fill="none"
                stroke="#155d96"
                strokeWidth="2"
                strokeDasharray="3 2"
              />
            )}
            <rect
              x="-18"
              y="-7"
              width="36"
              height="14"
              rx="3"
              transform={`rotate(${r})`}
              fill={
                !connected
                  ? "#acb7c3"
                  : isClosed
                    ? "#a5a9b0"
                    : busy
                      ? "#d39a5f"
                      : active
                        ? "#233f65"
                        : "#5c83ad"
              }
              stroke="white"
              strokeWidth="2"
            />
            <text
              y={r === 90 ? 5 : -16}
              x={r === 90 ? 27 : 0}
              textAnchor={r === 90 ? "start" : "middle"}
              className="slot-text"
            >
              {slotName(n)}
            </text>
          </g>
        );
      })}
      <g transform="translate(738 79)">
        <path d="M0 0l-8 23 8-5 8 5Z" fill="#52718c" />
        <text y="-10" textAnchor="middle" className="map-small">
          N
        </text>
      </g>
      <path d="M80 641h80m-80-5v10m80-10v10" stroke="#90a4b6" />
      <text x="120" y="662" textAnchor="middle" className="map-small">
        场地布局示意
      </text>
    </svg>
  );
}
