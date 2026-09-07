"use client";

import { useMemo, useState } from "react";
import type { CenterlineResult } from "./centerline";

type PreviewMode = "artwork" | "centerline" | "stitches";

type StitchPreviewProps = {
  source: string;
  imageUrl: string;
  alt: string;
  centerlineResult: CenterlineResult | null;
  busy: boolean;
};

function readViewBox(source: string) {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  const svg = parsed.documentElement;
  const raw = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (raw?.length === 4 && raw.every(Number.isFinite)) return raw as [number, number, number, number];
  const width = Number.parseFloat(svg.getAttribute("width") ?? "") || 1;
  const height = Number.parseFloat(svg.getAttribute("height") ?? "") || width;
  return [0, 0, width, height] as [number, number, number, number];
}

function pointsAttribute(points: { x: number; y: number }[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

export default function StitchPreview({ source, imageUrl, alt, centerlineResult, busy }: StitchPreviewProps) {
  const [mode, setMode] = useState<PreviewMode>("artwork");
  const [minX, minY, width, height] = useMemo(() => readViewBox(source), [source]);
  const paths = centerlineResult?.paths ?? [];
  const showOverlay = mode !== "artwork" && paths.length > 0;
  const showStitches = mode === "stitches";

  return (
    <div style={{ position: "relative", width: "100%", height: 230 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={alt}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
          opacity: mode === "artwork" ? 1 : 0.22,
          transition: "opacity 160ms ease",
        }}
      />

      {showOverlay && (
        <svg
          viewBox={`${minX} ${minY} ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          aria-label={showStitches ? "Stitch preview" : "Centerline preview"}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
        >
          {paths.map((path, index) => (
            <polyline
              key={`route-${index}`}
              points={pointsAttribute(showStitches ? path.stitches : path.points)}
              fill="none"
              stroke={showStitches ? "#1e211d" : "#e85d34"}
              strokeWidth={Math.max(width / 750, 0.35)}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              opacity={showStitches ? 0.68 : 0.92}
            />
          ))}
          {showStitches && paths.flatMap((path, pathIndex) => path.stitches.map((point, stitchIndex) => (
            <circle
              key={`needle-${pathIndex}-${stitchIndex}`}
              cx={point.x}
              cy={point.y}
              r={Math.max(width / 430, 0.65)}
              fill="#e85d34"
              vectorEffect="non-scaling-stroke"
            />
          )))}
        </svg>
      )}

      <div
        role="group"
        aria-label="Preview mode"
        style={{
          position: "absolute",
          left: 0,
          top: -20,
          display: "flex",
          gap: 4,
          padding: 4,
          border: "1px solid rgba(30,33,29,.16)",
          borderRadius: 5,
          background: "rgba(247,242,231,.9)",
          backdropFilter: "blur(8px)",
          zIndex: 2,
        }}
      >
        {(["artwork", "centerline", "stitches"] as PreviewMode[]).map((option) => {
          const active = mode === option;
          const disabled = option !== "artwork" && (busy || paths.length === 0);
          return (
            <button
              key={option}
              type="button"
              disabled={disabled}
              onClick={() => setMode(option)}
              style={{
                border: 0,
                borderRadius: 3,
                padding: "7px 9px",
                color: active ? "#f7f2e7" : "rgba(30,33,29,.62)",
                background: active ? "#1e211d" : "transparent",
                font: "9px var(--font-geist-mono)",
                letterSpacing: ".07em",
                textTransform: "uppercase",
                cursor: disabled ? "default" : "pointer",
                opacity: disabled ? 0.35 : 1,
              }}
            >
              {option}
            </button>
          );
        })}
      </div>

      {mode !== "artwork" && !busy && paths.length === 0 && (
        <span style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", font: "9px var(--font-geist-mono)", textTransform: "uppercase", letterSpacing: ".08em", color: "rgba(30,33,29,.55)" }}>
          No recovered routes
        </span>
      )}
    </div>
  );
}
