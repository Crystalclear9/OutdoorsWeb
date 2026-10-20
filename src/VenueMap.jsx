import React, { useState } from "react";
import { Plus, Minus, ArrowsClockwise } from "@phosphor-icons/react";
import plan from "./assets/venue-plan.png";
import { slotName, zoneName } from "./utils.js";
import { VENUE_POSITIONS, inSegment } from "./venue-layout.js";

export default function VenueMap({
  occupied,
  closed = [],
  selected,
  onSelect,
  zone = "all",
  connected = true,
}) {
  const [zoom, setZoom] = useState(1);
  return (
    <div className="reference-map">
      <div className={`map-scroll ${zoom > 1 ? "is-zoomed" : ""}`}>
        <svg
          viewBox="0 0 1350 1185"
          style={{ width: `${zoom * 100}%` }}
          className="venue-svg"
          role="group"
          aria-label="按 PDF 原图对齐的29个桁架位置"
        >
          <image href={plan} width="1350" height="1185" />
          {VENUE_POSITIONS.map((p) => {
            const active = selected === p.id,
              dim = !inSegment(p.id, zone),
              isClosed = closed.some((s) => s.slot === p.id),
              busy = occupied.some((s) => s.slot === p.id);
            const state = !connected
              ? "状态待同步"
              : isClosed
                ? "暂停开放"
                : busy
                  ? "已占用"
                  : "可预约";
            const color = !connected
              ? "#9aa6b3"
              : isClosed
                ? "#8e959e"
                : busy
                  ? "#b27635"
                  : active
                    ? "#21456d"
                    : "#3e779d";
            const angle = (p.r * Math.PI) / 180;
            const halfWidth =
              Math.abs(Math.cos(angle)) * 50 + Math.abs(Math.sin(angle)) * 17;
            const halfHeight =
              Math.abs(Math.sin(angle)) * 50 + Math.abs(Math.cos(angle)) * 17;
            const hitLeft = Math.min(p.x - halfWidth, p.lx - 39);
            const hitTop = Math.min(p.y - halfHeight, p.ly - 27);
            const hitRight = Math.max(p.x + halfWidth, p.lx + 39);
            const hitBottom = Math.max(p.y + halfHeight, p.ly + 6);
            return (
              <g
                key={p.id}
                className="reference-slot"
                data-slot-id={p.id}
                data-segment={zoneName(p.id)}
                role="button"
                aria-label={`${slotName(p.id)} ${state}`}
                aria-pressed={active}
                aria-hidden={dim || undefined}
                tabIndex={dim ? -1 : 0}
                opacity={dim ? 0.18 : 1}
                onClick={() => !dim && onSelect(p.id)}
                onKeyDown={(e) => {
                  if (!dim && ["Enter", " "].includes(e.key)) {
                    e.preventDefault();
                    onSelect(p.id);
                  }
                }}
              >
                <title>
                  {slotName(p.id)} · {zoneName(p.id)} · {state}
                </title>
                <rect
                  x={hitLeft}
                  y={hitTop}
                  width={hitRight - hitLeft}
                  height={hitBottom - hitTop}
                  fill="transparent"
                />
                <g transform={`translate(${p.x} ${p.y}) rotate(${p.r})`}>
                  {active && (
                    <rect
                      x="-55"
                      y="-18"
                      width="110"
                      height="36"
                      rx="5"
                      className="slot-selection"
                    />
                  )}
                  <rect
                    x="-46"
                    y="-8"
                    width="92"
                    height="16"
                    fill={color}
                    stroke="white"
                    strokeWidth="2"
                  />
                  <rect
                    x="-50"
                    y="-17"
                    width="100"
                    height="34"
                    fill="transparent"
                  />
                </g>
                <text
                  x={p.lx}
                  y={p.ly}
                  textAnchor="middle"
                  fill={active ? "#173e68" : "#526b83"}
                  className="reference-slot-label"
                >
                  {slotName(p.id)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="reference-map-controls">
        <button
          aria-label="放大场地图"
          onClick={() => setZoom((z) => Math.min(2.5, z + 0.5))}
          disabled={zoom >= 2.5}
        >
          <Plus size={18} />
        </button>
        <button
          aria-label="缩小场地图"
          onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
          disabled={zoom <= 1}
        >
          <Minus size={18} />
        </button>
        <button aria-label="重置场地图" onClick={() => setZoom(1)}>
          <ArrowsClockwise size={17} />
        </button>
      </div>
    </div>
  );
}
