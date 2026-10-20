import React, { useState, useEffect, useRef } from "react";
import {
  Plus,
  Minus,
  ArrowsClockwise,
  ArrowsOut,
  ArrowsIn,
} from "@phosphor-icons/react";
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
  const [expanded, setExpanded] = useState(false);
  const [fit, setFit] = useState(0.4);
  const frame = useRef(null);
  const root = useRef(null);
  useEffect(() => {
    const el = frame.current;
    const observer = new ResizeObserver(() => {
      setFit(Math.min(el.clientWidth / 1350, el.clientHeight / 1185));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    const oldFocus = document.activeElement;
    document.body.style.overflow = "hidden";
    root.current.querySelector('[aria-label="收起场地图"]')?.focus();
    const escape = (e) => {
      if (e.key === "Escape") setExpanded(false);
      if (e.key === "Tab") {
        const targets = Array.from(
          root.current.querySelectorAll(
            'button:not(:disabled), [tabindex="0"]',
          ),
        );
        const first = targets[0],
          last = targets.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", escape);
      if (oldFocus?.isConnected) oldFocus.focus();
    };
  }, [expanded]);
  return (
    <div
      ref={root}
      className={`reference-map ${expanded ? "map-expanded" : ""}`}
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded || undefined}
      aria-label={expanded ? "展开的场地图" : undefined}
    >
      <div ref={frame} className={`map-scroll ${zoom > 1 ? "is-zoomed" : ""}`}>
        <div className="map-canvas">
          <svg
            viewBox="0 0 1350 1185"
            style={{
              width: `${1350 * fit * zoom}px`,
              height: `${1185 * fit * zoom}px`,
            }}
            className="venue-svg"
            role="group"
            aria-label="29个桁架位置"
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
      </div>
      <div className="map-scale-toolbar">
        <div className="legend" aria-label="场地状态图例">
          <span><i />可预约</span>
          <span><i className="occupied" />已占用</span>
          <span><i className="closed" />暂停</span>
        </div>
        <div className="map-zoom-controls">
          <button
            aria-label="缩小场地图"
            onClick={() => setZoom((z) => Math.max(0.75, z - 0.25))}
            disabled={zoom <= 0.75}
          >
            <Minus size={17} />
          </button>
          <output aria-label="地图缩放比例">{Math.round(zoom * 100)}%</output>
          <button
            aria-label="放大场地图"
            onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
            disabled={zoom >= 3}
          >
            <Plus size={17} />
          </button>
          <button
            aria-label="重置场地图"
            onClick={() => {
              setZoom(1);
              frame.current.scrollTo(0, 0);
            }}
          >
            <ArrowsClockwise size={17} />
            适配
          </button>
          <button
            aria-label={expanded ? "收起场地图" : "展开场地图"}
            aria-pressed={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ArrowsIn size={17} /> : <ArrowsOut size={17} />}
            <span>{expanded ? "收起" : "展开"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
