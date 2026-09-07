import styles from "./page.module.css";
import UploadWorkbench from "./upload-workbench";

function ThreadMark() {
  return <svg aria-hidden="true" className={styles.threadMark} viewBox="0 0 48 48" fill="none"><path d="M8 24h32M24 8c0 9-8 9-8 16s8 7 8 16M24 8c0 9 8 9 8 16s-8 7-8 16"/><circle cx="24" cy="24" r="3.25"/></svg>;
}

function HoopIllustration() {
  return (
    <svg aria-hidden="true" className={styles.hoop} viewBox="0 0 620 620" fill="none">
      <circle className={styles.hoopShadow} cx="310" cy="318" r="235"/><circle className={styles.hoopOuter} cx="310" cy="300" r="235"/><circle className={styles.hoopInner} cx="310" cy="300" r="215"/>
      <path className={styles.fabricLine} d="M98 275c71 17 142 20 213 7 86-15 158-11 213 10M116 364c64-13 132-11 203 7 67 17 127 18 181 3"/>
      <path className={styles.stitchPath} pathLength="1" d="M213 339c18-78 48-119 89-123 51-5 84 49 108 145M238 310c38 20 77 22 116 6"/>
      <circle className={styles.needleEye} cx="412" cy="367" r="5"/><path className={styles.needle} d="m416 371 69 69"/><path className={styles.looseThread} d="M485 440c34 35 54 21 31-15-16-25 1-39 34-24"/><path className={styles.clasp} d="M276 61h68v27h-68zM289 42h42v19h-42z"/>
    </svg>
  );
}

export default function Home() {
  return (
    <main className={styles.workshop}>
      <nav className={styles.nav} aria-label="Main navigation">
        <a className={styles.brand} href="#top" aria-label="ThreadLab home"><ThreadMark/><span>ThreadLab</span></a>
        <span className={styles.status}><i aria-hidden="true"/> Workshop open</span>
      </nav>
      <section className={styles.hero} id="top">
        <div className={styles.copy}>
          <p className={styles.eyebrow}>Day 01 · The workshop opens</p>
          <h1>Ideas, ready<br/><em>to take shape.</em></h1>
          <p className={styles.intro}>ThreadLab turns drawings into embroidery-ready paths—without making you think like a machine.</p>
          <div className={styles.actions}>
            <a className={styles.primaryAction} href="#workbench">Enter the workshop <span aria-hidden="true">↘</span></a>
            <span className={styles.actionNote}>Start with an SVG. Leave with a clean path.</span>
          </div>
        </div>
        <div className={styles.visual}><span className={`${styles.note} ${styles.noteTop}`}>One idea</span><HoopIllustration/><span className={`${styles.note} ${styles.noteBottom}`}>One confident path</span></div>
      </section>
      <section className={styles.workbench} id="workbench">
        <div><p className={styles.eyebrow}>Your first workbench</p><h2>Bring in a line.<br/>We’ll help it stitch.</h2></div>
        <UploadWorkbench />
      </section>
      <footer className={styles.footer}><span>Built for the space between drawing and thread.</span><span>ThreadLab · Córdoba</span></footer>
    </main>
  );
}
