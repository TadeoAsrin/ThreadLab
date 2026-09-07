import type { CenterlinePoint, CenterlineResult } from "./centerline";

export type DetailDecision = "keep" | "simplify" | "remove";
export type DetailAssessment = {
  index: number;
  decision: DetailDecision;
  score: number;
  lengthMm: number;
  needlePoints: number;
  originalPoints: number;
  simplifiedPoints: CenterlinePoint[];
  reason: string;
};
export type DetailIntelligence = {
  details: DetailAssessment[];
  keep: number;
  simplify: number;
  remove: number;
  retainedLengthMm: number;
  originalPointCount: number;
  cleanedPointCount: number;
};

function pointSegmentDistance(point: CenterlinePoint, a: CenterlinePoint, b: CenterlinePoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function rdp(points: CenterlinePoint[], tolerance: number): CenterlinePoint[] {
  if (points.length <= 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  let maxDistance = 0;
  let index = -1;
  for (let i = 1; i < points.length - 1; i += 1) {
    const value = pointSegmentDistance(points[i], first, last);
    if (value > maxDistance) { maxDistance = value; index = i; }
  }
  if (maxDistance <= tolerance || index < 0) return [first, last];
  const left = rdp(points.slice(0, index + 1), tolerance);
  const right = rdp(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

function vectorLength(points: CenterlinePoint[]) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return total;
}

function simplifyForEmbroidery(points: CenterlinePoint[], lengthMm: number, score: number) {
  if (points.length <= 2 || lengthMm <= 0) return points;
  const vectorPerMm = vectorLength(points) / lengthMm;
  const toleranceMm = score < 55 ? 0.55 : 0.35;
  const simplified = rdp(points, toleranceMm * vectorPerMm);
  return simplified.length >= 2 ? simplified : [points[0], points[points.length - 1]];
}

export function assessEmbroideryDetails(result: CenterlineResult | null): DetailIntelligence | null {
  if (!result) return null;
  const details = result.paths.map<DetailAssessment>((path, index) => {
    const length = path.lengthMm;
    const needlePoints = path.stitches.length;
    let score = 100;
    if (length < 1.5) score -= 75;
    else if (length < 2.5) score -= 48;
    else if (length < 4) score -= 24;
    if (needlePoints <= 2) score -= 22;
    else if (needlePoints === 3) score -= 8;
    score = Math.max(0, Math.min(100, score));

    let decision: DetailDecision = "keep";
    let reason = "Long enough to preserve as a distinct embroidered detail.";
    if (score < 38) {
      decision = "remove";
      reason = `Only ${length.toFixed(1)} mm long with ${needlePoints} needle point${needlePoints === 1 ? "" : "s"}; likely to read as thread noise.`;
    } else if (score < 72) {
      decision = "simplify";
      reason = `Small ${length.toFixed(1)} mm detail; preserve the idea with a cleaner mark.`;
    }

    const simplifiedPoints = decision === "simplify" ? simplifyForEmbroidery(path.points, length, score) : path.points;
    return { index, decision, score, lengthMm: length, needlePoints, originalPoints: path.points.length, simplifiedPoints, reason };
  });

  const retained = details.filter((detail) => detail.decision !== "remove");
  return {
    details,
    keep: details.filter((detail) => detail.decision === "keep").length,
    simplify: details.filter((detail) => detail.decision === "simplify").length,
    remove: details.filter((detail) => detail.decision === "remove").length,
    retainedLengthMm: retained.reduce((sum, detail) => sum + detail.lengthMm, 0),
    originalPointCount: retained.reduce((sum, detail) => sum + detail.originalPoints, 0),
    cleanedPointCount: retained.reduce((sum, detail) => sum + detail.simplifiedPoints.length, 0),
  };
}
