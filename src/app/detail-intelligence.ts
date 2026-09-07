import type { CenterlinePath, CenterlineResult } from "./centerline";

export type DetailDecision = "keep" | "simplify" | "remove";
export type DetailAssessment = {
  index: number;
  decision: DetailDecision;
  score: number;
  lengthMm: number;
  needlePoints: number;
  isolationMm: number;
  reason: string;
};
export type DetailIntelligence = {
  details: DetailAssessment[];
  keep: number;
  simplify: number;
  remove: number;
  retainedLengthMm: number;
};

type Point = { x: number; y: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function endpoints(path: CenterlinePath) { return [path.points[0], path.points[path.points.length - 1]].filter(Boolean); }
function nearestOtherPath(path: CenterlinePath, index: number, paths: CenterlinePath[], mmPerVector: number) {
  let nearest = Infinity;
  const own = endpoints(path);
  paths.forEach((other, otherIndex) => {
    if (otherIndex === index) return;
    for (const a of own) for (const b of endpoints(other)) nearest = Math.min(nearest, distance(a, b) * mmPerVector);
  });
  return Number.isFinite(nearest) ? nearest : 99;
}

export function assessEmbroideryDetails(result: CenterlineResult | null, targetWidthMm: number): DetailIntelligence | null {
  if (!result) return null;
  const vectorWidth = result.viewBox[2] || 1;
  const mmPerVector = targetWidthMm / vectorWidth;
  const details = result.paths.map<DetailAssessment>((path, index) => {
    const isolationMm = nearestOtherPath(path, index, result.paths, mmPerVector);
    const length = path.lengthMm;
    const needlePoints = path.stitches.length;
    let score = 100;
    if (length < 1.5) score -= 70;
    else if (length < 2.5) score -= 45;
    else if (length < 4) score -= 22;
    if (needlePoints <= 2) score -= 20;
    if (isolationMm > 3.5 && length < 4) score -= 18;
    if (isolationMm > 6 && length < 6) score -= 12;
    score = Math.max(0, Math.min(100, score));
    let decision: DetailDecision = "keep";
    let reason = "Long enough to preserve as a distinct embroidered detail.";
    if (score < 38) {
      decision = "remove";
      reason = length < 2.5 ? `Only ${length.toFixed(1)} mm long; likely to read as thread noise.` : "Costs machine travel without adding enough visible information.";
    } else if (score < 72) {
      decision = "simplify";
      reason = needlePoints <= 2 ? "Very few useful needle positions; simplify into a cleaner mark." : `Small ${length.toFixed(1)} mm detail; preserve the idea with less geometry.`;
    }
    return { index, decision, score, lengthMm: length, needlePoints, isolationMm, reason };
  });
  return {
    details,
    keep: details.filter(d => d.decision === "keep").length,
    simplify: details.filter(d => d.decision === "simplify").length,
    remove: details.filter(d => d.decision === "remove").length,
    retainedLengthMm: details.filter(d => d.decision !== "remove").reduce((sum, d) => sum + d.lengthMm, 0),
  };
}
