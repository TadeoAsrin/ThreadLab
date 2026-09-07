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
  consolidatedBlocks: number;
};

function distance(a: CenterlinePoint, b: CenterlinePoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function reversePath(path: CenterlinePath, sourceIndex: number): MachinePath {
  return {
    ...path,
    sourceIndex,
    reversed: true,
    points: [...path.points].reverse(),
    stitches: [...path.stitches].reverse(),
  };
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
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length > 0 ? { x: dx / length, y: dy / length } : null;
}

function exitDirection(path: CenterlinePath) {
  const points = path.stitches.length >= 2 ? path.stitches : path.points;
  if (points.length < 2) return null;
  return unitVector(points[points.length - 2], points[points.length - 1]);
}

function entryDirection(path: CenterlinePath) {
  const points = path.stitches.length >= 2 ? path.stitches : path.points;
  if (points.length < 2) return null;
  return unitVector(points[0], points[1]);
}

function bridgeIsCoherent(current: CenterlinePath, next: CenterlinePath) {
  const from = lastPoint(current);
  const to = firstPoint(next);
  const bridge = unitVector(from, to);
  if (!bridge) return true;

  const outgoing = exitDirection(current);
  const incoming = entryDirection(next);
  const minDot = -0.15;
  const outDot = outgoing ? outgoing.x * bridge.x + outgoing.y * bridge.y : 1;
  const inDot = incoming ? incoming.x * bridge.x + incoming.y * bridge.y : 1;
  return outDot >= minDot && inDot >= minDot;
}

export function buildMachinePlan(
  centerlines: CenterlineResult | null,
  targetWidthMm: number,
  vectorWidth: number,
  trimThresholdMm = 3,
  bridgeThresholdMm = 1.25,
): MachinePlan | null {
  if (!centerlines?.paths.length || targetWidthMm <= 0 || vectorWidth <= 0) return null;

  const source = centerlines.paths.filter((path) => firstPoint(path) && lastPoint(path));
  if (!source.length) return null;

  const mmPerVectorUnit = targetWidthMm / vectorWidth;
  const remaining = new Set(source.map((_, index) => index));
  const ordered: MachinePath[] = [];
  const jumps: TravelMove[] = [];
  const bridges: StitchBridge[] = [];

  let firstIndex = 0;
  let firstReverse = false;
  let bestAnchor: CenterlinePoint | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const start = firstPoint(source[index]);
    const end = lastPoint(source[index]);
    for (const [point, reverse] of [[start, false], [end, true]] as const) {
      if (!bestAnchor || point.y < bestAnchor.y || (point.y === bestAnchor.y && point.x < bestAnchor.x)) {
        bestAnchor = point;
        firstIndex = index;
        firstReverse = reverse;
      }
    }
  }

  let current = firstReverse ? reversePath(source[firstIndex], firstIndex) : forwardPath(source[firstIndex], firstIndex);
  ordered.push(current);
  remaining.delete(firstIndex);

  while (remaining.size) {
    const currentEnd = lastPoint(current);
    let bestIndex = -1;
    let reverse = false;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const index of remaining) {
      const path = source[index];
      const toStart = distance(currentEnd, firstPoint(path));
      const toEnd = distance(currentEnd, lastPoint(path));
      if (toStart < bestDistance) {
        bestDistance = toStart;
        bestIndex = index;
        reverse = false;
      }
      if (toEnd < bestDistance) {
        bestDistance = toEnd;
        bestIndex = index;
        reverse = true;
      }
    }

    if (bestIndex < 0) break;
    const next = reverse ? reversePath(source[bestIndex], bestIndex) : forwardPath(source[bestIndex], bestIndex);
    const moveMm = bestDistance * mmPerVectorUnit;

    if (moveMm <= bridgeThresholdMm && bridgeIsCoherent(current, next)) {
      bridges.push({ from: currentEnd, to: firstPoint(next), distanceMm: moveMm });
    } else {
      jumps.push({
        from: currentEnd,
        to: firstPoint(next),
        distanceMm: moveMm,
        trim: moveMm >= trimThresholdMm,
      });
    }

    ordered.push(next);
    remaining.delete(bestIndex);
    current = next;
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
    consolidatedBlocks: Math.max(1, ordered.length - bridges.length),
  };
}
