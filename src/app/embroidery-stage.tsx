"use client";

import { useEffect, useMemo, useState } from "react";
import type { CenterlineResult } from "./centerline";
import { buildEmbroideryPlan } from "./embroidery-plan";
import { generateFillStitches, type FillResult } from "./fill-engine";
import { downloadPes } from "./pes-writer";
import { generateSatinStitches } from "./satin-engine";

type Props = {
  source: string;
  sourceName: string;
  centerlines: CenterlineResult | null;
  targetWidthMm: number;
  stitchMode: "running" | "bean";
  busy: boolean;
};

const mono = "9px var(--font-geist-mono)";
const line = (points: { x: number; y: number }[]) => points.map((point) => `${point.x},${point.y}`).join(" ");
const kindColor = { running: "#e85d34", bean: "#e85d34", satin: "#52624b", "fill-underlay": "#c18b59", fill: "#1e211d" };
function fingerprint(value: string) { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619); return (hash >>> 0).toString(36); }

export default function EmbroideryStage({ source, sourceName, centerlines, targetWidthMm, stitchMode, busy }: Props) {
  const [rowSpacing, setRowSpacing] = useState(0.45);
  const [fillStitchLength, setFillStitchLength] = useState(3);
  const [previewProgress, setPreviewProgress] = useState(100);
  const [acknowledged, setAcknowledged] = useState(false);
  const sourceKey = useMemo(() => fingerprint(source), [source]);
  const fillKey = centerlines ? `${sourceKey}:${targetWidthMm}:${rowSpacing}:${fillStitchLength}:${centerlines.rasterWidth}` : "";
  const [fillState, setFillState] = useState<{ key: string; result: FillResult | null }>({ key: "", result: null });
  const fill = fillState.key === fillKey ? fillState.result : null;
  const fillBusy = Boolean(centerlines && fillState.key !== fillKey);

  useEffect(() => {
    let cancelled = false;
    if (!centerlines) return;
    generateFillStitches(source, centerlines, { rowSpacingMm: rowSpacing, stitchLengthMm: fillStitchLength })
      .then((result) => { if (!cancelled) setFillState({ key: fillKey, result }); })
      .catch(() => { if (!cancelled) setFillState({ key: fillKey, result: null }); });
    return () => { cancelled = true; };
  }, [source, centerlines, rowSpacing, fillStitchLength, fillKey]);

  const satin = useMemo(() => generateSatinStitches(centerlines), [centerlines]);
  const plan = useMemo(() => buildEmbroideryPlan(centerlines, satin, fill, targetWidthMm, stitchMode), [centerlines, satin, fill, targetWidthMm, stitchMode]);
  const visibleCount = plan ? Math.ceil(plan.blocks.length * previewProgress / 100) : 0;
  const viewWidth = Math.max(20, plan?.widthMm ?? targetWidthMm);
  const viewHeight = Math.max(20, plan?.heightMm ?? targetWidthMm);
  const blocked = busy || fillBusy || !plan?.safeToExport || !acknowledged;
  const intelligence = plan?.intelligence;

  return <section style={{ marginTop: 28, paddingTop: 26, borderTop: "1px solid rgba(30,33,29,.14)" }} aria-labelledby="machine-file-title">
    <header style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-start" }}>
      <div><span style={{ color: "#e85d34", font: mono, letterSpacing: ".14em", textTransform: "uppercase" }}>Unified workshop</span><h3 id="machine-file-title" style={{ margin: "8px 0 0", fontSize: 25, letterSpacing: "-.04em" }}>One plan. Ready for the machine.</h3></div>
      <span style={{ padding: "8px 10px", borderRadius: 3, color: plan?.safeToExport ? "#52624b" : "#a3482d", background: plan?.safeToExport ? "#52624b20" : "#e85d3420", font: mono, letterSpacing: ".08em", textTransform: "uppercase" }}>{fillBusy || busy ? "Calculating" : plan?.safeToExport ? "Machine + digitization passed" : "Export blocked"}</span>
    </header>

    {intelligence && <div style={{ marginTop: 20, padding: 18, borderRadius: 7, background: "#1e211d", color: "#f7f2e7", display: "grid", gap: 15 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div><span style={{ color: "#f18a69", font: mono, letterSpacing: ".14em", textTransform: "uppercase" }}>Digitization Intelligence v1</span><strong style={{ display: "block", marginTop: 7, fontSize: 21 }}>Building embroidery intent.</strong></div>
        <div style={{ textAlign: "right" }}><strong style={{ display: "block", fontSize: 28 }}>{intelligence.score}</strong><small style={{ color: "#f7f2e788", font: mono, textTransform: "uppercase" }}>Digitization score</small></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(105px,1fr))", borderTop: "1px solid #f7f2e729", borderLeft: "1px solid #f7f2e729" }}>
        {[
          ["Source objects", intelligence.sourceObjects], ["Running", intelligence.runningDetails], ["Bean", intelligence.beanDetails], ["Satin", intelligence.satinDetails],
          ["Fill", intelligence.fillDetails], ["Omitted", intelligence.omittedDetails], ["Rebuilt", plan?.reconstructedContinuities ?? 0],
        ].map(([label, value]) => <div key={label} style={{ padding: 10, borderRight: "1px solid #f7f2e729", borderBottom: "1px solid #f7f2e729" }}><small style={{ display: "block", color: "#f7f2e788", font: mono, textTransform: "uppercase" }}>{label}</small><strong style={{ display: "block", marginTop: 4 }}>{value}</strong></div>)}
      </div>
      <p style={{ margin: 0, color: "#f7f2e7aa", font: "10px/1.55 var(--font-geist-mono)" }}>{intelligence.summary} Reconstruction preserves the identity of each source object and accepts bridges only inside its artwork. A score below 70 blocks export.</p>
    </div>}

    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(260px,.7fr)", gap: 20, marginTop: 22 }}>
      <div style={{ minHeight: 330, padding: 14, border: "1px solid rgba(30,33,29,.14)", borderRadius: 7, background: "#f2eddf" }}>
        {plan && <svg viewBox={`${-viewWidth / 2 - 5} ${-viewHeight / 2 - 5} ${viewWidth + 10} ${viewHeight + 10}`} style={{ width: "100%", height: 285 }} aria-label="Complete embroidery route preview">
          {plan.blocks.slice(0, visibleCount).map((block) => <polyline key={block.id} points={line(block.points)} fill="none" stroke={block.color === "#000000" ? kindColor[block.kind] : block.color} strokeWidth={block.kind === "fill-underlay" ? 0.18 : 0.25} strokeLinecap="round" strokeLinejoin="round" opacity={block.kind === "fill-underlay" ? 0.45 : 0.9} />)}
        </svg>}
        <label style={{ display: "grid", gridTemplateColumns: "80px 1fr 42px", gap: 10, alignItems: "center", font: mono, letterSpacing: ".06em", textTransform: "uppercase", color: "rgba(30,33,29,.62)" }}><span>Simulation</span><input type="range" min="0" max="100" value={previewProgress} onChange={(event) => setPreviewProgress(Number(event.target.value))} /><strong>{previewProgress}%</strong></label>
      </div>

      <div style={{ display: "grid", alignContent: "start", gap: 12 }}>
        <label style={{ display: "grid", gap: 7, font: mono, letterSpacing: ".06em", textTransform: "uppercase" }}><span>Fill row spacing · {rowSpacing.toFixed(2)} mm</span><input type="range" min="0.35" max="0.6" step="0.05" value={rowSpacing} onChange={(event) => setRowSpacing(Number(event.target.value))} /></label>
        <label style={{ display: "grid", gap: 7, font: mono, letterSpacing: ".06em", textTransform: "uppercase" }}><span>Fill stitch · {fillStitchLength.toFixed(1)} mm</span><input type="range" min="2" max="4" step="0.2" value={fillStitchLength} onChange={(event) => setFillStitchLength(Number(event.target.value))} /></label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderTop: "1px solid rgba(30,33,29,.14)", borderLeft: "1px solid rgba(30,33,29,.14)" }}>
          {[
            ["Needles", plan?.stitchCount.toLocaleString() ?? "…"], ["Blocks", plan?.blocks.length ?? "…"],
            ["Jumps", plan?.jumpCount ?? "…"], ["Trims", plan?.trimCount ?? "…"],
            ["Colors", plan?.colors.length ?? "…"], ["Time", plan ? `~${Math.ceil(plan.estimatedMinutes)} min` : "…"],
          ].map(([label, value]) => <div key={label} style={{ padding: 10, borderRight: "1px solid rgba(30,33,29,.14)", borderBottom: "1px solid rgba(30,33,29,.14)" }}><small style={{ display: "block", color: "rgba(30,33,29,.5)", font: mono, textTransform: "uppercase" }}>{label}</small><strong style={{ display: "block", marginTop: 5 }}>{value}</strong></div>)}
        </div>
      </div>
    </div>

    <div style={{ display: "grid", gap: 7, marginTop: 16 }}>
      {plan?.checks.map((check, index) => <div key={index} style={{ display: "flex", alignItems: "center", gap: 9, color: check.level === "block" ? "#a3482d" : "rgba(30,33,29,.68)", font: mono, letterSpacing: ".04em", textTransform: "uppercase" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: check.level === "pass" ? "#6f8066" : check.level === "warning" ? "#d98245" : "#e85d34" }} />{check.message}</div>)}
    </div>

    <div style={{ display: "grid", gap: 12, marginTop: 20, padding: 16, borderRadius: 6, background: "#1e211d", color: "#f7f2e7" }}>
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", font: "10px/1.5 var(--font-geist-mono)", color: "#f7f2e7b8" }}><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} style={{ marginTop: 2 }} /><span>I’ll inspect this prototype in Ink/Stitch or PE-Design and stitch the first test on scrap fabric.</span></label>
      <button type="button" disabled={blocked} onClick={() => plan && downloadPes(plan, sourceName)} style={{ minHeight: 44, border: 0, borderRadius: 4, background: blocked ? "#f7f2e729" : "#f18a69", color: blocked ? "#f7f2e766" : "#1e211d", font: "10px var(--font-geist-mono)", letterSpacing: ".1em", textTransform: "uppercase", cursor: blocked ? "not-allowed" : "pointer" }}>{fillBusy || busy ? "Building machine plan…" : plan?.safeToExport ? `Download .PES · ${plan.hoop?.name} mm` : "Resolve safety checks to export"}</button>
    </div>
  </section>;
}
