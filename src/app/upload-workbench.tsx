"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const GEOMETRY_SELECTOR = "path,rect,circle,ellipse,line,polyline,polygon";

type SvgAnalysis = {
  width: string;
  height: string;
  elements: number;
  paths: number;
  nodes: number;
  colors: string[];
  open: number;
  closed: number;
  rating: "Clean" | "Needs attention" | "Too complex";
  note: string;
};

type LoadedDesign = { name: string; size: string; url: string; analysis: SvgAnalysis };

function readableDimension(value: string | null, fallback: number | undefined) {
  if (value) return value;
  return fallback === undefined ? "Unknown" : Number(fallback.toFixed(1)).toString();
}

function collectColors(elements: Element[]) {
  const found = new Set<string>();
  for (const element of elements) {
    const style = element.getAttribute("style") ?? "";
    const styleColors = [...style.matchAll(/(?:fill|stroke)\s*:\s*([^;]+)/gi)].map((match) => match[1]);
    for (const color of [element.getAttribute("fill"), element.getAttribute("stroke"), ...styleColors]) {
      const value = color?.trim().toLowerCase();
      if (value && value !== "none" && value !== "currentcolor" && !value.startsWith("url(")) found.add(value);
    }
  }
  return [...found].slice(0, 8);
}

function analyzeSvg(source: string): SvgAnalysis {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (document.querySelector("parsererror") || document.documentElement.tagName.toLowerCase() !== "svg") throw new Error("This SVG could not be read.");

  const svg = document.documentElement;
  const elements = [...svg.querySelectorAll(GEOMETRY_SELECTOR)];
  const paths = [...svg.querySelectorAll("path")];
  const viewBox = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const pointElements = [...svg.querySelectorAll("polyline,polygon")];
  const pathNodes = paths.reduce((total, path) => total + ((path.getAttribute("d") ?? "").match(/[MmLlHhVvCcSsQqTtAaZz]/g)?.length ?? 0), 0);
  const pointNodes = pointElements.reduce((total, shape) => total + Math.floor((shape.getAttribute("points")?.trim().split(/[\s,]+/).length ?? 0) / 2), 0);
  const basicNodes = svg.querySelectorAll("rect").length * 4 + svg.querySelectorAll("line").length * 2 + svg.querySelectorAll("circle,ellipse").length * 4;
  const nodes = pathNodes + pointNodes + basicNodes;
  const closedPaths = paths.filter((path) => /[zZ]\s*$/.test(path.getAttribute("d")?.trim() ?? "")).length;
  const inherentlyClosed = svg.querySelectorAll("rect,circle,ellipse,polygon").length;
  const open = Math.max(0, paths.length - closedPaths) + svg.querySelectorAll("line,polyline").length;
  const closed = closedPaths + inherentlyClosed;
  const colors = collectColors([svg, ...elements]);

  let rating: SvgAnalysis["rating"] = "Clean";
  let note = "A light file with room to work.";
  if (nodes > 1200 || elements.length > 500) {
    rating = "Too complex";
    note = "This design will benefit from strong simplification.";
  } else if (nodes > 350 || elements.length > 150 || colors.length > 6) {
    rating = "Needs attention";
    note = "Usable, but cleanup should come before stitching.";
  }

  return {
    width: readableDimension(svg.getAttribute("width"), viewBox?.[2]),
    height: readableDimension(svg.getAttribute("height"), viewBox?.[3]),
    elements: elements.length,
    paths: paths.length,
    nodes,
    colors,
    open,
    closed,
    rating,
    note,
  };
}

export default function UploadWorkbench() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [design, setDesign] = useState<LoadedDesign | null>(null);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => () => { if (design) URL.revokeObjectURL(design.url); }, [design]);

  async function loadFile(file?: File) {
    setError("");
    if (!file) return;
    const isSvg = file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
    if (!isSvg) { setError("That isn’t an SVG yet. Choose a file ending in .svg."); return; }
    if (file.size > MAX_FILE_SIZE) { setError("That SVG is over 5 MB. Try a lighter export."); return; }

    try {
      const analysis = analyzeSvg(await file.text());
      setDesign({ name: file.name, size: file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`, url: URL.createObjectURL(file), analysis });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This SVG could not be read.");
    }
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) { loadFile(event.target.files?.[0]); event.target.value = ""; }
  function handleDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setIsDragging(false); loadFile(event.dataTransfer.files[0]); }

  if (design) return (
    <div className={styles.loadedDesign} aria-live="polite">
      <div className={styles.previewCard}>
        <div className={styles.previewCanvas}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={design.url} alt={`Preview of ${design.name}`} />
          <span className={styles.localBadge}>Analyzed locally</span>
        </div>
        <div className={styles.fileBar}>
          <span><strong>{design.name}</strong><small>{design.size} · SVG</small></span>
          <button type="button" onClick={() => inputRef.current?.click()}>Replace</button>
        </div>
      </div>

      <section className={styles.diagnosis} aria-labelledby="diagnosis-title">
        <header className={styles.diagnosisHeader}>
          <div><span className={styles.scanLabel}>Workshop diagnosis</span><h3 id="diagnosis-title">We found the shape.</h3></div>
          <span className={`${styles.rating} ${styles[`rating${design.analysis.rating.replace(/\s/g, "")}`]}`}>{design.analysis.rating}</span>
        </header>
        <div className={styles.metrics}>
          <div><small>Canvas</small><strong>{design.analysis.width} × {design.analysis.height}</strong></div>
          <div><small>Paths</small><strong>{design.analysis.paths}</strong></div>
          <div><small>Nodes <i>estimated</i></small><strong>{design.analysis.nodes.toLocaleString()}</strong></div>
          <div><small>Shapes</small><strong>{design.analysis.elements}</strong></div>
        </div>
        <div className={styles.geometryRow}>
          <div><span className={styles.openDot}/><strong>{design.analysis.open}</strong> open paths</div>
          <div><span className={styles.closedDot}/><strong>{design.analysis.closed}</strong> closed shapes</div>
          <div className={styles.palette}>{design.analysis.colors.length ? design.analysis.colors.map((color) => <span key={color} title={color} style={{ backgroundColor: color }}/>) : <small>No explicit colors</small>}</div>
        </div>
        <p className={styles.diagnosisNote}>{design.analysis.note} <span>Next: identify what should become a running stitch, satin, or fill.</span></p>
      </section>
      <input ref={inputRef} className={styles.hiddenInput} type="file" accept=".svg,image/svg+xml" onChange={handleChange}/>
    </div>
  );

  return (
    <div>
      <div className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ""}`} onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop}>
        <input id="svg-upload" ref={inputRef} className={styles.hiddenInput} type="file" accept=".svg,image/svg+xml" onChange={handleChange}/>
        <span className={styles.plus}>+</span><label htmlFor="svg-upload"><strong>{isDragging ? "Let it go" : "Choose an SVG"}</strong><small>{isDragging ? "We’ll catch it here" : "or drop it here"}</small></label><span className={styles.fileType}>.SVG</span>
      </div>
      {error && <p className={styles.uploadError} role="alert">{error}</p>}
    </div>
  );
}
