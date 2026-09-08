import type { CenterlinePoint, CenterlineResult } from "./centerline";
import { assessEmbroideryDetails } from "./detail-intelligence";
import type { FillResult } from "./fill-engine";
import { pointFallsInFill } from "./fill-engine";
import type { SatinResult } from "./satin-engine";

export type DigitizationRole = "running" | "bean" | "satin" | "fill" | "omit";

export type DigitizationDecision = {
  sourceIndex: number;
  role: DigitizationRole;
  confidence: number;
  points: CenterlinePoint[];
  reason: string;
};

export type DigitizationReport = {
  decisions: DigitizationDecision[];
  sourceDetails: number;
  retainedDetails: number;
  omittedDetails: number;
  simplifiedDetails: number;
  runningDetails: number;
  beanDetails: number;
  satinDetails: number;
  fillDetails: number;
  originalBlocks: number;
  optimizedBlocks: number;
  joinedContinuities: number;
  score: number;
  summary: string;
};

function curvature(points: CenterlinePoint[]) {
  if (points.length < 3) return 0;
  let turn = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const a = points[index - 1], b = points[index], c = points[index + 1];
    const ab = Math.atan2(b.y - a.y, b.x - a.x), bc = Math.atan2(c.y - b.y, c.x - b.x);
    let delta = Math.abs(bc - ab);
    if (delta > Math.PI) delta = Math.PI * 2 - delta;
    turn += delta;
  }
  return turn / (points.length - 2);
}

export function interpretDigitization(
  centerlines: CenterlineResult | null,
  satin: SatinResult | null,
  fill: FillResult | null,
  preferredLineRole: "running" | "bean",
): DigitizationReport | null {
  if (!centerlines) return null;
  const detail = assessEmbroideryDetails(centerlines);
  const satinSources = new Set(satin?.columns.map((column) => column.sourceIndex) ?? []);
  const decisions = centerlines.paths.map<DigitizationDecision>((path, sourceIndex) => {
    const assessment = detail?.details[sourceIndex];
    const points = assessment?.simplifiedPoints ?? path.points;
    if (assessment?.decision === "remove") return {
      sourceIndex, role: "omit", confidence: 92, points,
      reason: "Below the physical detail threshold; omitted to prevent thread noise.",
    };
    const fillCoverage = fill ? path.points.filter((point) => pointFallsInFill(centerlines, fill, point)).length / Math.max(1, path.points.length) : 0;
    if (fillCoverage > 0.45) return {
      sourceIndex, role: "fill", confidence: Math.round(76 + fillCoverage * 20), points,
      reason: "Contained by a broad stitched region; resolved as fill instead of a duplicate outline.",
    };
    if (satinSources.has(sourceIndex)) return {
      sourceIndex, role: "satin", confidence: 88, points,
      reason: "Stable narrow column with sufficient rung coverage; resolved as satin.",
    };
    const expressive = path.lengthMm <= 14 || curvature(points) > 0.55;
    const role: DigitizationRole = preferredLineRole === "bean" || expressive ? "bean" : "running";
    return {
      sourceIndex, role, confidence: assessment?.decision === "simplify" ? 74 : 82, points,
      reason: assessment?.decision === "simplify"
        ? `Simplified from ${assessment.originalPoints} nodes before ${role} stitching.`
        : expressive ? "Short or expressive line reinforced with bean stitch." : "Long clean contour resolved as running stitch.",
    };
  });
  const count = (role: DigitizationRole) => decisions.filter((decision) => decision.role === role).length;
  const omittedDetails = count("omit"), retainedDetails = decisions.length - omittedDetails;
  return {
    decisions,
    sourceDetails: decisions.length,
    retainedDetails,
    omittedDetails,
    simplifiedDetails: detail?.simplify ?? 0,
    runningDetails: count("running"),
    beanDetails: count("bean"),
    satinDetails: count("satin"),
    fillDetails: count("fill"),
    originalBlocks: retainedDetails + (fill?.blocks.length ?? 0),
    optimizedBlocks: retainedDetails + (fill?.blocks.length ?? 0),
    joinedContinuities: 0,
    score: 0,
    summary: "Interpreting the design as embroidery intent.",
  };
}

export function finalizeDigitizationReport(report: DigitizationReport | null, optimizedBlocks: number, jumps: number, trims: number) {
  if (!report) return null;
  const joinedContinuities = Math.max(0, report.originalBlocks - optimizedBlocks);
  const movementPenalty = Math.min(42, jumps * 1.15 + trims * 1.8);
  const fragmentationPenalty = report.retainedDetails ? Math.min(25, (optimizedBlocks / report.retainedDetails) * 8) : 25;
  const confidence = report.decisions.length
    ? report.decisions.reduce((sum, decision) => sum + decision.confidence, 0) / report.decisions.length
    : 0;
  const score = Math.max(0, Math.min(100, Math.round(confidence - movementPenalty - fragmentationPenalty + joinedContinuities * 0.8)));
  return {
    ...report,
    optimizedBlocks,
    joinedContinuities,
    score,
    summary: `${report.retainedDetails} details retained, ${report.omittedDetails} omitted and ${joinedContinuities} continuities joined.`,
  };
}
