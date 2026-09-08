import type { EmbroideryCommand, EmbroideryPlan } from "./embroidery-plan";

// PEC/PES encoding follows the MIT-licensed pyembroidery writer semantics.
const BROTHER_PALETTE = [
  [14,31,124],[10,85,163],[0,135,119],[75,107,175],[237,23,31],[209,92,0],[145,54,151],[228,154,203],
  [145,95,172],[158,214,125],[232,169,0],[254,186,53],[255,255,0],[112,188,31],[186,152,0],[168,168,168],
  [125,111,0],[255,255,179],[79,85,86],[0,0,0],[11,61,145],[119,1,118],[41,49,51],[42,19,1],
  [246,74,138],[178,118,36],[252,187,197],[254,55,15],[240,240,240],[106,28,138],[168,221,196],[37,132,187],
  [254,179,67],[255,243,107],[208,166,96],[209,84,0],[102,186,73],[19,74,70],[135,135,135],[216,204,198],
  [67,86,7],[253,217,222],[249,147,188],[0,56,34],[178,175,212],[104,106,176],[239,227,185],[247,56,102],
  [181,75,100],[19,43,26],[199,1,86],[254,158,50],[168,222,235],[0,103,62],[78,41,144],[47,126,32],
  [255,204,204],[255,217,17],[9,91,166],[240,249,112],[227,243,91],[255,153,0],[255,240,141],[255,200,200],
] as const;

class Bytes {
  data: number[] = [];
  byte(value: number) { this.data.push(value & 0xff); }
  bytes(values: Iterable<number>) { for (const value of values) this.byte(value); }
  ascii(value: string) { this.bytes(new TextEncoder().encode(value)); }
  u16(value: number) { this.byte(value); this.byte(value >> 8); }
  u24(value: number) { this.byte(value); this.byte(value >> 8); this.byte(value >> 16); }
  patchU24(index: number, value: number) { this.data[index] = value & 0xff; this.data[index + 1] = (value >> 8) & 0xff; this.data[index + 2] = (value >> 16) & 0xff; }
}

function rgb(color: string) {
  const normalized = /^#[0-9a-f]{6}$/i.test(color) ? color : "#000000";
  return [1, 3, 5].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16));
}

function paletteIndex(color: string) {
  const [red, green, blue] = rgb(color);
  let winner = 20, best = Infinity;
  BROTHER_PALETTE.forEach((candidate, index) => {
    const score = (candidate[0] - red) ** 2 + (candidate[1] - green) ** 2 + (candidate[2] - blue) ** 2;
    if (score < best) { best = score; winner = index + 1; }
  });
  return winner;
}

function writeValue(output: Bytes, value: number, long = false, flag = 0) {
  const rounded = Math.round(value);
  if (!long && rounded > -64 && rounded < 63) output.byte(rounded & 0x7f);
  else {
    const encoded = (rounded & 0x0fff) | 0x8000 | (flag << 8);
    output.byte(encoded >> 8); output.byte(encoded);
  }
}

function splitMove(fromX: number, fromY: number, toX: number, toY: number, limit: number) {
  const dx = toX - fromX, dy = toY - fromY;
  const count = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / limit));
  return Array.from({ length: count }, (_, index) => ({
    x: Math.round(fromX + dx * ((index + 1) / count)),
    y: Math.round(fromY + dy * ((index + 1) / count)),
  }));
}

function encodeCommands(output: Bytes, commands: EmbroideryCommand[]) {
  let x = 0, y = 0, jumping = true, initial = true, alternate = true;
  for (const command of commands) {
    const targetX = Math.round(command.x * 10), targetY = Math.round(command.y * 10);
    if (command.type === "stitch") {
      if (jumping) {
        if (targetX !== x && targetY !== y) { writeValue(output, 0); writeValue(output, 0); }
        jumping = false;
      }
      for (const point of splitMove(x, y, targetX, targetY, 70)) {
        writeValue(output, point.x - x); writeValue(output, point.y - y); x = point.x; y = point.y;
      }
    } else if (command.type === "jump") {
      jumping = true;
      for (const point of splitMove(x, y, targetX, targetY, 1800)) {
        const flag = initial || !command.trim ? 0x10 : 0x20;
        writeValue(output, point.x - x, true, flag);
        writeValue(output, point.y - y, true, flag);
        x = point.x; y = point.y; initial = false;
      }
    } else if (command.type === "color") {
      if (jumping) { writeValue(output, 0); writeValue(output, 0); jumping = false; }
      output.bytes([0xfe, 0xb0, alternate ? 0x02 : 0x01]); alternate = !alternate;
    } else if (command.type === "end") output.byte(0xff);
    initial = false;
  }
  if (output.data[output.data.length - 1] !== 0xff) output.byte(0xff);
}

function previewGraphic(plan: EmbroideryPlan, color?: string) {
  const graphic = Array(48 * 38 / 8).fill(0);
  const scale = Math.min(43 / Math.max(1, plan.widthMm), 33 / Math.max(1, plan.heightMm));
  for (const command of plan.commands) {
    if (command.type !== "stitch" || (color && command.color !== color)) continue;
    const x = Math.floor(command.x * scale + 24), y = Math.floor(command.y * scale + 19);
    if (x < 0 || y < 0 || x >= 48 || y >= 38) continue;
    graphic[y * 6 + Math.floor(x / 8)] |= 1 << (x % 8);
  }
  return graphic;
}

function writePec(plan: EmbroideryPlan, name: string) {
  const output = new Bytes();
  output.ascii(`LA:${name.slice(0, 8).padEnd(16, " ")}\r`);
  output.bytes([...Array(12).fill(0x20), 0xff, 0x00, 0x06, 0x26]);
  const indices = plan.colors.map(paletteIndex);
  output.bytes(Array(12).fill(0x20));
  output.byte(Math.max(0, indices.length - 1)); output.bytes(indices);
  output.bytes(Array(Math.max(0, 463 - indices.length)).fill(0x20));

  const blockStart = output.data.length;
  output.bytes([0, 0]); const lengthOffset = output.data.length; output.u24(0);
  output.bytes([0x31, 0xff, 0xf0]);
  output.u16(Math.round(plan.widthMm * 10)); output.u16(Math.round(plan.heightMm * 10));
  output.u16(0x1e0); output.u16(0x1b0);
  encodeCommands(output, plan.commands);
  output.patchU24(lengthOffset, output.data.length - blockStart);
  output.bytes(previewGraphic(plan));
  for (const color of plan.colors) output.bytes(previewGraphic(plan, color));
  return output.data;
}

export function writePes(plan: EmbroideryPlan, name = "ThreadLab") {
  if (!plan.safeToExport) throw new Error("The safety gate blocked PES export.");
  const output = new Bytes();
  output.ascii("#PES0001");
  output.bytes([0x16, 0x00, 0x00, 0x00, ...Array(10).fill(0)]);
  output.bytes(writePec(plan, name));
  return new Blob([new Uint8Array(output.data)], { type: "application/octet-stream" });
}

export function downloadPes(plan: EmbroideryPlan, sourceName: string) {
  const base = sourceName.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 40) || "threadlab";
  const url = URL.createObjectURL(writePes(plan, base));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${base}.pes`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
