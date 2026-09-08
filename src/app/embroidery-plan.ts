import type { CenterlinePoint, CenterlineResult } from "./centerline";
import type { FillResult } from "./fill-engine";
import { pointFallsInFill } from "./fill-engine";
import type { SatinResult } from "./satin-engine";

export type StitchKind = "running" | "bean" | "satin" | "fill-underlay" | "fill";
export type EmbroideryBlock = { id: string; kind: StitchKind; color: string; points: CenterlinePoint[]; groupId?: string; sequence?: number };
export type EmbroideryCommand = { type: "stitch" | "jump" | "color" | "end"; x: number; y: number; color?: string; trim?: boolean };
export type Hoop = { name: "100 × 100" | "130 × 180"; widthMm: number; heightMm: number };
export type SafetyCheck = { level: "pass" | "warning" | "block"; message: string };
export type EmbroideryPlan = {
  blocks: EmbroideryBlock[];
  commands: EmbroideryCommand[];
  colors: string[];
  hoop: Hoop | null;
  checks: SafetyCheck[];
  safeToExport: boolean;
  stitchCount: number;
  jumpCount: number;
  trimCount: number;
  colorChanges: number;
  widthMm: number;
  heightMm: number;
  estimatedMinutes: number;
  subdividedStitches: number;
};

const distance = (a: CenterlinePoint, b: CenterlinePoint) => Math.hypot(b.x - a.x, b.y - a.y);
const first = (block: EmbroideryBlock) => block.points[0];
const last = (block: EmbroideryBlock) => block.points[block.points.length - 1];

function subdivideLongSegments(points: CenterlinePoint[], maximumMm = 6.5) {
  if (points.length < 2) return { points, added: 0 };
  const output = [points[0]];
  let added = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1], to = points[index], length = distance(from, to);
    const parts = Math.max(1, Math.ceil(length / maximumMm));
    for (let part = 1; part <= parts; part += 1) output.push({ x: from.x + (to.x - from.x) * (part / parts), y: from.y + (to.y - from.y) * (part / parts) });
    added += parts - 1;
  }
  return { points: output, added };
}

function toMm(point: CenterlinePoint, result: CenterlineResult, targetWidthMm: number): CenterlinePoint {
  const [minX, minY, width, height] = result.viewBox;
  const targetHeight = targetWidthMm * height / width;
  return { x: ((point.x - minX) / width) * targetWidthMm - targetWidthMm / 2, y: ((point.y - minY) / height) * targetHeight - targetHeight / 2 };
}

function bean(points: CenterlinePoint[]) {
  if (points.length < 2) return points;
  const output = [points[0]];
  for (let index = 1; index < points.length; index += 1) output.push(points[index], points[index - 1], points[index]);
  return output;
}

function nearestOrder(blocks: EmbroideryBlock[]) {
  if (!blocks.length) return [];
  const units = new Map<string, EmbroideryBlock[]>();
  for (const block of blocks) units.set(block.groupId ?? block.id, [...(units.get(block.groupId ?? block.id) ?? []), block]);
  const byColor = new Map<string, EmbroideryBlock[][]>();
  for (const unit of units.values()) {
    unit.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    byColor.set(unit[0].color, [...(byColor.get(unit[0].color) ?? []), unit]);
  }
  const ordered: EmbroideryBlock[] = [];
  let cursor: CenterlinePoint = { x: 0, y: 0 };
  for (const colorUnits of byColor.values()) {
    const remaining = [...colorUnits];
    while (remaining.length) {
      let winner = 0, reverse = false, best = Infinity;
      remaining.forEach((unit, index) => {
        const block = unit[0];
        const forward = distance(cursor, first(block)), backward = unit.length === 1 ? distance(cursor, last(block)) : Infinity;
        if (forward < best) { winner = index; reverse = false; best = forward; }
        if (block.kind !== "fill" && backward < best) { winner = index; reverse = true; best = backward; }
      });
      const chosen = remaining.splice(winner, 1)[0];
      if (reverse) chosen[0] = { ...chosen[0], points: [...chosen[0].points].reverse() };
      ordered.push(...chosen); cursor = last(chosen[chosen.length - 1]);
    }
  }
  return ordered;
}

function chooseHoop(widthMm: number, heightMm: number): Hoop | null {
  if (widthMm <= 98 && heightMm <= 98) return { name: "100 × 100", widthMm: 100, heightMm: 100 };
  if (widthMm <= 128 && heightMm <= 178) return { name: "130 × 180", widthMm: 130, heightMm: 180 };
  return null;
}

export function buildEmbroideryPlan(centerlines: CenterlineResult | null, satin: SatinResult | null, fill: FillResult | null, targetWidthMm: number, stitchMode: "running" | "bean"): EmbroideryPlan | null {
  if (!centerlines) return null;
  const satinSources = new Set(satin?.columns.map((column) => column.sourceIndex) ?? []);
  const blocks: EmbroideryBlock[] = [];
  centerlines.paths.forEach((path, index) => {
    if (satinSources.has(index)) return;
    if (fill && path.points.filter((point) => pointFallsInFill(centerlines, fill, point)).length / Math.max(1, path.points.length) > 0.45) return;
    const converted = path.stitches.map((point) => toMm(point, centerlines, targetWidthMm));
    blocks.push({ id: `running-${index}`, kind: stitchMode, color: "#000000", points: stitchMode === "bean" ? bean(converted) : converted });
  });
  satin?.columns.forEach((column, index) => blocks.push({ id: `satin-${index}`, kind: "satin", color: "#000000", points: column.stitches.map((point) => toMm(point, centerlines, targetWidthMm)) }));
  fill?.blocks.forEach((block, index) => {
    const groupId = `fill-group-${index}`;
    if (block.underlay.length) blocks.push({ id: `underlay-${index}`, groupId, sequence: 0, kind: "fill-underlay", color: block.color, points: block.underlay.map((point) => toMm(point, centerlines, targetWidthMm)) });
    blocks.push({ id: `fill-${index}`, groupId, sequence: 1, kind: "fill", color: block.color, points: block.stitches.map((point) => toMm(point, centerlines, targetWidthMm)) });
  });
  let subdividedStitches = 0;
  const ordered = nearestOrder(blocks.filter((block) => block.points.length >= 2)).map((block) => {
    const safe = subdivideLongSegments(block.points);
    subdividedStitches += safe.added;
    return { ...block, points: safe.points };
  });
  const commands: EmbroideryCommand[] = [];
  let cursor: CenterlinePoint = { x: 0, y: 0 }, activeColor = "";
  for (const block of ordered) {
    if (activeColor && activeColor !== block.color) commands.push({ type: "color", x: cursor.x, y: cursor.y, color: block.color });
    activeColor = block.color;
    const gap = distance(cursor, first(block));
    if (gap > 0.1) commands.push({ type: "jump", x: first(block).x, y: first(block).y, trim: gap >= 3 });
    for (const point of block.points) commands.push({ type: "stitch", x: point.x, y: point.y, color: block.color });
    cursor = last(block);
  }
  commands.push({ type: "end", x: cursor.x, y: cursor.y });
  const stitchCommands = commands.filter((command) => command.type === "stitch");
  let maxStitch = 0, previous: CenterlinePoint | null = null, invalid = false;
  for (const command of commands) {
    if (!Number.isFinite(command.x) || !Number.isFinite(command.y)) invalid = true;
    if (command.type === "stitch" && previous) maxStitch = Math.max(maxStitch, distance(previous, command));
    if (command.type === "stitch" || command.type === "jump") previous = command;
  }
  const targetHeightMm = targetWidthMm * centerlines.viewBox[3] / centerlines.viewBox[2];
  const hoop = chooseHoop(targetWidthMm, targetHeightMm);
  const checks: SafetyCheck[] = [
    { level: hoop ? "pass" : "block", message: hoop ? `Fits the ${hoop.name} mm hoop with a 1 mm margin.` : "Design exceeds the safe area of the 130 × 180 mm hoop." },
    { level: invalid ? "block" : "pass", message: invalid ? "Invalid machine coordinates were found." : "All machine coordinates are finite." },
    { level: maxStitch > 7 ? "block" : "pass", message: maxStitch > 7 ? `A ${maxStitch.toFixed(1)} mm stitch exceeds the 7 mm safety limit.` : `Longest stitch is ${maxStitch.toFixed(1)} mm.` },
    { level: "pass", message: subdividedStitches ? `${subdividedStitches} long movements were safely subdivided.` : "No long movements needed subdivision." },
    { level: stitchCommands.length > 100000 ? "block" : stitchCommands.length > 60000 ? "warning" : "pass", message: `${stitchCommands.length.toLocaleString()} needle points in the plan.` },
    { level: ordered.length ? "pass" : "block", message: ordered.length ? `${ordered.length} stitch blocks are ready.` : "No stitch blocks were generated." },
  ];
  const colors = [...new Set(ordered.map((block) => block.color))];
  return {
    blocks: ordered, commands, colors, hoop, checks,
    safeToExport: !checks.some((check) => check.level === "block"),
    stitchCount: stitchCommands.length,
    jumpCount: commands.filter((command) => command.type === "jump").length,
    trimCount: commands.filter((command) => command.type === "jump" && command.trim).length,
    colorChanges: Math.max(0, colors.length - 1),
    widthMm: targetWidthMm, heightMm: targetHeightMm,
    estimatedMinutes: stitchCommands.length / 650 + commands.filter((command) => command.type === "jump").length * 0.04,
    subdividedStitches,
  };
}
