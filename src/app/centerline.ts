export type CenterlinePoint = { x: number; y: number };

export type CenterlinePath = {
  points: CenterlinePoint[];
  stitches: CenterlinePoint[];
  lengthMm: number;
  sourceElement: number | null;
};

export type CenterlineResult = {
  paths: CenterlinePath[];
  stitchLengthMm: number;
  stitchCount: number;
  totalLengthMm: number;
  rasterWidth: number;
  rasterHeight: number;
  rawPathCount: number;
  prunedPathCount: number;
  mergedPathCount: number;
  sourceElementCount: number;
  artworkMask: Uint8Array;
  viewBox: [number, number, number, number];
};

type Pixel = { x: number; y: number };

const key = (x: number, y: number) => `${x},${y}`;

function neighbors(x: number, y: number, width: number, height: number) {
  const result: Pixel[] = [];
  for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < width && ny < height) result.push({ x: nx, y: ny });
  }
  return result;
}

function transitions(values: number[]) {
  let count = 0;
  for (let i = 0; i < values.length; i += 1) if (values[i] === 0 && values[(i + 1) % values.length] === 1) count += 1;
  return count;
}

function thin(binary: Uint8Array, width: number, height: number) {
  const at = (x: number, y: number) => binary[y * width + x];
  let changed = true, loops = 0;
  while (changed && loops < 80) {
    changed = false; loops += 1;
    for (const phase of [0, 1]) {
      const remove: number[] = [];
      for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
        if (!at(x, y)) continue;
        const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1);
        const p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
        const ring = [p2, p3, p4, p5, p6, p7, p8, p9];
        const count = ring.reduce((sum, value) => sum + value, 0);
        if (count < 2 || count > 6 || transitions(ring) !== 1) continue;
        const keepTopology = phase === 0 ? p2 * p4 * p6 === 0 && p4 * p6 * p8 === 0 : p2 * p4 * p8 === 0 && p2 * p6 * p8 === 0;
        if (keepTopology) remove.push(y * width + x);
      }
      if (remove.length) changed = true;
      for (const index of remove) binary[index] = 0;
    }
  }
  return binary;
}

function traceSkeleton(binary: Uint8Array, width: number, height: number) {
  const points = new Map<string, Pixel>(), adjacent = new Map<string, string[]>();
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!binary[y * width + x]) continue;
    const id = key(x, y);
    points.set(id, { x, y });
    adjacent.set(id, neighbors(x, y, width, height).filter((p) => binary[p.y * width + p.x]).map((p) => key(p.x, p.y)));
  }
  const used = new Set<string>();
  const edgeKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
  const paths: Pixel[][] = [];
  function walk(start: string, next: string) {
    const path = [points.get(start)!, points.get(next)!];
    used.add(edgeKey(start, next));
    let previous = start, current = next;
    while ((adjacent.get(current)?.length ?? 0) === 2) {
      const options = adjacent.get(current) ?? [], candidate = options[0] === previous ? options[1] : options[0];
      if (!candidate || used.has(edgeKey(current, candidate))) break;
      used.add(edgeKey(current, candidate)); path.push(points.get(candidate)!); previous = current; current = candidate;
    }
    return path;
  }
  for (const [id, list] of adjacent) {
    if (list.length === 2) continue;
    for (const next of list) {
      if (used.has(edgeKey(id, next))) continue;
      const path = walk(id, next); if (path.length >= 3) paths.push(path);
    }
  }
  for (const [id, list] of adjacent) for (const next of list) {
    if (used.has(edgeKey(id, next))) continue;
    const path = walk(id, next); if (path.length >= 3) paths.push(path);
  }
  return paths;
}

function pathLength(points: CenterlinePoint[]) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return total;
}

function pixelPathLength(points: Pixel[], mmPerPixel: number) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y) * mmPerPixel;
  return total;
}

function pruneShortTerminalBranches(paths: Pixel[][], mmPerPixel: number, thresholdMm = 2.0) {
  const endpointUses = new Map<string, number>();
  for (const path of paths) {
    const first = key(path[0].x, path[0].y), lastPoint = path[path.length - 1], last = key(lastPoint.x, lastPoint.y);
    endpointUses.set(first, (endpointUses.get(first) ?? 0) + 1); endpointUses.set(last, (endpointUses.get(last) ?? 0) + 1);
  }
  return paths.filter((path) => {
    const first = key(path[0].x, path[0].y), lastPoint = path[path.length - 1], last = key(lastPoint.x, lastPoint.y);
    const firstDegree = endpointUses.get(first) ?? 0, lastDegree = endpointUses.get(last) ?? 0;
    const terminal = (firstDegree === 1 && lastDegree >= 3) || (lastDegree === 1 && firstDegree >= 3);
    return !terminal || pixelPathLength(path, mmPerPixel) >= thresholdMm;
  });
}

function pointSegmentDistance(point: CenterlinePoint, a: CenterlinePoint, b: CenterlinePoint) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function simplify(points: CenterlinePoint[], tolerance: number): CenterlinePoint[] {
  if (points.length <= 2) return points;
  const first = points[0], last = points[points.length - 1];
  let maxDistance = 0, index = -1;
  for (let i = 1; i < points.length - 1; i += 1) {
    const value = pointSegmentDistance(points[i], first, last);
    if (value > maxDistance) { maxDistance = value; index = i; }
  }
  if (maxDistance <= tolerance || index < 0) return [first, last];
  const left = simplify(points.slice(0, index + 1), tolerance), right = simplify(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

function endpointDirection(points: CenterlinePoint[], fromStart: boolean) {
  if (points.length < 2) return { x: 0, y: 0 };
  const a = fromStart ? points[0] : points[points.length - 1];
  const b = fromStart ? points[Math.min(2, points.length - 1)] : points[Math.max(0, points.length - 3)];
  const dx = a.x - b.x, dy = a.y - b.y, length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

function orientedPath(points: CenterlinePoint[], endpoint: "start" | "end", placeEndpointAtEnd: boolean) {
  return (endpoint === "start") === placeEndpointAtEnd ? [...points].reverse() : [...points];
}

function mergeNearbyContinuations(paths: CenterlinePoint[][], maxGapMm = 0.7, minAlignment = 0.72) {
  const working = paths.map((path) => [...path]);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < working.length; i += 1) for (let j = i + 1; j < working.length; j += 1) {
      const candidates = [["start", "start"], ["start", "end"], ["end", "start"], ["end", "end"]] as const;
      for (const [aEnd, bEnd] of candidates) {
        const aPoint = aEnd === "start" ? working[i][0] : working[i][working[i].length - 1];
        const bPoint = bEnd === "start" ? working[j][0] : working[j][working[j].length - 1];
        const gap = Math.hypot(aPoint.x - bPoint.x, aPoint.y - bPoint.y);
        if (gap > maxGapMm) continue;
        const aDirection = endpointDirection(working[i], aEnd === "start"), bDirection = endpointDirection(working[j], bEnd === "start");
        if (-(aDirection.x * bDirection.x + aDirection.y * bDirection.y) < minAlignment) continue;
        const left = orientedPath(working[i], aEnd, true), right = orientedPath(working[j], bEnd, false);
        working[i] = gap > 0.12 ? [...left, bPoint, ...right.slice(1)] : [...left, ...right.slice(1)];
        working.splice(j, 1); merged = true; break outer;
      }
    }
  }
  return working;
}

function resample(points: CenterlinePoint[], spacing: number) {
  if (points.length < 2) return points;
  const result = [points[0]]; let carry = 0;
  for (let i = 1; i < points.length; i += 1) {
    let ax = points[i - 1].x, ay = points[i - 1].y;
    const bx = points[i].x, by = points[i].y;
    let segment = Math.hypot(bx - ax, by - ay);
    while (segment + carry >= spacing && segment > 0) {
      const needed = spacing - carry, t = needed / segment;
      ax += (bx - ax) * t; ay += (by - ay) * t; result.push({ x: ax, y: ay }); segment = Math.hypot(bx - ax, by - ay); carry = 0;
    }
    carry += segment;
  }
  const last = points[points.length - 1], tail = result[result.length - 1];
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > spacing * 0.35) result.push(last);
  return result;
}

function loadSvgImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const blob = new Blob([source], { type: "image/svg+xml" }), url = URL.createObjectURL(blob), image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Centerline rasterization failed.")); };
    image.src = url;
  });
}

const SOURCE_GEOMETRY_SELECTOR = "path,rect,circle,ellipse,line,polyline,polygon";

async function renderSourceElementMasks(source: string, width: number, height: number) {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  const sourceElements = [...parsed.querySelectorAll(SOURCE_GEOMETRY_SELECTOR)];
  // Isolated rasterization is intentionally bounded. Large documents keep the
  // global fallback rather than spawning hundreds of browser image decodes.
  if (!sourceElements.length || sourceElements.length > 64) return { masks: [] as Uint8Array[], count: sourceElements.length };
  const masks: Uint8Array[] = [];
  for (let sourceIndex = 0; sourceIndex < sourceElements.length; sourceIndex += 1) {
    const clone = parsed.documentElement.cloneNode(true) as Element;
    const elements = [...clone.querySelectorAll(SOURCE_GEOMETRY_SELECTOR)];
    elements.forEach((element, index) => {
      const existing = element.getAttribute("style") ?? "";
      element.setAttribute("style", `${existing};visibility:${index === sourceIndex ? "visible" : "hidden"}!important`);
    });
    const isolated = new XMLSerializer().serializeToString(clone);
    const canvas = window.document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const mask = new Uint8Array(width * height);
    if (context) {
      try {
        const image = await loadSvgImage(isolated);
        context.drawImage(image, 0, 0, width, height);
        const rgba = context.getImageData(0, 0, width, height).data;
        for (let index = 0; index < mask.length; index += 1) mask[index] = rgba[index * 4 + 3] > 48 ? 1 : 0;
      } catch {
        // Preserve the source index with an empty mask; global extraction still works.
      }
    }
    masks.push(mask);
  }
  return { masks, count: sourceElements.length };
}

function identifySourceElement(points: CenterlinePoint[], masks: Uint8Array[], width: number, height: number, mmPerPixelX: number, mmPerPixelY: number) {
  if (!masks.length) return null;
  const scores = new Array(masks.length).fill(0);
  const stride = Math.max(1, Math.floor(points.length / 24));
  for (let pointIndex = 0; pointIndex < points.length; pointIndex += stride) {
    const point = points[pointIndex];
    const x = Math.max(0, Math.min(width - 1, Math.floor(point.x / mmPerPixelX)));
    const y = Math.max(0, Math.min(height - 1, Math.floor(point.y / mmPerPixelY)));
    masks.forEach((mask, sourceIndex) => {
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const sampleX = x + dx, sampleY = y + dy;
        if (sampleX >= 0 && sampleY >= 0 && sampleX < width && sampleY < height && mask[sampleY * width + sampleX]) { hit = true; break; }
      }
      if (hit) scores[sourceIndex] += 1;
    });
  }
  let winner = -1, best = 0;
  scores.forEach((score, index) => { if (score > best) { best = score; winner = index; } });
  return winner >= 0 ? winner : null;
}

export async function extractCenterlines(source: string, targetWidthMm: number, stitchLengthMm = 2.5): Promise<CenterlineResult> {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml"), svg = parsed.documentElement;
  const rawViewBox = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const minX = rawViewBox?.[0] ?? 0, minY = rawViewBox?.[1] ?? 0;
  const vectorWidth = rawViewBox?.[2] || Number.parseFloat(svg.getAttribute("width") ?? "") || 1;
  const vectorHeight = rawViewBox?.[3] || Number.parseFloat(svg.getAttribute("height") ?? "") || vectorWidth;
  const viewBox: [number, number, number, number] = [minX, minY, vectorWidth, vectorHeight];
  const aspect = vectorWidth / Math.max(vectorHeight, 0.001), targetHeightMm = targetWidthMm / aspect;
  const rasterWidth = Math.min(640, Math.max(180, Math.round(targetWidthMm * 5))), rasterHeight = Math.max(1, Math.round(rasterWidth / aspect));
  const canvas = window.document.createElement("canvas"); canvas.width = rasterWidth; canvas.height = rasterHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Centerline canvas is unavailable.");
  const image = await loadSvgImage(source); context.clearRect(0, 0, rasterWidth, rasterHeight); context.drawImage(image, 0, 0, rasterWidth, rasterHeight);
  const rgba = context.getImageData(0, 0, rasterWidth, rasterHeight).data;
  const artworkMask = new Uint8Array(rasterWidth * rasterHeight);
  for (let i = 0; i < artworkMask.length; i += 1) artworkMask[i] = rgba[i * 4 + 3] > 72 ? 1 : 0;
  const binary = artworkMask.slice();
  thin(binary, rasterWidth, rasterHeight);
  const rawPixelPaths = traceSkeleton(binary, rasterWidth, rasterHeight);
  const mmPerPixelX = targetWidthMm / rasterWidth, mmPerPixelY = targetHeightMm / rasterHeight, averageMmPerPixel = (mmPerPixelX + mmPerPixelY) / 2;
  const prunedPixelPaths = pruneShortTerminalBranches(rawPixelPaths, averageMmPerPixel);
  const mmPaths = prunedPixelPaths.map((pixels) => pixels.map((p) => ({ x: (p.x + 0.5) * mmPerPixelX, y: (p.y + 0.5) * mmPerPixelY }))).filter((points) => pathLength(points) >= 1.2).map((points) => simplify(points, 0.16));
  const sourceGeometry = await renderSourceElementMasks(source, rasterWidth, rasterHeight);
  const taggedPaths = mmPaths.map((points) => ({ points, sourceElement: identifySourceElement(points, sourceGeometry.masks, rasterWidth, rasterHeight, mmPerPixelX, mmPerPixelY) }));
  const sourceGroups = new Map<string, typeof taggedPaths>();
  taggedPaths.forEach((path, index) => {
    const groupKey = path.sourceElement === null ? `unknown-${index}` : `source-${path.sourceElement}`;
    sourceGroups.set(groupKey, [...(sourceGroups.get(groupKey) ?? []), path]);
  });
  const cleanedMmPaths = [...sourceGroups.values()].flatMap((group) => mergeNearbyContinuations(group.map((path) => path.points)).map((points) => ({ points, sourceElement: group[0].sourceElement })));
  const vectorPerMmX = vectorWidth / targetWidthMm, vectorPerMmY = vectorHeight / targetHeightMm;
  const paths = cleanedMmPaths.map<CenterlinePath>(({ points: mmPoints, sourceElement }) => {
    const lengthMm = pathLength(mmPoints);
    const vectorPoints = mmPoints.map((p) => ({ x: minX + p.x * vectorPerMmX, y: minY + p.y * vectorPerMmY }));
    const stitchMm = resample(mmPoints, stitchLengthMm);
    const stitches = stitchMm.map((p) => ({ x: minX + p.x * vectorPerMmX, y: minY + p.y * vectorPerMmY }));
    return { points: vectorPoints, stitches, lengthMm, sourceElement };
  });
  return {
    paths,
    stitchLengthMm,
    stitchCount: paths.reduce((sum, path) => sum + path.stitches.length, 0),
    totalLengthMm: paths.reduce((sum, path) => sum + path.lengthMm, 0),
    rasterWidth,
    rasterHeight,
    rawPathCount: rawPixelPaths.length,
    prunedPathCount: prunedPixelPaths.length,
    mergedPathCount: paths.length,
    sourceElementCount: sourceGeometry.count,
    artworkMask,
    viewBox,
  };
}
