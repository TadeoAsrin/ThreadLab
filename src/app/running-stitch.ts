export type StitchPoint = { x: number; y: number };

export type RunningPath = {
  index: number;
  lengthMm: number;
  stitches: StitchPoint[];
};

export type RunningStitchResult = {
  paths: RunningPath[];
  stitchLengthMm: number;
  totalLengthMm: number;
  stitchCount: number;
};

const RUNNING_SELECTOR = "path,line,polyline";

function inheritedPaint(element: Element, property: "fill" | "stroke") {
  let current: Element | null = element;
  while (current) {
    const direct = current.getAttribute(property);
    const style = current.getAttribute("style")?.match(new RegExp(`${property}\\s*:\\s*([^;]+)`, "i"))?.[1];
    const value = (direct ?? style)?.trim().toLowerCase();
    if (value && value !== "inherit") return value;
    current = current.parentElement;
  }
  return property === "fill" ? "#000000" : "none";
}

function isOpenPath(element: Element) {
  if (element.tagName.toLowerCase() === "line" || element.tagName.toLowerCase() === "polyline") return true;
  return element.tagName.toLowerCase() === "path" && !/[zZ]\s*$/.test(element.getAttribute("d")?.trim() ?? "");
}

function shouldRun(element: Element) {
  return isOpenPath(element) || (inheritedPaint(element, "fill") === "none" && inheritedPaint(element, "stroke") !== "none");
}

function createMeasuringSvg(source: string) {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  if (parsed.querySelector("parsererror")) return null;

  const imported = window.document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
  imported.style.cssText = "position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;overflow:visible;opacity:0;pointer-events:none";
  window.document.body.appendChild(imported);
  return imported;
}

export function generateRunningStitches(source: string, scaleMmPerUnit: number, stitchLengthMm = 2.5): RunningStitchResult {
  if (typeof window === "undefined" || scaleMmPerUnit <= 0 || stitchLengthMm <= 0) {
    return { paths: [], stitchLengthMm, totalLengthMm: 0, stitchCount: 0 };
  }

  const svg = createMeasuringSvg(source);
  if (!svg) return { paths: [], stitchLengthMm, totalLengthMm: 0, stitchCount: 0 };

  try {
    const candidates = [...svg.querySelectorAll(RUNNING_SELECTOR)].filter(shouldRun);
    const paths = candidates.flatMap<RunningPath>((element, index) => {
      const geometry = element as SVGGeometryElement;
      if (typeof geometry.getTotalLength !== "function" || typeof geometry.getPointAtLength !== "function") return [];

      let vectorLength = 0;
      try { vectorLength = geometry.getTotalLength(); } catch { return []; }
      if (!Number.isFinite(vectorLength) || vectorLength <= 0) return [];

      const lengthMm = vectorLength * scaleMmPerUnit;
      const segments = Math.max(1, Math.ceil(lengthMm / stitchLengthMm));
      const stitches: StitchPoint[] = [];

      for (let step = 0; step <= segments; step += 1) {
        const distance = vectorLength * (step / segments);
        const point = geometry.getPointAtLength(distance);
        stitches.push({ x: point.x * scaleMmPerUnit, y: point.y * scaleMmPerUnit });
      }

      return [{ index, lengthMm, stitches }];
    });

    return {
      paths,
      stitchLengthMm,
      totalLengthMm: paths.reduce((sum, path) => sum + path.lengthMm, 0),
      stitchCount: paths.reduce((sum, path) => sum + path.stitches.length, 0),
    };
  } finally {
    svg.remove();
  }
}
