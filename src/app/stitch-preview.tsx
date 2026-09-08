"use client";

import { useMemo, useState } from "react";
import type { CenterlineResult } from "./centerline";
import type { MachinePlan } from "./machine-plan";
import { assessEmbroideryDetails } from "./detail-intelligence";
import { generateSatinStitches } from "./satin-engine";

type PreviewMode = "artwork" | "centerline" | "cleaned" | "stitches" | "satin" | "route";
type StitchMode = "running" | "bean";
type Props = { source: string; imageUrl: string; alt: string; centerlineResult: CenterlineResult | null; machinePlan: MachinePlan | null; busy: boolean; stitchMode?: StitchMode };
type Point = { x: number; y: number };

function readViewBox(source: string) {
  const svg = new DOMParser().parseFromString(source, "image/svg+xml").documentElement;
  const viewBox = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) return viewBox as [number, number, number, number];
  const width = Number.parseFloat(svg.getAttribute("width") ?? "") || 1;
  const height = Number.parseFloat(svg.getAttribute("height") ?? "") || width;
  return [0, 0, width, height] as [number, number, number, number];
}

const points = (value: Point[]) => value.map((point) => `${point.x},${point.y}`).join(" ");
function bean(value: Point[]) {
  if (value.length < 2) return value;
  const result = [value[0]];
  for (let index = 1; index < value.length; index += 1) result.push(value[index], value[index - 1], value[index]);
  return result;
}

function Eye({ open }: { open: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z" /><circle cx="12" cy="12" r="2.3" />{!open && <path d="M4 4 20 20" />}</svg>;
}

const controlStyle = { display: "grid", gridTemplateColumns: "76px 88px 42px", alignItems: "center", gap: 8 } as const;

export default function StitchPreview({ source, imageUrl, alt, centerlineResult, machinePlan, busy, stitchMode = "running" }: Props) {
  const [mode, setMode] = useState<PreviewMode>("artwork");
  const [showArtwork, setShowArtwork] = useState(true);
  const [satinDensity, setSatinDensity] = useState(0.4);
  const [satinMaxWidth, setSatinMaxWidth] = useState(6.2);
  const [minX, minY, width, height] = useMemo(() => readViewBox(source), [source]);
  const paths = centerlineResult?.paths ?? [];
  const route = machinePlan?.paths ?? [];
  const intelligence = useMemo(() => assessEmbroideryDetails(centerlineResult), [centerlineResult]);
  const satin = useMemo(() => generateSatinStitches(centerlineResult, { densityMm: satinDensity, maxWidthMm: satinMaxWidth }), [centerlineResult, satinDensity, satinMaxWidth]);
  const showVectors = mode !== "artwork" && paths.length > 0;
  const stitchesMode = mode === "stitches";
  const machineMode = mode === "route";
  const cleanedMode = mode === "cleaned";
  const satinMode = mode === "satin";
  const artworkVisible = mode === "artwork" || showArtwork;
  const previewHeight = 230;

  return <div style={{ position: "relative", width: "100%", height: satinMode ? 305 : previewHeight }}>
    {/* Blob URLs are local previews and cannot benefit from Next.js image optimization. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={imageUrl} alt={alt} style={{ position: "absolute", inset: 0, width: "100%", height: previewHeight, objectFit: "contain", opacity: mode === "artwork" ? 1 : artworkVisible ? 0.16 : 0, transition: "opacity 150ms ease" }} />
    {showVectors && <svg viewBox={`${minX} ${minY} ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0, width: "100%", height: previewHeight }}>
      {!satinMode && (machineMode ? route : paths).map((path, index) => {
        const detail = intelligence?.details[index];
        const decision = detail?.decision ?? "keep";
        if (cleanedMode && decision === "remove") return null;
        const base = cleanedMode && detail ? detail.simplifiedPoints : stitchesMode || machineMode ? path.stitches : path.points;
        const rendered = stitchesMode && stitchMode === "bean" ? bean(base) : base;
        return <polyline key={index} points={points(rendered)} fill="none" stroke={cleanedMode ? decision === "simplify" ? "#d98245" : "#52624b" : stitchesMode || machineMode ? "#1e211d" : "#e85d34"} strokeWidth={Math.max(width / 750, 0.35)} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity={0.88} />;
      })}
      {stitchesMode && paths.flatMap((path, pathIndex) => (stitchMode === "bean" ? bean(path.stitches) : path.stitches).map((point, pointIndex) => <circle key={`${pathIndex}-${pointIndex}`} cx={point.x} cy={point.y} r={Math.max(width / 430, 0.65)} fill="#e85d34" />))}
      {satinMode && satin?.columns.map((column, index) => <g key={`satin-${index}`}><polyline points={points(column.stitches)} fill="none" stroke="#6f8066" strokeWidth={Math.max(width / 820, 0.32)} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity={0.96} /><polyline points={points(column.centerline)} fill="none" stroke="#d98245" strokeWidth={Math.max(width / 1100, 0.22)} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" opacity={0.65} /></g>)}
      {machineMode && machinePlan?.bridges.map((bridge, index) => <line key={`b${index}`} x1={bridge.from.x} y1={bridge.from.y} x2={bridge.to.x} y2={bridge.to.y} stroke="#6f8066" strokeWidth={1.15} />)}
      {machineMode && machinePlan?.jumps.map((jump, index) => <line key={`j${index}`} x1={jump.from.x} y1={jump.from.y} x2={jump.to.x} y2={jump.to.y} stroke={jump.trim ? "#e85d34" : "#7d8079"} strokeWidth={jump.trim ? 1.15 : 0.85} strokeDasharray={jump.trim ? "5 3" : "2 3"} />)}
    </svg>}

    <div role="group" aria-label="Preview mode" style={{ position: "absolute", left: 0, top: -20, display: "flex", gap: 4, padding: 4, border: "1px solid rgba(30,33,29,.16)", borderRadius: 5, background: "rgba(247,242,231,.9)", zIndex: 2 }}>
      {(["artwork", "centerline", "cleaned", "stitches", "satin", "route"] as PreviewMode[]).map((option) => {
        const active = mode === option;
        const disabled = option !== "artwork" && (busy || !paths.length || (option === "route" && !machinePlan));
        return <button key={option} disabled={disabled} onClick={() => setMode(option)} style={{ border: 0, borderRadius: 3, padding: "7px 9px", color: active ? "#f7f2e7" : "rgba(30,33,29,.62)", background: active ? "#1e211d" : "transparent", font: "9px var(--font-geist-mono)", letterSpacing: ".07em", textTransform: "uppercase", opacity: disabled ? 0.35 : 1 }}>{option}</button>;
      })}
    </div>
    {mode !== "artwork" && <button type="button" aria-pressed={showArtwork} aria-label={showArtwork ? "Hide original artwork" : "Show original artwork"} title={showArtwork ? "Hide original" : "Show original"} onClick={() => setShowArtwork((value) => !value)} style={{ position: "absolute", right: 0, top: -20, zIndex: 3, display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 10px", border: "1px solid rgba(30,33,29,.16)", borderRadius: 5, background: showArtwork ? "rgba(247,242,231,.94)" : "rgba(247,242,231,.72)", color: showArtwork ? "#1e211d" : "rgba(30,33,29,.48)", font: "9px var(--font-geist-mono)", letterSpacing: ".06em", textTransform: "uppercase", cursor: "pointer", backdropFilter: "blur(8px)" }}><Eye open={showArtwork} /><span>Original</span></button>}

    {satinMode && satin && <div style={{ position: "absolute", left: 0, right: 0, top: previewHeight + 2, display: "flex", justifyContent: "space-between", gap: 18, padding: "9px 11px", border: "1px solid rgba(30,33,29,.12)", borderRadius: 5, background: "rgba(247,242,231,.72)", color: "rgba(30,33,29,.68)", font: "9px var(--font-geist-mono)", letterSpacing: ".04em", textTransform: "uppercase" }}>
      <div style={{ display: "grid", gap: 6 }}>
        <label style={controlStyle}><span>Density</span><input type="range" min="0.3" max="0.6" step="0.05" value={satinDensity} onChange={(event) => setSatinDensity(Number(event.target.value))} /><strong>{satinDensity.toFixed(2)} mm</strong></label>
        <label style={controlStyle}><span>Max width</span><input type="range" min="3" max="8" step="0.2" value={satinMaxWidth} onChange={(event) => setSatinMaxWidth(Number(event.target.value))} /><strong>{satinMaxWidth.toFixed(1)} mm</strong></label>
      </div>
      <div style={{ textAlign: "right", lineHeight: 1.7 }}><strong style={{ color: "#52624b" }}>{satin.columns.length} accepted · {satin.stitchCount} needle points</strong><br />{satin.rejected.removed} removed · {satin.rejected.short} short · {satin.rejected.width} width · {satin.rejected.unstable} unstable</div>
    </div>}
    {cleanedMode && intelligence && <div style={{ position: "absolute", right: 0, bottom: -18, font: "9px var(--font-geist-mono)", letterSpacing: ".05em", textTransform: "uppercase", color: "rgba(30,33,29,.62)" }}>{intelligence.keep} keep · {intelligence.simplify} simplify · {intelligence.remove} remove · {intelligence.originalPointCount - intelligence.cleanedPointCount} pts cleaned</div>}
    {machineMode && machinePlan && <div style={{ position: "absolute", left: 0, bottom: -42, display: "flex", gap: 12, flexWrap: "wrap", font: "9px var(--font-geist-mono)", letterSpacing: ".05em", textTransform: "uppercase", color: "rgba(30,33,29,.62)" }}><span>{machinePlan.routeStrategy} won</span><span>score {machinePlan.routeScore.toFixed(1)}</span><span>crossing {machinePlan.jumpCrossingScore.toFixed(1)}</span><span>{machinePlan.jumps.length} jumps</span><span>{machinePlan.trimCount} trims</span><span>{machinePlan.totalJumpMm.toFixed(1)} mm travel</span></div>}
  </div>;
}
