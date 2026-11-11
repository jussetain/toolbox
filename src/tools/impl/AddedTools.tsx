// Capture d'écran · Recadrer des images · Filigrane et numéros de page · Générateur de mots de passe
import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { api, useJobs } from "../../lib/api";
import { basename } from "../../lib/io";
import { handOff } from "../../lib/handoff";
import { openPdf } from "../../lib/pdfjs";
import * as P from "../logic/pdf";
import { password, passwordBits, passphrase, passphraseBits, strength, WORDS, type SetId } from "../logic/password";
import { FileDrop } from "../../components/FileDrop";
import { JobRow } from "../../components/JobRow";
import { BatchResults, type BatchResult } from "../../components/BatchResults";
import { PageThumb, PasswordGate, usePdf, useSaver } from "../../components/PdfParts";
import { CopyButton, ErrorNote, Seg, Toggle } from "../../components/ui";

// ── Capture d'écran ─────────────────────────────────────────────────────────

export function Screenshot() {
  const [mode, setMode] = useState("region");
  const [delay, setDelay] = useState(0);
  const [copy, setCopy] = useState(true);
  const { jobs, running, start, cancel } = useJobs<{ output: string; width: number; height: number }>("screenshot");
  const last = jobs.find((j) => j.status === "done")?.result;
  const to = (tool: string) => { handOff(last!.output); api.openTool(tool); };
  return (
    <div className="tool-body">
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field"><span className="field-label">Quoi</span>
          <Seg label="Mode" value={mode} onChange={setMode} options={[{ id: "region", label: "Zone ou fenêtre" }, { id: "screen", label: "Écran entier" }]} />
        </div>
        <div className="field"><span className="field-label">Retardateur</span>
          <Seg label="Retardateur" value={delay} onChange={setDelay} options={[{ id: 0, label: "Aucun" }, { id: 3, label: "3 s" }, { id: 5, label: "5 s" }, { id: 10, label: "10 s" }]} />
        </div>
        <button className="btn btn-primary" disabled={running} onClick={() => start(() => invoke<number>("screen_capture", { mode, delay, copy }))}>Capturer →</button>
      </div>
      {mode === "screen" ? <Toggle checked={copy} onChange={setCopy}>Copier aussi dans le presse-papiers</Toggle>
        : <p className="muted" style={{ margin: 0 }}>Toolbox se masque, l'outil Capture de Windows s'ouvre : choisis rectangle, fenêtre ou forme libre en haut de l'écran. L'image est aussi dans le presse-papiers.</p>}
      {jobs.filter((j) => j.status !== "done").slice(0, 1).map((j) => <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)} />)}
      {last && (
        <>
          <div className="canvas-frame"><img src={convertFileSrc(last.output) + `?${jobs[0].id}`} alt="Capture" style={{ maxWidth: "100%", maxHeight: 420, display: "block" }} /></div>
          <div className="row">
            <span className="status-ok">✓ {basename(last.output)} · {last.width} × {last.height}</span>
            <button className="btn btn-sm" onClick={() => api.reveal(last.output)}>Afficher</button>
            <span style={{ marginLeft: "auto" }} />
            <button className="btn btn-sm" onClick={() => to("annotate-screenshot")}>Annoter →</button>
            <button className="btn btn-sm" onClick={() => to("redact-image")}>Masquer une zone →</button>
            <button className="btn btn-sm" onClick={() => to("beautify-screenshot")}>Embellir →</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Recadrer des images ─────────────────────────────────────────────────────

const IMG = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff"];
const RATIOS = [{ id: 0, label: "Libre" }, { id: 1, label: "1:1" }, { id: 4 / 3, label: "4:3" }, { id: 3 / 2, label: "3:2" }, { id: 16 / 9, label: "16:9" }, { id: 9 / 16, label: "9:16" }, { id: 4 / 5, label: "4:5" }];
type Rect = [number, number, number, number];

export function CropImages() {
  const [files, setFiles] = useState<string[]>([]);
  const [ratio, setRatio] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const { jobs, running, start, cancel } = useJobs<BatchResult>("images");
  useEffect(() => setRect(null), [files[0], ratio]);
  return (
    <div className="tool-body">
      <FileDrop files={files} onChange={setFiles} accept={IMG} label="Glisse tes images ici" />
      <div className="field"><span className="field-label">Format</span><Seg label="Format" value={ratio} onChange={setRatio} options={RATIOS} /></div>
      {files[0] && <CropArea path={files[0]} ratio={ratio} rect={rect} onChange={setRect} />}
      <p className="muted" style={{ margin: 0 }}>
        {rect ? `La même zone (en proportion) est appliquée ${files.length > 1 ? `aux ${files.length} images` : "à l'image"}.`
          : ratio ? "Sans zone tracée : le plus grand cadre centré à ce format." : "Trace la zone à garder sur l'image."}
      </p>
      <div className="tool-actions">
        <button className="btn btn-primary" disabled={!files.length || running || (!rect && !ratio)} onClick={() => start(() => invoke<number>("images_process", { paths: files, op: { op: "crop", rect, ratio: ratio || null } }))}>Recadrer →</button>
      </div>
      {jobs.map((j) => <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)}>{j.status === "done" && j.result && <BatchResults result={j.result} />}</JobRow>)}
    </div>
  );
}

function CropArea({ path, ratio, rect, onChange }: { path: string; ratio: number; rect: Rect | null; onChange: (r: Rect | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const a = useRef<{ x: number; y: number } | null>(null);
  const at = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const drag = (b: { x: number; y: number }) => {
    const s = a.current!;
    let w = Math.abs(b.x - s.x), h = Math.abs(b.y - s.y);
    if (ratio && img.current) {
      // Hauteur (en fraction) imposée par le format, sans sortir de l'image.
      const k = img.current.naturalWidth / img.current.naturalHeight / ratio;
      h = w * k;
      const maxH = b.y >= s.y ? 1 - s.y : s.y;
      if (h > maxH) { h = maxH; w = h / k; }
    }
    onChange([b.x >= s.x ? s.x : s.x - w, b.y >= s.y ? s.y : s.y - h, w, h]);
  };
  return (
    <div className="canvas-frame">
      <div ref={box} style={{ position: "relative", display: "inline-block", touchAction: "none", cursor: "crosshair" }}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); a.current = at(e); }}
        onPointerMove={(e) => a.current && drag(at(e))}
        onPointerUp={() => { a.current = null; if (rect && (rect[2] < 0.02 || rect[3] < 0.02)) onChange(null); }}>
        <img ref={img} src={convertFileSrc(path)} alt="" draggable={false} style={{ maxWidth: "100%", maxHeight: 420, display: "block", pointerEvents: "none" }} />
        {rect && <div className="crop-box" style={{ left: `${rect[0] * 100}%`, top: `${rect[1] * 100}%`, width: `${rect[2] * 100}%`, height: `${rect[3] * 100}%` }} />}
      </div>
      {rect && <div className="row" style={{ marginTop: 8 }}><button className="btn btn-sm" onClick={() => onChange(null)}>Effacer la zone</button></div>}
    </div>
  );
}

// ── Filigrane et numéros de page ────────────────────────────────────────────

const FORMATS = [{ id: "{n}", label: "3" }, { id: "{n} / {total}", label: "3 / 12" }, { id: "Page {n} sur {total}", label: "Page 3 sur 12" }, { id: "– {n} –", label: "– 3 –" }];

export function StampPdf() {
  const [files, setFiles] = useState<string[]>([]);
  const pdf = usePdf(files[0]);
  return (
    <div className="tool-body">
      <FileDrop files={files} onChange={setFiles} multiple={false} accept={["pdf"]} label="Glisse un PDF ici" />
      <PasswordGate pdf={pdf} />
      {pdf.file && <StampInner key={pdf.file.path} f={pdf.file} />}
    </div>
  );
}

function StampInner({ f }: { f: NonNullable<ReturnType<typeof usePdf>["file"]> }) {
  const [useWm, setUseWm] = useState(true);
  const [wm, setWm] = useState<P.Watermark>({ text: "CONFIDENTIEL", size: 60, opacity: 0.18, color: "#E5574F", angle: 45 });
  const [useNb, setUseNb] = useState(true);
  const [nb, setNb] = useState<P.PageNumbers>({ position: "bottom-center", format: "{n} / {total}", start: 1, skipFirst: false, size: 10 });
  const [preview, setPreview] = useState<{ doc: Awaited<ReturnType<typeof openPdf>>; bytes: Uint8Array } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const s = useSaver();
  const opts = useMemo(() => ({ watermark: useWm ? wm : undefined, numbers: useNb ? nb : undefined }), [useWm, wm, useNb, nb]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const bytes = await P.stampText(f.bytes, opts, f.password);
        const doc = await openPdf(bytes.slice());
        if (live) { setPreview({ doc, bytes }); setErr(null); }
      } catch (e) { if (live) setErr(String((e as Error).message ?? e)); }
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [f, opts]);
  const W = <K extends keyof P.Watermark>(k: K, v: P.Watermark[K]) => setWm((x) => ({ ...x, [k]: v }));
  const N = <K extends keyof P.PageNumbers>(k: K, v: P.PageNumbers[K]) => setNb((x) => ({ ...x, [k]: v }));
  return (
    <>
      <div className="editor-layout">
        <div className="canvas-frame">{preview ? <PageThumb key={preview.bytes.length + JSON.stringify(opts)} doc={preview.doc} index={nb.skipFirst && f.pages > 1 && useNb ? 1 : 0} width={360} /> : <p className="muted">Aperçu…</p>}</div>
        <div className="editor-panel">
          <Toggle checked={useWm} onChange={setUseWm}><strong>Filigrane</strong></Toggle>
          {useWm && (
            <>
              <label className="field"><span className="field-label">Texte</span><input className="input" type="text" value={wm.text} onChange={(e) => W("text", e.target.value)} /></label>
              <div className="row">
                <label className="field" style={{ width: "auto" }}><span className="field-label">Couleur</span><input type="color" className="color-input" value={wm.color} onChange={(e) => W("color", e.target.value)} /></label>
                <Seg label="Angle" value={wm.angle} onChange={(v) => W("angle", v)} options={[{ id: 0, label: "—" }, { id: 45, label: "⟋" }, { id: -45, label: "⟍" }]} />
              </div>
              <label className="field"><span className="field-label">Taille : {wm.size} pt</span><input type="range" min={16} max={140} value={wm.size} onChange={(e) => W("size", +e.target.value)} /></label>
              <label className="field"><span className="field-label">Opacité : {Math.round(wm.opacity * 100)} %</span><input type="range" min={5} max={100} value={wm.opacity * 100} onChange={(e) => W("opacity", +e.target.value / 100)} /></label>
            </>
          )}
          <Toggle checked={useNb} onChange={setUseNb}><strong>Numéros de page</strong></Toggle>
          {useNb && (
            <>
              <label className="field"><span className="field-label">Format</span>
                <select className="input" value={nb.format} onChange={(e) => N("format", e.target.value)}>{FORMATS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
              </label>
              <label className="field"><span className="field-label">Position</span>
                <select className="input" value={nb.position} onChange={(e) => N("position", e.target.value as P.NumberPos)}>
                  {([["bottom-center", "En bas, au centre"], ["bottom-right", "En bas, à droite"], ["bottom-left", "En bas, à gauche"], ["top-center", "En haut, au centre"], ["top-right", "En haut, à droite"], ["top-left", "En haut, à gauche"]] as const).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
                </select>
              </label>
              <div className="row">
                <label className="field" style={{ width: 110 }}><span className="field-label">Commencer à</span><input className="input" type="number" min={0} value={nb.start} onChange={(e) => N("start", Math.max(0, +e.target.value))} /></label>
                <label className="field" style={{ width: 110 }}><span className="field-label">Taille (pt)</span><input className="input" type="number" min={6} max={36} value={nb.size} onChange={(e) => N("size", Math.min(36, Math.max(6, +e.target.value)))} /></label>
              </div>
              <Toggle checked={nb.skipFirst} onChange={(v) => N("skipFirst", v)}>Ne pas numéroter la première page</Toggle>
            </>
          )}
        </div>
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      <div className="tool-actions">
        <button className="btn btn-primary" disabled={s.busy || !preview || (!useWm && !useNb)} onClick={() => s.run(async () => [{ name: `${f.name}-tamponne.pdf`, bytes: preview!.bytes }])}>Enregistrer →</button>
      </div>
      {s.status}
    </>
  );
}

// ── Générateur de mots de passe ─────────────────────────────────────────────

const LEVEL_COLORS = ["#A3271F", "#7A5A00", "#226B3C", "#226B3C"];

export function PasswordGenerator() {
  const [kind, setKind] = useState<"password" | "phrase">("password");
  const [length, setLength] = useState(20);
  const [sets, setSets] = useState<SetId[]>(["lower", "upper", "digits", "symbols"]);
  const [noAmbiguous, setNoAmbiguous] = useState(true);
  const [words, setWords] = useState(5);
  const [separator, setSeparator] = useState("-");
  const [capitalize, setCapitalize] = useState(true);
  const [digit, setDigit] = useState(true);
  const [count, setCount] = useState(5);
  const [seed, setSeed] = useState(0);
  const pw = { length, sets, noAmbiguous };
  const ph = { words, separator, capitalize, digit };
  const list = useMemo(() => {
    try { return Array.from({ length: count }, () => (kind === "password" ? password(pw) : passphrase(ph))); } catch { return []; }
  }, [kind, length, sets.join(), noAmbiguous, words, separator, capitalize, digit, count, seed]);
  const bits = kind === "password" ? passwordBits(pw) : passphraseBits(ph);
  const st = strength(bits);
  const toggle = (s: SetId) => setSets((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]));
  return (
    <div className="tool-body">
      <Seg label="Type" value={kind} onChange={setKind} options={[{ id: "password", label: "Mot de passe" }, { id: "phrase", label: "Phrase de passe" }]} />
      {kind === "password" ? (
        <>
          <label className="field" style={{ maxWidth: 420 }}><span className="field-label">Longueur : {length} caractères</span><input type="range" min={6} max={64} value={length} onChange={(e) => setLength(+e.target.value)} /></label>
          <div className="row">
            <Toggle checked={sets.includes("lower")} onChange={() => toggle("lower")}>abc</Toggle>
            <Toggle checked={sets.includes("upper")} onChange={() => toggle("upper")}>ABC</Toggle>
            <Toggle checked={sets.includes("digits")} onChange={() => toggle("digits")}>123</Toggle>
            <Toggle checked={sets.includes("symbols")} onChange={() => toggle("symbols")}>#$&</Toggle>
            <Toggle checked={noAmbiguous} onChange={setNoAmbiguous}>Sans caractères ambigus (O 0 l 1)</Toggle>
          </div>
        </>
      ) : (
        <>
          <label className="field" style={{ maxWidth: 420 }}><span className="field-label">{words} mots (parmi {WORDS.length})</span><input type="range" min={3} max={10} value={words} onChange={(e) => setWords(+e.target.value)} /></label>
          <div className="row">
            <Seg label="Séparateur" value={separator} onChange={setSeparator} options={[{ id: "-", label: "tiret -" }, { id: ".", label: "point ." }, { id: " ", label: "espace" }, { id: "_", label: "souligné _" }]} />
            <Toggle checked={capitalize} onChange={setCapitalize}>Majuscule à chaque mot</Toggle>
            <Toggle checked={digit} onChange={setDigit}>Un chiffre</Toggle>
          </div>
        </>
      )}
      <div className="row">
        <span>Robustesse : <strong style={{ color: LEVEL_COLORS[st.level] }}>{st.label}</strong> <span className="muted">· {Math.round(bits)} bits</span></span>
        <Seg label="Nombre" value={count} onChange={setCount} options={[{ id: 1, label: "1" }, { id: 5, label: "5" }, { id: 20, label: "20" }]} />
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setSeed(seed + 1)}>Régénérer ↻</button>
      </div>
      {!list.length && <ErrorNote>Choisis au moins un type de caractères.</ErrorNote>}
      <ul className="list-mono">
        {list.map((p, i) => (
          <li key={i}><code className="selectable" style={{ flex: 1, fontSize: 15, overflowWrap: "anywhere" }}>{p}</code><CopyButton text={p} /></li>
        ))}
      </ul>
      <p className="muted" style={{ margin: 0 }}>Généré sur ce PC avec le générateur aléatoire cryptographique du système ; rien n'est enregistré ni envoyé.</p>
    </div>
  );
}
