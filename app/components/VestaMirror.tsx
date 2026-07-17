"use client";

import { useId, useMemo, useState, type PointerEvent } from "react";
import type { DemoWardrobeItem } from "@/lib/demo-wardrobe";

type VestaMirrorProps = {
  items: DemoWardrobeItem[];
  title?: string;
  score?: number;
  compact?: boolean;
};

export function VestaMirror({ items, title = "Vista de composición", score, compact = false }: VestaMirrorProps) {
  const id = useId().replace(/:/gu, "");
  const [rotation, setRotation] = useState(-5);
  const pieces = useMemo(() => ({
    top: items.find((item) => item.category === "tops"),
    layer: items.find((item) => item.category === "layers"),
    bottom: items.find((item) => item.category === "bottoms"),
    cap: items.find((item) => /gorra|sombrero|cap|hat/iu.test(`${item.type} ${item.name}`)),
    glasses: items.find((item) => /gafas|lentes|glasses/iu.test(`${item.type} ${item.name}`)),
  }), [items]);

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (compact || event.pointerType === "touch") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const relative = (event.clientX - bounds.left) / Math.max(1, bounds.width);
    setRotation(Math.round((relative - .5) * 18));
  };

  return (
    <section className={`vesta-mirror ${compact ? "is-compact" : ""}`} aria-label={title}>
      <div className="mirror-heading">
        <div>
          <span className="micro-label">Vesta Mirror · 2.5D</span>
          <strong>{title}</strong>
        </div>
        {typeof score === "number" && <span className="mirror-score">{score}<small>/100</small></span>}
      </div>

      <div
        className="mirror-stage"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => !compact && setRotation(-5)}
      >
        <span className="mirror-orbit orbit-one" aria-hidden="true" />
        <span className="mirror-orbit orbit-two" aria-hidden="true" />
        <div className="mirror-model" style={{ transform: `rotateY(${rotation}deg) rotateX(-2deg)` }}>
          <svg viewBox="0 0 240 420" role="img" aria-label={`Composición de ${items.map((item) => item.name).join(", ")}`}>
            <defs>
              <linearGradient id={`body-${id}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#f4e7d8" />
                <stop offset=".48" stopColor="#cfaa8d" />
                <stop offset="1" stopColor="#9d7059" />
              </linearGradient>
              <linearGradient id={`sheen-${id}`} x1="0" y1="0" x2="1" y2=".25">
                <stop offset="0" stopColor="#ffffff" stopOpacity=".42" />
                <stop offset=".34" stopColor="#ffffff" stopOpacity=".04" />
                <stop offset="1" stopColor="#000000" stopOpacity=".24" />
              </linearGradient>
              <filter id={`depth-${id}`} x="-30%" y="-30%" width="160%" height="170%">
                <feDropShadow dx="0" dy="7" stdDeviation="6" floodColor="#11130f" floodOpacity=".24" />
              </filter>
              <filter id={`soft-${id}`} x="-30%" y="-30%" width="160%" height="170%">
                <feDropShadow dx="0" dy="12" stdDeviation="14" floodColor="#11130f" floodOpacity=".18" />
              </filter>
            </defs>

            <ellipse cx="120" cy="394" rx="64" ry="12" fill="#151712" opacity=".13" />
            <g className="mirror-body" filter={`url(#soft-${id})`}>
              <ellipse cx="120" cy="53" rx="25" ry="30" fill={`url(#body-${id})`} />
              <path d="M108 78h24l5 28-17 13-17-13z" fill={`url(#body-${id})`} />
              <path d="M94 99c8-8 44-8 52 0l13 111-14 58-6 112h-30l-5-104-7 104H67l-1-112-14-58 13-111z" fill={`url(#body-${id})`} />
              <path d="M66 108 43 219l15 4 35-95zM174 108l23 111-15 4-35-95z" fill={`url(#body-${id})`} />
            </g>

            {pieces.bottom && (
              <g className="mirror-garment mirror-bottom" filter={`url(#depth-${id})`}>
                <path d="M82 213h76l-3 47-15 119h-31l-7-103-4 103H67L84 260z" fill={pieces.bottom.tone} stroke="#181a16" strokeOpacity=".28" strokeWidth="1.5" />
                <path d="M82 213h76l-3 47-15 119h-31l-7-103-4 103H67L84 260z" fill={`url(#sheen-${id})`} opacity=".7" />
                <path d="M120 218v53M91 231h58" fill="none" stroke="#f7f2e8" strokeOpacity=".25" strokeWidth="1.2" />
              </g>
            )}

            {pieces.top && (
              <g className="mirror-garment mirror-top" filter={`url(#depth-${id})`}>
                <path d="M94 93c7 6 45 6 52 0l29 20-18 42-13-9 4 83H92l4-83-13 9-18-42z" fill={pieces.top.tone} stroke="#181a16" strokeOpacity=".28" strokeWidth="1.5" />
                <path d="M94 93c7 6 45 6 52 0l29 20-18 42-13-9 4 83H92l4-83-13 9-18-42z" fill={`url(#sheen-${id})`} opacity=".62" />
                <path d="M105 95c2 14 27 14 30 0" fill="none" stroke="#f7f2e8" strokeOpacity=".32" strokeWidth="2" />
              </g>
            )}

            {pieces.layer && (
              <g className="mirror-garment mirror-layer" filter={`url(#depth-${id})`}>
                <path d="M91 90c7 8 17 12 29 12l-11 127H82l8-78-13 10-19-44z" fill={pieces.layer.tone} stroke="#181a16" strokeOpacity=".34" strokeWidth="1.6" />
                <path d="M149 90c-7 8-17 12-29 12l11 127h27l-8-78 13 10 19-44z" fill={pieces.layer.tone} stroke="#181a16" strokeOpacity=".34" strokeWidth="1.6" />
                <path d="M91 90c7 8 17 12 29 12l-11 127H82l8-78-13 10-19-44zM149 90c-7 8-17 12-29 12l11 127h27l-8-78 13 10 19-44z" fill={`url(#sheen-${id})`} opacity=".52" />
                <path d="M120 103v125" stroke="#f7f2e8" strokeOpacity=".34" strokeWidth="1.5" />
              </g>
            )}

            {pieces.cap && (
              <g className="mirror-garment mirror-cap" filter={`url(#depth-${id})`}>
                <path d="M93 49c2-26 52-26 55 0l-3 8H96z" fill={pieces.cap.tone} stroke="#181a16" strokeOpacity=".32" strokeWidth="1.4" />
                <path d="M143 54c20 0 27 5 29 10-16 2-29 0-39-5z" fill={pieces.cap.tone} />
                <path d="M95 47c15-8 33-8 51 0" fill="none" stroke="#fff" strokeOpacity=".25" />
              </g>
            )}

            {pieces.glasses && (
              <g className="mirror-garment mirror-glasses" fill="none" stroke={pieces.glasses.tone} strokeWidth="3">
                <circle cx="108" cy="54" r="10" />
                <circle cx="133" cy="54" r="10" />
                <path d="M118 54h5M98 52l-8-3M143 52l8-3" />
              </g>
            )}
          </svg>
          <span className="mirror-depth-line" aria-hidden="true" />
        </div>

        <div className="mirror-caption">
          <span>Composición, color y proporción</span>
          <small>No simula talla ni caída física</small>
        </div>
      </div>

      <div className="mirror-piece-list" aria-label="Prendas de la composición">
        {items.map((item) => (
          <span key={item.id}>
            <i style={{ background: item.tone }} aria-hidden="true" />
            {item.name}
          </span>
        ))}
      </div>

      {!compact && (
        <label className="mirror-control">
          <span>Girar vista</span>
          <input
            type="range"
            min="-12"
            max="12"
            step="1"
            value={rotation}
            onChange={(event) => setRotation(Number(event.target.value))}
            aria-label="Girar la vista de composición"
          />
        </label>
      )}
    </section>
  );
}
