import type { CenterlinePoint, CenterlineResult } from "./centerline";

export type SatinColumn = {
  sourceIndex: number;
  centerline: CenterlinePoint[];
  stitches: CenterlinePoint[];
  medianWidthMm: number;
  lengthMm: number;
  rungCount: number;
};

export type SatinResult = {
  columns: SatinColumn[];
  densityMm: number;
  stitchCount: number;
  medianWidthMm: number;
};

function distance(a: CenterlinePoint, b: CenterlinePoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function vectorLength(points: CenterlinePoint[]) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1], points[i]);
  return total;
}

function inferMmPerVector(result: CenterlineResult) {
  const samples = result.paths
    .map((path) => {
      const vector = vectorLength(path.points);
      return vector > 0 ? path.lengthMm / vector : 0;
    })
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  return samples.length ? samples[Math.floor(samples.length / 2)] : 1;
}

function maskHit(result: CenterlineResult, point: CenterlinePoint) {
  const [minX, minY, width, height] = result.viewBox;
  const px = Math.round(((point.x - minX) / width) * (result.rasterWidth - 1));
  const py = Math.round(((point.y - minY) / height) * (result.rasterHeight - 1));
  if (px < 0 || py < 0 || px >= result.rasterWidth || py >= result.rasterHeight) return false;
  return result.artworkMask[py * result.rasterWidth + px] === 1;
}

function resample(points: CenterlinePoint[], spacingVector: number) {
  if (points.length < 2 || spacingVector <= 0) return [...points];
  const output: CenterlinePoint[] = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i += 1) {
    let ax = points[i - 1].x;
    let ay = points[i - 1].y;
    const bx = points[i].x;
    const by = points[i].y;
    let segment = Math.hypot(bx - ax, by - ay);
    while (segment + carry >= spacingVector && segment > 0) {
      const needed = spacingVector - carry;
      const t = needed / segment;
      ax += (bx - ax) * t;
      ay += (by - ay) * t;
      output.push({ x: ax, y: ay });
      segment = Math.hypot(bx - ax, by - ay);
      carry = 0;
    }
    carry += segment;
  }
  return output;
}

function unitTangent(points: CenterlinePoint[], index: number) {
  const before = points[Math.max(0, index - 1)];
  const after = points[Math.min(points.length - 1, index + 1)];
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

function probeEdge(result: CenterlineResult, origin: CenterlinePoint, dx: number, dy: number, stepVector: number, maxVector: number) {
  let last = origin;
  for (let d = stepVector; d <= maxVector; d += stepVector) {
    const point = { x: origin.x + dx * d, y: origin.y + dy * d };
    if (!maskHit(result, point)) break;
    last = point;
  }
  return last;
}

export function generateSatinStitches(result: CenterlineResult | null, densityMm = 0.4): SatinResult | null {
  if (!result?.paths.length) return null;
  const mmPerVector = inferMmPerVector(result);
  const spacingVector = densityMm / Math.max(mmPerVector, 0.000001);
  const probeStepVector = 0.15 / Math.max(mmPerVector, 0.000001);
  const maxProbeVector = 4 / Math.max(mmPerVector, 0.000001);
  const columns: SatinColumn[] = [];

  result.paths.forEach((path, sourceIndex) => {
    if (path.lengthMm < 3) return;
    const centers = resample(path.points, spacingVector);
    if (centers.length < 5) return;
    const rungs: { left: CenterlinePoint; right: CenterlinePoint; widthMm: number }[] = [];
    for (let i = 0; i < centers.length; i += 1) {
      const center = centers[i];
      if (!maskHit(result, center)) continue;
      const tangent = unitTangent(centers, i);
      const normal = { x: -tangent.y, y: tangent.x };
      const left = probeEdge(result, center, normal.x, normal.y, probeStepVector, maxProbeVector);
      const right = probeEdge(result, center, -normal.x, -normal.y, probeStepVector, maxProbeVector);
      const widthMm = distance(left, right) * mmPerVector;
      if (widthMm >= 0.8 && widthMm <= 6.2) rungs.push({ left, right, widthMm });
    }
    if (rungs.length < Math.max(5, centers.length * 0.6)) return;
    const widths = rungs.map((rung) => rung.widthMm).sort((a, b) => a - b);
    const medianWidthMm = widths[Math.floor(widths.length / 2)];
    if (path.lengthMm / Math.max(medianWidthMm, 0.1) < 2) return;
    const stitches: CenterlinePoint[] = [];
    rungs.forEach((rung, index) => {
      if (index % 2 === 0) stitches.push(rung.left, rung.right);
      else stitches.push(rung.right, rung.left);
    });
    columns.push({ sourceIndex, centerline: centers, stitches, medianWidthMm, lengthMm: path.lengthMm, rungCount: rungs.length });
  });

  const widths = columns.map((column) => column.medianWidthMm).sort((a, b) => a - b);
  return {
    columns,
    densityMm,
    stitchCount: columns.reduce((sum, column) => sum + column.stitches.length, 0),
    medianWidthMm: widths.length ? widths[Math.floor(widths.length / 2)] : 0,
  };
}
