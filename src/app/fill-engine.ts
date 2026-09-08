import type { CenterlinePoint, CenterlineResult } from "./centerline";

export type FillOptions = {
  rowSpacingMm: number;
  stitchLengthMm: number;
  minSpanMm: number;
  underlaySpacingMm: number;
};

export type FillRow = { points: CenterlinePoint[]; color: string };
export type FillBlock = {
  color: string;
  rows: FillRow[];
  underlay: CenterlinePoint[];
  stitches: CenterlinePoint[];
};
export type FillResult = {
  blocks: FillBlock[];
  options: FillOptions;
  stitchCount: number;
  rowCount: number;
  wideMask: Uint8Array;
};

const DEFAULTS: FillOptions = {
  rowSpacingMm: 0.45,
  stitchLengthMm: 3,
  minSpanMm: 6.2,
  underlaySpacingMm: 2,
};

function loadSvg(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Fill rasterization failed.")); };
    image.src = url;
  });
}

function quantizedColor(data: Uint8ClampedArray, width: number, y: number, start: number, end: number) {
  let red = 0, green = 0, blue = 0, count = 0;
  const step = Math.max(1, Math.floor((end - start) / 12));
  for (let x = start; x <= end; x += step) {
    const index = (y * width + x) * 4;
    if (data[index + 3] < 32) continue;
    red += data[index]; green += data[index + 1]; blue += data[index + 2]; count += 1;
  }
  if (!count) return "#000000";
  const quantize = (value: number) => Math.round(value / count / 32) * 32;
  return `#${[quantize(red), quantize(green), quantize(blue)].map((value) => Math.min(255, value).toString(16).padStart(2, "0")).join("")}`;
}

function verticalSpan(data: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  let top = y, bottom = y;
  while (top > 0 && data[((top - 1) * width + x) * 4 + 3] >= 32) top -= 1;
  while (bottom < height - 1 && data[((bottom + 1) * width + x) * 4 + 3] >= 32) bottom += 1;
  return bottom - top + 1;
}

function rowPoints(start: number, end: number, y: number, rasterWidth: number, rasterHeight: number, result: CenterlineResult, options: FillOptions) {
  const [minX, minY, vectorWidth, vectorHeight] = result.viewBox;
  const widthMm = (end - start) * (result.viewBox[2] / rasterWidth) * inferMmPerVector(result);
  const segments = Math.max(1, Math.ceil(widthMm / options.stitchLengthMm));
  const generated: CenterlinePoint[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const ratio = index / segments;
    const pixelX = start + (end - start) * ratio;
    generated.push({ x: minX + (pixelX / Math.max(1, rasterWidth - 1)) * vectorWidth, y: minY + (y / Math.max(1, rasterHeight - 1)) * vectorHeight });
  }
  return generated;
}

function inferMmPerVector(result: CenterlineResult) {
  const ratios = result.paths.map((path) => {
    let length = 0;
    for (let index = 1; index < path.points.length; index += 1) length += Math.hypot(path.points[index].x - path.points[index - 1].x, path.points[index].y - path.points[index - 1].y);
    return length > 0 ? path.lengthMm / length : 0;
  }).filter((value) => value > 0).sort((a, b) => a - b);
  return ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1;
}

export async function generateFillStitches(source: string, centerlines: CenterlineResult | null, input: Partial<FillOptions> = {}): Promise<FillResult | null> {
  if (!centerlines) return null;
  const options = { ...DEFAULTS, ...input };
  const image = await loadSvg(source);
  const canvas = document.createElement("canvas");
  canvas.width = centerlines.rasterWidth; canvas.height = centerlines.rasterHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const mmPerVector = inferMmPerVector(centerlines);
  const mmPerPixel = (centerlines.viewBox[2] / canvas.width) * mmPerVector;
  const rowStep = Math.max(1, Math.round(options.rowSpacingMm / Math.max(mmPerPixel, 0.0001)));
  const minSpanPixels = Math.max(2, Math.round(options.minSpanMm / Math.max(mmPerPixel, 0.0001)));
  const wideMask = new Uint8Array(canvas.width * canvas.height);
  const rows: (FillRow & { start: number; end: number; y: number })[] = [];
  for (let y = Math.floor(rowStep / 2); y < canvas.height; y += rowStep) {
    let start = -1;
    for (let x = 0; x <= canvas.width; x += 1) {
      const opaque = x < canvas.width && pixels[(y * canvas.width + x) * 4 + 3] >= 32;
      if (opaque && start < 0) start = x;
      if ((!opaque || x === canvas.width) && start >= 0) {
        const end = x - 1;
        const midpoint = Math.round((start + end) / 2);
        if (end - start + 1 >= minSpanPixels && verticalSpan(pixels, canvas.width, canvas.height, midpoint, y) >= minSpanPixels) {
          for (let fillY = Math.max(0, y - Math.floor(rowStep / 2)); fillY <= Math.min(canvas.height - 1, y + Math.floor(rowStep / 2)); fillY += 1) {
            wideMask.fill(1, fillY * canvas.width + start, fillY * canvas.width + end + 1);
          }
          const color = quantizedColor(pixels, canvas.width, y, start, end);
          rows.push({ color, points: rowPoints(start, end, y, canvas.width, canvas.height, centerlines, options), start, end, y });
        }
        start = -1;
      }
    }
  }

  const grouped: { color: string; rows: typeof rows }[] = [];
  for (const row of rows) {
    let winner = -1, bestOverlap = 0;
    grouped.forEach((group, index) => {
      const previous = group.rows[group.rows.length - 1];
      if (group.color !== row.color || row.y - previous.y > rowStep * 1.5) return;
      const overlap = Math.min(row.end, previous.end) - Math.max(row.start, previous.start);
      if (overlap > bestOverlap) { bestOverlap = overlap; winner = index; }
    });
    if (winner < 0) grouped.push({ color: row.color, rows: [row] });
    else grouped[winner].rows.push(row);
  }
  const underlayEvery = Math.max(1, Math.round(options.underlaySpacingMm / options.rowSpacingMm));
  const blocks = grouped.map(({ color, rows: colorRows }) => {
    const orientedRows = colorRows.map((row, index) => ({ ...row, points: index % 2 ? [...row.points].reverse() : row.points }));
    const underlay = colorRows.filter((_, index) => index % underlayEvery === 0).flatMap((row, index) => index % 2 ? [...row.points].reverse() : row.points);
    return { color, rows: orientedRows, underlay, stitches: orientedRows.flatMap((row) => row.points) };
  }).filter((block) => block.stitches.length >= 4);

  return { blocks, options, stitchCount: blocks.reduce((sum, block) => sum + block.underlay.length + block.stitches.length, 0), rowCount: rows.length, wideMask };
}

export function pointFallsInFill(result: CenterlineResult, fill: FillResult, point: CenterlinePoint) {
  const [minX, minY, width, height] = result.viewBox;
  const x = Math.round(((point.x - minX) / width) * (result.rasterWidth - 1));
  const y = Math.round(((point.y - minY) / height) * (result.rasterHeight - 1));
  return x >= 0 && y >= 0 && x < result.rasterWidth && y < result.rasterHeight && fill.wideMask[y * result.rasterWidth + x] === 1;
}
