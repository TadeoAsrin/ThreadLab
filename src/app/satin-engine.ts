import type { CenterlinePoint, CenterlineResult } from "./centerline";
import { assessEmbroideryDetails } from "./detail-intelligence";

export type SatinOptions = {
  densityMm: number;
  minWidthMm: number;
  maxWidthMm: number;
  minRungCoverage: number;
  maxWidthVariation: number;
};

export type SatinColumn = {
  sourceIndex: number;
  centerline: CenterlinePoint[];
  stitches: CenterlinePoint[];
  medianWidthMm: number;
  widthVariation: number;
  lengthMm: number;
  rungCount: number;
};

export type SatinResult = {
  columns: SatinColumn[];
  options: SatinOptions;
  stitchCount: number;
  medianWidthMm: number;
  rejected: { removed: number; short: number; width: number; unstable: number };
};

const DEFAULTS: SatinOptions = {
  densityMm: 0.4,
  minWidthMm: 0.8,
  maxWidthMm: 6.2,
  minRungCoverage: 0.68,
  maxWidthVariation: 0.42,
};

const distance = (a: CenterlinePoint, b: CenterlinePoint) => Math.hypot(b.x - a.x, b.y - a.y);

function vectorLength(points: CenterlinePoint[]) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += distance(points[index - 1], points[index]);
  return total;
}

function inferMmPerVector(result: CenterlineResult) {
  const samples = result.paths.map((path) => {
    const vector = vectorLength(path.points);
    return vector > 0 ? path.lengthMm / vector : 0;
  }).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  return samples.length ? samples[Math.floor(samples.length / 2)] : 1;
}

function maskHit(result: CenterlineResult, point: CenterlinePoint) {
  const [minX, minY, width, height] = result.viewBox;
  const px = Math.round(((point.x - minX) / width) * (result.rasterWidth - 1));
  const py = Math.round(((point.y - minY) / height) * (result.rasterHeight - 1));
  if (px < 0 || py < 0 || px >= result.rasterWidth || py >= result.rasterHeight) return false;
  return result.artworkMask[py * result.rasterWidth + px] === 1;
}

function resample(points: CenterlinePoint[], spacing: number) {
  if (points.length < 2 || spacing <= 0) return [...points];
  const output = [points[0]];
  let carry = 0;
  for (let index = 1; index < points.length; index += 1) {
    let from = { ...points[index - 1] };
    const to = points[index];
    let segment = distance(from, to);
    while (segment + carry >= spacing && segment > 0) {
      const ratio = (spacing - carry) / segment;
      from = { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
      output.push(from);
      segment = distance(from, to);
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

function probeEdge(result: CenterlineResult, origin: CenterlinePoint, dx: number, dy: number, step: number, maximum: number) {
  let last = origin;
  for (let offset = step; offset <= maximum; offset += step) {
    const point = { x: origin.x + dx * offset, y: origin.y + dy * offset };
    if (!maskHit(result, point)) break;
    last = point;
  }
  return last;
}

function coefficientOfVariation(values: number[]) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return mean ? Math.sqrt(variance) / mean : 0;
}

export function generateSatinStitches(result: CenterlineResult | null, input: Partial<SatinOptions> = {}): SatinResult | null {
  if (!result?.paths.length) return null;
  const options = { ...DEFAULTS, ...input };
  const intelligence = assessEmbroideryDetails(result);
  const mmPerVector = inferMmPerVector(result);
  const spacingVector = options.densityMm / Math.max(mmPerVector, 0.000001);
  const probeStepVector = 0.12 / Math.max(mmPerVector, 0.000001);
  const maxProbeVector = (options.maxWidthMm / 2 + 0.5) / Math.max(mmPerVector, 0.000001);
  const columns: SatinColumn[] = [];
  const rejected = { removed: 0, short: 0, width: 0, unstable: 0 };

  result.paths.forEach((path, sourceIndex) => {
    const detail = intelligence?.details[sourceIndex];
    if (detail?.decision === "remove") { rejected.removed += 1; return; }
    const sourcePoints = detail?.decision === "simplify" ? detail.simplifiedPoints : path.points;
    const lengthMm = vectorLength(sourcePoints) * mmPerVector;
    if (lengthMm < 3) { rejected.short += 1; return; }
    const centers = resample(sourcePoints, spacingVector);
    if (centers.length < 5) { rejected.short += 1; return; }

    const rungs: { left: CenterlinePoint; right: CenterlinePoint; widthMm: number }[] = [];
    for (let index = 0; index < centers.length; index += 1) {
      const center = centers[index];
      if (!maskHit(result, center)) continue;
      const tangent = unitTangent(centers, index);
      const normal = { x: -tangent.y, y: tangent.x };
      const left = probeEdge(result, center, normal.x, normal.y, probeStepVector, maxProbeVector);
      const right = probeEdge(result, center, -normal.x, -normal.y, probeStepVector, maxProbeVector);
      const widthMm = distance(left, right) * mmPerVector;
      if (widthMm >= options.minWidthMm && widthMm <= options.maxWidthMm) rungs.push({ left, right, widthMm });
    }

    if (rungs.length < Math.max(5, centers.length * options.minRungCoverage)) { rejected.width += 1; return; }
    const widths = rungs.map((rung) => rung.widthMm).sort((a, b) => a - b);
    const medianWidthMm = widths[Math.floor(widths.length / 2)];
    const widthVariation = coefficientOfVariation(widths);
    if (lengthMm / Math.max(medianWidthMm, 0.1) < 2 || widthVariation > options.maxWidthVariation) { rejected.unstable += 1; return; }

    const stitches: CenterlinePoint[] = [];
    rungs.forEach((rung, index) => {
      if (index % 2 === 0) stitches.push(rung.left, rung.right);
      else stitches.push(rung.right, rung.left);
    });
    columns.push({ sourceIndex, centerline: centers, stitches, medianWidthMm, widthVariation, lengthMm, rungCount: rungs.length });
  });

  const widths = columns.map((column) => column.medianWidthMm).sort((a, b) => a - b);
  return {
    columns,
    options,
    stitchCount: columns.reduce((sum, column) => sum + column.stitches.length, 0),
    medianWidthMm: widths.length ? widths[Math.floor(widths.length / 2)] : 0,
    rejected,
  };
}
