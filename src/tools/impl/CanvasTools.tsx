// 22 Embellir une capture · 30 Masquer une zone · 31 Annoter une capture
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { canvasToPng, copyPngToClipboard, imageFromPaste, loadImage, saveOutput, stem } from "../../lib/io";
import { FileDrop } from "../../components/FileDrop";
import { ErrorNote, Seg, Toggle } from "../../components/ui";

const IMG = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];

/** Source d'image : fichier déposé ou image collée (Ctrl+V). */
function useImageSource() {
  const [files, setFiles] = useState<string[]>([]);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [name, setName] = useState("capture");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!files[0]) return;
    loadImage(files[0]).then((b) => (setBitmap(b), setName(stem(files[0])), setError(null))).catch((e) => setError(String(e.message ?? e)));
  }, [files]);

  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const b = await imageFromPaste(e);
      if (b) {
        setBitmap(b);
        setName("capture");
        setFiles([]);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const reset = () => (setFiles([]), setBitmap(null));
  return { files, setFiles, bitmap, name, error, reset };
}

function ExportBar({ canvas, name, suffix, onReset }: { canvas: React.RefObject<HTMLCanvasElement | null>; name: string; suffix: string; onReset: () => void }) {
  const [saved, setSaved] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const save = async () => {
    const blob = await canvasToPng(canvas.current!);
    setSaved(await saveOutput(`${name}-${suffix}.png`, await blob.arrayBuffer()));
  };
  const copy = async () => {
    await copyPngToClipboard(await canvasToPng(canvas.current!));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="tool-actions">
      {saved && <button className="btn btn-ghost btn-sm" onClick={() => api.reveal(saved)}>✓ Enregistré — Afficher</button>}
      <button className="btn btn-ghost" onClick={onReset}>Autre image</button>
      <button className="btn" onClick={copy}>{copied ? "Copié ✓" : "Copier l'image"}</button>
      <button className="btn btn-primary" onClick={save}>Enregistrer →</button>
    </div>
  );
}

function Empty({ src }: { src: ReturnType<typeof useImageSource> }) {
  return (
    <>
      <FileDrop files={src.files} onChange={src.setFiles} multiple={false} accept={IMG} label="Glisse une image ici" />
      <p className="muted" style={{ margin: 0 }}>Ou colle une capture d'écran avec Ctrl+V (Win+Maj+S pour en faire une).</p>
      {src.error && <ErrorNote>{src.error}</ErrorNote>}
    </>
  );
}

// ── 22 Embellir ─────────────────────────────────────────────────────────────

const BACKGROUNDS: { id: string; label: string; paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void }[] = [
  { id: "sunset", label: "Coucher", paint: grad(["#ff9a5a", "#e2572b", "#a33a12"]) },
  { id: "ocean", label: "Océan", paint: grad(["#9fd3ff", "#6e9bea", "#3b5bb5"]) },
  { id: "mint", label: "Menthe", paint: grad(["#d6f5e3", "#4fb3a9", "#1d6b63"]) },
  { id: "violet", label: "Violet", paint: grad(["#efe6ff", "#a98be6", "#5b36a8"]) },
  { id: "paper", label: "Papier", paint: solid("#f3ede1") },
  { id: "ink", label: "Encre", paint: solid("#1f1b16") },
  { id: "none", label: "Transparent", paint: () => {} },
];

function grad(stops: string[]) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
}
function solid(c: string) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => ((ctx.fillStyle = c), ctx.fillRect(0, 0, w, h));
}

export function BeautifyScreenshot() {
  const src = useImageSource();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [bg, setBg] = useState("sunset");
  const [padding, setPadding] = useState(8);
  const [radius, setRadius] = useState(12);
  const [shadow, setShadow] = useState(true);
  const [ratio, setRatio] = useState<"auto" | "16:9" | "1:1" | "4:3">("auto");

  useEffect(() => {
    const b = src.bitmap;
    const c = canvas.current;
    if (!b || !c) return;
    const base = Math.max(b.width, b.height);
    const pad = Math.round((padding / 100) * base);
    let w = b.width + pad * 2;
    let h = b.height + pad * 2;
    if (ratio !== "auto") {
      const [rw, rh] = ratio.split(":").map(Number);
      if (w / h > rw / rh) h = Math.round((w * rh) / rw);
      else w = Math.round((h * rw) / rh);
    }
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    BACKGROUNDS.find((x) => x.id === bg)!.paint(ctx, w, h);
    const x = (w - b.width) / 2;
    const y = (h - b.height) / 2;
    const r = (radius / 400) * base;
    ctx.save();
    if (shadow) {
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = base / 25;
      ctx.shadowOffsetY = base / 80;
      ctx.beginPath();
      ctx.roundRect(x, y, b.width, b.height, r);
      ctx.fillStyle = "#000";
      ctx.fill();
    }
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, b.width, b.height, r);
    ctx.clip();
    ctx.drawImage(b, x, y);
    ctx.restore();
  }, [src.bitmap, bg, padding, radius, shadow, ratio]);

  if (!src.bitmap) return <div className="tool-body"><Empty src={src} /></div>;
  return (
    <div className="tool-body">
      <div className="editor-layout">
        <div className="canvas-frame"><canvas ref={canvas} className="canvas-preview" /></div>
        <div className="editor-panel">
          <div className="field">
            <span className="field-label">Fond</span>
            <div className="swatches">
              {BACKGROUNDS.map((b) => (
                <button key={b.id} className={`swatch swatch-${b.id}`} aria-pressed={bg === b.id} aria-label={b.label} title={b.label} onClick={() => setBg(b.id)} />
              ))}
            </div>
          </div>
          <label className="field"><span className="field-label">Marge : {padding} %</span><input type="range" min={0} max={30} value={padding} onChange={(e) => setPadding(+e.target.value)} /></label>
          <label className="field"><span className="field-label">Coins arrondis : {radius}</span><input type="range" min={0} max={40} value={radius} onChange={(e) => setRadius(+e.target.value)} /></label>
          <Toggle checked={shadow} onChange={setShadow}>Ombre</Toggle>
          <div className="field">
            <span className="field-label">Format</span>
            <Seg label="Format" value={ratio} onChange={setRatio} options={[{ id: "auto", label: "Libre" }, { id: "16:9", label: "16:9" }, { id: "4:3", label: "4:3" }, { id: "1:1", label: "1:1" }]} />
          </div>
        </div>
      </div>
      <ExportBar canvas={canvas} name={src.name} suffix="embellie" onReset={src.reset} />
    </div>
  );
}

// ── 30 Masquer · 31 Annoter ─────────────────────────────────────────────────

export type ShapeKind = "black" | "pixelate" | "blur" | "arrow" | "rect" | "text" | "step";
export interface Shape { kind: ShapeKind; x1: number; y1: number; x2: number; y2: number; color: string; text?: string; n?: number }

const COLORS = ["#e5302b", "#e2572b", "#e9c24a", "#3a9a5b", "#2f6fe0", "#1f1b16", "#ffffff"];

function norm(s: Shape) {
  return { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
}

function drawShape(ctx: CanvasRenderingContext2D, s: Shape, b: ImageBitmap, unit: number) {
  const { x, y, w, h } = norm(s);
  switch (s.kind) {
    case "black":
      ctx.fillStyle = "#000";
      ctx.fillRect(x, y, w, h);
      break;
    case "pixelate": {
      if (w < 2 || h < 2) break;
      const block = Math.max(6, Math.round(unit * 3));
      const tmp = new OffscreenCanvas(Math.max(1, Math.ceil(w / block)), Math.max(1, Math.ceil(h / block)));
      const t = tmp.getContext("2d")!;
      t.drawImage(ctx.canvas, x, y, w, h, 0, 0, tmp.width, tmp.height);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h);
      ctx.restore();
      break;
    }
    case "blur":
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.filter = `blur(${Math.max(8, unit * 4)}px)`;
      ctx.drawImage(b, 0, 0);
      ctx.restore();
      break;
    case "rect":
      ctx.strokeStyle = s.color;
      ctx.lineWidth = unit * 1.5;
      ctx.lineJoin = "round";
      ctx.strokeRect(x, y, w, h);
      break;
    case "arrow": {
      const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      const head = unit * 7;
      ctx.strokeStyle = ctx.fillStyle = s.color;
      ctx.lineWidth = unit * 1.6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2 - Math.cos(ang) * head * 0.6, s.y2 - Math.sin(ang) * head * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s.x2, s.y2);
      ctx.lineTo(s.x2 - head * Math.cos(ang - 0.45), s.y2 - head * Math.sin(ang - 0.45));
      ctx.lineTo(s.x2 - head * Math.cos(ang + 0.45), s.y2 - head * Math.sin(ang + 0.45));
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "text": {
      const size = unit * 9;
      ctx.font = `800 ${size}px "Bricolage Grotesque Variable", sans-serif`;
      ctx.lineWidth = size / 6;
      ctx.strokeStyle = s.color === "#ffffff" ? "#1f1b16" : "#ffffff";
      ctx.lineJoin = "round";
      ctx.strokeText(s.text ?? "", s.x1, s.y1);
      ctx.fillStyle = s.color;
      ctx.fillText(s.text ?? "", s.x1, s.y1);
      break;
    }
    case "step": {
      const r = unit * 6;
      ctx.beginPath();
      ctx.arc(s.x1, s.y1, r, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.lineWidth = unit;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.fillStyle = s.color === "#ffffff" || s.color === "#e9c24a" ? "#1f1b16" : "#ffffff";
      ctx.font = `800 ${r * 1.1}px "Bricolage Grotesque Variable", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(s.n), s.x1, s.y1 + r * 0.05);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
      break;
    }
  }
}

export function ImageEditor({ kinds, suffix, hint, detect }: { kinds: { id: ShapeKind; label: string }[]; suffix: string; hint: string; detect?: (b: ImageBitmap) => Promise<Shape[]> }) {
  const src = useImageSource();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [kind, setKind] = useState<ShapeKind>(kinds[0].id);
  const [color, setColor] = useState(COLORS[0]);
  const [text, setText] = useState("Texte");
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const annotate = kinds.some((k) => k.id === "arrow");

  const unit = src.bitmap ? Math.max(src.bitmap.width, src.bitmap.height) / 400 : 1;

  const render = useCallback(() => {
    const b = src.bitmap;
    const c = canvas.current;
    if (!b || !c) return;
    if (c.width !== b.width) c.width = b.width;
    if (c.height !== b.height) c.height = b.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(b, 0, 0);
    for (const s of draft ? [...shapes, draft] : shapes) drawShape(ctx, s, b, unit);
  }, [src.bitmap, shapes, draft, unit]);

  useEffect(render, [render]);
  const [detecting, setDetecting] = useState<string | null>(null);
  useEffect(() => {
    setShapes([]);
    if (!detect || !src.bitmap) return;
    setDetecting("Recherche des visages…");
    detect(src.bitmap).then((s) => (setShapes(s), setDetecting(s.length ? `${s.length} visage${s.length > 1 ? "s" : ""} trouvé${s.length > 1 ? "s" : ""} : ajuste si besoin.` : "Aucun visage trouvé : trace les zones à la main."))).catch((e) => setDetecting(String(e)));
  }, [src.bitmap]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") setShapes((s) => s.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.current!.width, y: ((e.clientY - r.top) / r.height) * canvas.current!.height };
  };

  const down = (e: React.PointerEvent) => {
    const p = pos(e);
    if (kind === "text") return setShapes([...shapes, { kind, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, text }]);
    if (kind === "step") {
      const n = shapes.filter((s) => s.kind === "step").length + 1;
      return setShapes([...shapes, { kind, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, n }]);
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    setDraft({ kind, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color });
  };
  const move = (e: React.PointerEvent) => draft && setDraft({ ...draft, x2: pos(e).x, y2: pos(e).y });
  const up = () => {
    if (draft && (Math.abs(draft.x2 - draft.x1) > 3 || Math.abs(draft.y2 - draft.y1) > 3)) setShapes([...shapes, draft]);
    setDraft(null);
  };

  if (!src.bitmap) return <div className="tool-body"><Empty src={src} /></div>;
  return (
    <div className="tool-body">
      <div className="row">
        <Seg label="Outil" value={kind} onChange={setKind} options={kinds} />
        {annotate && (
          <div className="swatches" role="group" aria-label="Couleur">
            {COLORS.map((c) => (
              <button key={c} className="swatch" style={{ background: c }} aria-pressed={color === c} aria-label={`Couleur ${c}`} onClick={() => setColor(c)} />
            ))}
          </div>
        )}
        {kind === "text" && <input className="input" style={{ width: 220 }} type="text" aria-label="Texte à placer" value={text} onChange={(e) => setText(e.target.value)} />}
        <span style={{ marginLeft: "auto" }} />
        <button className="btn btn-sm" disabled={!shapes.length} onClick={() => setShapes(shapes.slice(0, -1))}>Annuler (Ctrl+Z)</button>
      </div>
      <p className="muted" style={{ margin: 0 }}>{hint}</p>
      {detecting && <p style={{ margin: 0, fontWeight: 700 }}>{detecting}</p>}
      <div className="canvas-frame">
        <canvas ref={canvas} className="canvas-preview canvas-draw" onPointerDown={down} onPointerMove={move} onPointerUp={up} />
      </div>
      <ExportBar canvas={canvas} name={src.name} suffix={suffix} onReset={src.reset} />
    </div>
  );
}

export function RedactImage() {
  return (
    <ImageEditor
      suffix="masquee"
      hint="Trace des rectangles sur les zones à cacher. Les pixels d'origine sont remplacés dans l'image enregistrée. Pour du texte sensible, préfère Noir ou Pixeliser au flou."
      kinds={[{ id: "black", label: "Noir" }, { id: "pixelate", label: "Pixeliser" }, { id: "blur", label: "Flouter" }]}
    />
  );
}

export function AnnotateScreenshot() {
  return (
    <ImageEditor
      suffix="annotee"
      hint="Glisse pour tracer flèches et cadres ; clique pour placer un texte ou une étape numérotée."
      kinds={[{ id: "arrow", label: "Flèche" }, { id: "rect", label: "Cadre" }, { id: "text", label: "Texte" }, { id: "step", label: "Étape" }, { id: "pixelate", label: "Pixeliser" }]}
    />
  );
}
