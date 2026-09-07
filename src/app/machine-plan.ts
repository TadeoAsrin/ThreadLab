import type { CenterlinePath, CenterlinePoint, CenterlineResult } from "./centerline";

export type MachinePath = CenterlinePath & {
  sourceIndex: number;
  reversed: boolean;
};

export type TravelMove = {
  from: CenterlinePoint;
  to: CenterlinePoint;
  distanceMm: number;
  trim: boolean;
};

export type StitchBridge = {
  from: CenterlinePoint;
  to: CenterlinePoint;
  distanceMm: number;
  reason: "proximity" | "artwork";
  artworkCoverage: number;
};

export type MachinePlan = {
  paths: MachinePath[];
  jumps: TravelMove[];
  bridges: StitchBridge[];
  trimCount: number;
  totalJumpMm: number;
  bridgeThreadMm: number;
  trimThresholdMm: number;
  bridgeThresholdMm: number;
  artworkBridgeMaxMm: number;
  artworkCoverageThreshold: number;
  artworkBridgeCount: number;
  consolidatedBlocks: number;
};

function distance(a: CenterlinePoint, b: CenterlinePoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function reversePath(path: CenterlinePath, sourceIndex: number): MachinePath {
  return { ...path, sourceIndex, reversed: true, points: [...path.points].reverse(), stitches: [...path.stitches].reverse() };
}

function forwardPath(path: CenterlinePath, sourceIndex: number): MachinePath {
  return { ...path, sourceIndex, reversed: false, points: [...path.points], stitches: [...path.stitches] };
}

function firstPoint(path: CenterlinePath) {
  return path.stitches[0] ?? path.points[0];
}

function lastPoint(path: CenterlinePath) {
  return path.stitches[path.stitches.length - 1] ?? path.points[path.points.length - 1];
}

function unitVector(from: CenterlinePoint, to: CenterlinePoint) {
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
  return length > 0 ? { x: dx / length, y: dy / length } : null;
}

function exitDirection(path: CenterlinePath) {
  const points = path.stitches.length >= 2 ? path.stitches : path.points;
  return points.length >= 2 ? unitVector(points[points.length - 2], points[points.length - 1]) : null;
}

function entryDirection(path: CenterlinePath) {
  const points = path.stitches.length >= 2 ? path.stitches : path.points;
  return points.length >= 2 ? unitVector(points[0], points[1]) : null;
}

function bridgeIsCoherent(current: CenterlinePath, next: CenterlinePath) {
  const bridge = unitVector(lastPoint(current), firstPoint(next));
  if (!bridge) return true;
  const outgoing = exitDirection(current), incoming = entryDirection(next), minDot = -0.15;
  const outDot = outgoing ? outgoing.x * bridge.x + outgoing.y * bridge.y : 1;
  const inDot = incoming ? incoming.x * bridge.x + incoming.y * bridge.y : 1;
  return outDot >= minDot && inDot >= minDot;
}

function maskHit(centerlines: CenterlineResult, point: CenterlinePoint, radius = 1) {
  const [minX, minY, width, height] = centerlines.viewBox;
  const px = Math.round(((point.x - minX) / width) * (centerlines.rasterWidth - 1));
  const py = Math.round(((point.y - minY) / height) * (centerlines.rasterHeight - 1));
  for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
    const x = px + dx, y = py + dy;
    if (x < 0 || y < 0 || x >= centerlines.rasterWidth || y >= centerlines.rasterHeight) continue;
    if (centerlines.artworkMask[y * centerlines.rasterWidth + x]) return true;
  }
  return false;
}

function artworkCoverage(centerlines: CenterlineResult, from: CenterlinePoint, to: CenterlinePoint) {
  const pixelDistance = Math.hypot(
    ((to.x - from.x) / centerlines.viewBox[2]) * centerlines.rasterWidth,
    ((to.y - from.y) / centerlines.viewBox[3]) * centerlines.rasterHeight,
  );
  const samples = Math.max(5, Math.ceil(pixelDistance * 1.4));
  let supported = 0;
  for (let step = 0; step <= samples; step += 1) {
    const t = step / samples;
    const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    if (maskHit(centerlines, point, 1)) supported += 1;
  }
  return supported / (samples + 1);
}

export function buildMachinePlan(
  centerlines: CenterlineResult | null,
  targetWidthMm: number,
  vectorWidth: number,
  trimThresholdMm = 3,
  bridgeThresholdMm = 1.25,
  artworkBridgeMaxMm = 3.5,
  artworkCoverageThreshold = 0.72,
): MachinePlan | null {
  if (!centerlines?.paths.length || targetWidthMm <= 0 || vectorWidth <= 0) return null;
  const source = centerlines.paths.filter((path) => firstPoint(path) && lastPoint(path));
  if (!source.length) return null;

  const mmPerVectorUnit = targetWidthMm / vectorWidth;
  const remaining = new Set(source.map((_, index) => index));
  const ordered: MachinePath[] = [], jumps: TravelMove[] = [], bridges: StitchBridge[] = [];
  let firstIndex = 0, firstReverse = false, bestAnchor: CenterlinePoint | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const start = firstPoint(source[index]), end = lastPoint(source[index]);
    for (const [point, reverse] of [[start, false], [end, true]] as const) {
      if (!bestAnchor || point.y < bestAnchor.y || (point.y === bestAnchor.y && point.x < bestAnchor.x)) {
        bestAnchor = point; firstIndex = index; firstReverse = reverse;
      }
    }
  }

  let current = firstReverse ? reversePath(source[firstIndex], firstIndex) : forwardPath(source[firstIndex], firstIndex);
  ordered.push(current); remaining.delete(firstIndex);

  while (remaining.size) {
    const currentEnd = lastPoint(current);
    let bestIndex = -1, reverse = false, bestDistance = Number.POSITIVE_INFINITY;
    for (const index of remaining) {
      const path = source[index], toStart = distance(currentEnd, firstPoint(path)), toEnd = distance(currentEnd, lastPoint(path));
      if (toStart < bestDistance) { bestDistance = toStart; bestIndex = index; reverse = false; }
      if (toEnd < bestDistance) { bestDistance = toEnd; bestIndex = index; reverse = true; }
    }
    if (bestIndex < 0) break;

    const next = reverse ? reversePath(source[bestIndex], bestIndex) : forwardPath(source[bestIndex], bestIndex);
    const nextStart = firstPoint(next), moveMm = bestDistance * mmPerVectorUnit;
    const coherent = bridgeIsCoherent(current, next);
    const coverage = moveMm <= artworkBridgeMaxMm ? artworkCoverage(centerlines, currentEnd, nextStart) : 0;
    const proximityBridge = coherent && moveMm <= bridgeThresholdMm;
    const artworkBridge = coherent && moveMm > bridgeThresholdMm && moveMm <= artworkBridgeMaxMm && coverage >= artworkCoverageThreshold;

    if (proximityBridge || artworkBridge) {
      bridges.push({
        from: currentEnd,
        to: nextStart,
        distanceMm: moveMm,
        reason: artworkBridge ? "artwork" : "proximity",
        artworkCoverage: coverage,
      });
    } else {
      jumps.push({ from: currentEnd, to: nextStart, distanceMm: moveMm, trim: moveMm >= trimThresholdMm });
    }

    ordered.push(next); remaining.delete(bestIndex); current = next;
  }

  return {
    paths: ordered,
    jumps,
    bridges,
    trimCount: jumps.filter((jump) => jump.trim).length,
    totalJumpMm: jumps.reduce((sum, jump) => sum + jump.distanceMm, 0),
    bridgeThreadMm: bridges.reduce((sum, bridge) => sum + bridge.distanceMm, 0),
    trimThresholdMm,
    bridgeThresholdMm,
    artworkBridgeMaxMm,
    artworkCoverageThreshold,
    artworkBridgeCount: bridges.filter((bridge) => bridge.reason === "artwork").length,
    consolidatedBlocks: Math.max(1, ordered.length - bridges.length),
  };
}
