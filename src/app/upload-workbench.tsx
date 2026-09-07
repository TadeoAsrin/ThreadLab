"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
type LoadedDesign = { name: string; size: string; url: string };

export default function UploadWorkbench() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [design, setDesign] = useState<LoadedDesign | null>(null);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => () => { if (design) URL.revokeObjectURL(design.url); }, [design]);

  function loadFile(file?: File) {
    setError("");
    if (!file) return;
    const isSvg = file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
    if (!isSvg) { setError("That isn’t an SVG yet. Choose a file ending in .svg."); return; }
    if (file.size > MAX_FILE_SIZE) { setError("That SVG is over 5 MB. Try a lighter export."); return; }
    setDesign({ name: file.name, size: file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`, url: URL.createObjectURL(file) });
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    loadFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setIsDragging(false); loadFile(event.dataTransfer.files[0]);
  }

  if (design) return (
    <div className={styles.previewCard} aria-live="polite">
      <div className={styles.previewCanvas}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={design.url} alt={`Preview of ${design.name}`} />
        <span className={styles.localBadge}>Local preview</span>
      </div>
      <div className={styles.fileBar}>
        <span><strong>{design.name}</strong><small>{design.size} · SVG</small></span>
        <button type="button" onClick={() => inputRef.current?.click()}>Replace</button>
      </div>
      <input ref={inputRef} className={styles.hiddenInput} type="file" accept=".svg,image/svg+xml" onChange={handleChange} />
    </div>
  );

  return (
    <div>
      <div className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ""}`} onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop}>
        <input id="svg-upload" ref={inputRef} className={styles.hiddenInput} type="file" accept=".svg,image/svg+xml" onChange={handleChange} />
        <span className={styles.plus}>+</span>
        <label htmlFor="svg-upload"><strong>{isDragging ? "Let it go" : "Choose an SVG"}</strong><small>{isDragging ? "We’ll catch it here" : "or drop it here"}</small></label>
        <span className={styles.fileType}>.SVG</span>
      </div>
      {error && <p className={styles.uploadError} role="alert">{error}</p>}
    </div>
  );
}
