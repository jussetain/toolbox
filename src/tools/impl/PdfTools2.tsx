// 32 Numériser · 33 Caviarder · 36 PDF vers Word · 37 Signer
import { useEffect, useRef, useState } from "react";
import "@fontsource/caveat/700.css";
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { basename, loadImage } from "../../lib/io";
import { canvasBytes, renderPage, type PdfDoc } from "../../lib/pdfjs";
import * as P from "../logic/pdf";
import { filter, outputSize, warp, type Pt } from "../logic/geometry";
import { FileDrop } from "../../components/FileDrop";
import { PasswordGate, usePdf, useSaver, type PdfFile } from "../../components/PdfParts";
import { ErrorNote, Seg } from "../../components/ui";

type Rect = { x: number; y: number; width: number; height: number };

/** Une page affichée, avec un calque pour dessiner (coordonnées en fraction de page). */
function PageView({ doc, index, width, onPointer, children }: {
  doc: PdfDoc; index: number; width: number;
  onPointer?: (type: "down" | "move" | "up", p: { x: number; y: number }, e: React.PointerEvent) => void;
  children?: React.ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => void renderPage(doc, index, { width: width * 1.5, canvas: canvas.current! }), [doc, index, width]);
  const at = (e: React.PointerEvent) => {
    const r = layer.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  return (
    <div className="page-view" style={{ width }}>
      <canvas ref={canvas} style={{ width: "100%", display: "block" }} />
      <div
        ref={layer}
        className="page-layer"
        onPointerDown={(e) => (layer.current!.setPointerCapture(e.pointerId), onPointer?.("down", at(e), e))}
        onPointerMove={(e) => onPointer?.("move", at(e), e)}
        onPointerUp={(e) => onPointer?.("up", at(e), e)}
      >
        {children}
      </div>
    </div>
  );
}

function PageNav({ index, count, onChange, extra }: { index: number; count: number; onChange: (i: number) => void; extra?: React.ReactNode }) {
  return (
    <div className="row">
      <button className="btn btn-sm" disabled={index === 0} onClick={() => onChange(index - 1)}>← Précédente</button>
      <strong>Page {index + 1} / {count}</strong>
      <button className="btn btn-sm" disabled={index >= count - 1} onClick={() => onChange(index + 1)}>Suivante →</button>
      {extra}
    </div>
  );
}

function usePdfDrop() {
  const [files, setFiles] = useState<string[]>([]);
  const pdf = usePdf(files[0]);
  const drop = (
    <>
      <FileDrop files={files} onChange={setFiles} multiple={false} accept={["pdf"]} label="Glisse un PDF ici" />
      <PasswordGate pdf={pdf} />
    </>
  );
  return { drop, file: pdf.file };
}

// ── 33 Caviarder ──
export function RedactPdf() {
  const { drop, file } = usePdfDrop();
  return <div className="tool-body">{drop}{file && <RedactInner key={file.path} f={file} />}</div>;
}

function RedactInner({ f }: { f: PdfFile }) {
  const [page, setPage] = useState(0);
  const [rects, setRects] = useState<Record<number, Rect[]>>({});
  const [draft, setDraft] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const [progress, setProgress] = useState("");
  const s = useSaver();
  const total = Object.values(rects).reduce((n, r) => n + r.length, 0);
  const norm = (d: NonNullable<typeof draft>): Rect => ({ x: Math.min(d.a.x, d.b.x), y: Math.min(d.a.y, d.b.y), width: Math.abs(d.a.x - d.b.x), height: Math.abs(d.a.y - d.b.y) });

  const save = () => s.run(async () => {
    const repl = new Map<number, Uint8Array>();
    for (const [k, list] of Object.entries(rects)) {
      if (!list.length) continue;
      setProgress(`Page ${+k + 1}…`);
      const c = await renderPage(f.doc, +k, { scale: 2.5 });
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#000";
      for (const r of list) ctx.fillRect(r.x * c.width, r.y * c.height, r.width * c.width, r.height * c.height);
      repl.set(+k, await canvasBytes(c, "image/jpeg", 0.92));
    }
    setProgress("");
    return [{ name: `${f.name}-caviarde.pdf`, bytes: await P.replacePagesWithImages(f.bytes, repl, f.password) }];
  });

  return (
    <>
      <p className="muted" style={{ margin: 0 }}>
        Trace des rectangles sur ce qui doit disparaître. Les pages caviardées sont converties en image : le texte masqué est réellement supprimé, pas seulement recouvert. Les autres pages restent intactes.
      </p>
      <PageNav index={page} count={f.pages} onChange={setPage} extra={
        <>
          <span style={{ marginLeft: "auto" }} className="muted">{total} zone{total > 1 ? "s" : ""}</span>
          <button className="btn btn-sm" disabled={!rects[page]?.length} onClick={() => setRects({ ...rects, [page]: rects[page].slice(0, -1) })}>Annuler la dernière</button>
        </>
      } />
      <div className="canvas-frame">
        <PageView doc={f.doc} index={page} width={640} onPointer={(t, p) => {
          if (t === "down") setDraft({ a: p, b: p });
          else if (t === "move" && draft) setDraft({ ...draft, b: p });
          else if (t === "up" && draft) {
            const r = norm({ ...draft, b: p });
            if (r.width > 0.005 && r.height > 0.003) setRects({ ...rects, [page]: [...(rects[page] ?? []), r] });
            setDraft(null);
          }
        }}>
          {[...(rects[page] ?? []), ...(draft ? [norm(draft)] : [])].map((r, i) => (
            <div key={i} className="redact-box" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.width * 100}%`, height: `${r.height * 100}%` }} />
          ))}
        </PageView>
      </div>
      <div className="tool-actions">
        {progress && <span className="muted">{progress}</span>}
        <button className="btn btn-primary" disabled={!total || s.busy} onClick={save}>Caviarder et enregistrer →</button>
      </div>
      {s.status}
    </>
  );
}

// ── 37 Signer ──
function trimCanvas(c: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = c.getContext("2d")!;
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 10) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  if (x1 <= x0) return c;
  const pad = 6;
  const out = document.createElement("canvas");
  out.width = x1 - x0 + pad * 2;
  out.height = y1 - y0 + pad * 2;
  out.getContext("2d")!.drawImage(c, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function SignaturePad({ onDone }: { onDone: (png: Uint8Array, ratio: number) => void }) {
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typed, setTyped] = useState("");
  const [ink, setInk] = useState("#1a2b6d");
  const c = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const cv = c.current!;
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    setEmpty(true);
    if (mode === "type" && typed.trim()) {
      ctx.fillStyle = ink;
      ctx.font = `700 120px "Caveat", cursive`;
      ctx.textBaseline = "middle";
      ctx.fillText(typed, 20, cv.height / 2, cv.width - 40);
      setEmpty(false);
    }
  }, [mode, typed, ink]);

  const pos = (e: React.PointerEvent) => {
    const r = c.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.current!.width, y: ((e.clientY - r.top) / r.height) * c.current!.height };
  };
  const draw = (e: React.PointerEvent) => {
    if (mode !== "draw" || !last.current) return;
    const p = pos(e);
    const ctx = c.current!.getContext("2d")!;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 5;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    setEmpty(false);
  };

  const finish = async () => {
    const t = trimCanvas(c.current!);
    onDone(await canvasBytes(t, "image/png"), t.height / t.width);
  };

  return (
    <div className="tool-body">
      <div className="row">
        <Seg label="Signature" value={mode} onChange={setMode} options={[{ id: "draw", label: "Dessiner" }, { id: "type", label: "Taper" }]} />
        <div className="swatches" role="group" aria-label="Encre">
          {["#1a2b6d", "#1f1b16", "#0b5d3b"].map((x) => <button key={x} className="swatch" style={{ background: x }} aria-pressed={ink === x} aria-label={`Encre ${x}`} onClick={() => setInk(x)} />)}
        </div>
        {mode === "type" && <input className="input" style={{ flex: 1 }} type="text" placeholder="Ton nom" aria-label="Nom" value={typed} onChange={(e) => setTyped(e.target.value)} />}
      </div>
      <canvas
        ref={c}
        width={1200}
        height={360}
        className="sign-pad"
        onPointerDown={(e) => mode === "draw" && ((e.target as Element).setPointerCapture(e.pointerId), (last.current = pos(e)))}
        onPointerMove={draw}
        onPointerUp={() => (last.current = null)}
      />
      <div className="tool-actions">
        <button className="btn btn-ghost" onClick={() => (c.current!.getContext("2d")!.clearRect(0, 0, 1200, 360), setTyped(""), setEmpty(true))}>Effacer</button>
        <button className="btn btn-primary" disabled={empty} onClick={finish}>Utiliser cette signature →</button>
      </div>
    </div>
  );
}

export function SignPdf() {
  const { drop, file } = usePdfDrop();
  const [sig, setSig] = useState<{ png: Uint8Array; ratio: number; url: string } | null>(null);
  return (
    <div className="tool-body">
      {drop}
      {file && !sig && <SignaturePad onDone={(png, ratio) => setSig({ png, ratio, url: URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" })) })} />}
      {file && sig && <PlaceSignature key={file.path} f={file} sig={sig} onRedo={() => setSig(null)} />}
    </div>
  );
}

function PlaceSignature({ f, sig, onRedo }: { f: PdfFile; sig: { png: Uint8Array; ratio: number; url: string }; onRedo: () => void }) {
  const [page, setPage] = useState(f.pages - 1);
  const [size, setSize] = useState(25);
  const [places, setPlaces] = useState<P.Placement[]>([]);
  const [aspect, setAspect] = useState(1.414);
  const s = useSaver();

  useEffect(() => {
    f.doc.getPage(page + 1).then((p) => {
      const v = p.getViewport({ scale: 1 });
      setAspect(v.height / v.width);
    });
  }, [f, page]);

  const w = size / 100;
  const h = w * sig.ratio / aspect;
  return (
    <>
      <p className="muted" style={{ margin: 0 }}>Clique sur la page pour poser la signature. Tu peux en poser plusieurs, sur plusieurs pages.</p>
      <PageNav index={page} count={f.pages} onChange={setPage} extra={
        <>
          <label className="field" style={{ width: 200, marginLeft: "auto" }}><span className="field-label">Taille : {size} %</span><input type="range" min={8} max={60} value={size} onChange={(e) => setSize(+e.target.value)} /></label>
          <button className="btn btn-sm" onClick={onRedo}>Refaire la signature</button>
        </>
      } />
      <div className="canvas-frame">
        <PageView doc={f.doc} index={page} width={620} onPointer={(t, p) => {
          if (t === "down") setPlaces([...places, { page, x: Math.min(1 - w, Math.max(0, p.x - w / 2)), y: Math.min(1 - h, Math.max(0, p.y - h / 2)), width: w, height: h }]);
        }}>
          {places.filter((x) => x.page === page).map((x, i) => (
            <img key={i} src={sig.url} alt="Signature" className="sig-placed" style={{ left: `${x.x * 100}%`, top: `${x.y * 100}%`, width: `${x.width * 100}%`, height: `${x.height * 100}%` }} />
          ))}
        </PageView>
      </div>
      <div className="tool-actions">
        <button className="btn btn-ghost" disabled={!places.length} onClick={() => setPlaces(places.slice(0, -1))}>Retirer la dernière</button>
        <button className="btn btn-primary" disabled={!places.length || s.busy} onClick={() => s.run(async () => [{ name: `${f.name}-signe.pdf`, bytes: await P.stampImage(f.bytes, sig.png, places, f.password) }])}>Enregistrer le PDF signé →</button>
      </div>
      {s.status}
    </>
  );
}

// ── 36 PDF vers Word ──
interface Line { y: number; x: number; text: string; size: number; bold: boolean }

async function extractLines(doc: PdfDoc, index: number): Promise<{ lines: Line[]; height: number }> {
  const page = await doc.getPage(index + 1);
  const content = await page.getTextContent();
  const vp = page.getViewport({ scale: 1 });
  const lines: Line[] = [];
  for (const it of content.items) {
    if (!("str" in it) || !it.str.trim()) continue;
    const [, , , d, e, f] = it.transform as number[];
    const size = Math.abs(d) || it.height;
    const y = vp.height - f;
    const fontName = (content.styles[it.fontName]?.fontFamily ?? "") + it.fontName;
    const last = lines.find((l) => Math.abs(l.y - y) < size * 0.5);
    if (last) {
      last.text += (e > last.x && !last.text.endsWith(" ") && !it.str.startsWith(" ") ? " " : "") + it.str;
      last.size = Math.max(last.size, size);
    } else lines.push({ y, x: e, text: it.str, size, bold: /bold|black|heavy/i.test(fontName) });
  }
  lines.sort((a, b) => a.y - b.y || a.x - b.x);
  return { lines, height: vp.height };
}

export function PdfToWord() {
  const { drop, file } = usePdfDrop();
  const [progress, setProgress] = useState("");
  const [warn, setWarn] = useState<string | null>(null);
  const s = useSaver();
  const convert = (f: PdfFile) => s.run(async () => {
    const pages: Line[][] = [];
    for (let i = 0; i < f.pages; i++) {
      setProgress(`Lecture de la page ${i + 1} / ${f.pages}`);
      pages.push((await extractLines(f.doc, i)).lines);
    }
    setProgress("");
    const all = pages.flat();
    if (!all.length) throw new Error("Aucun texte dans ce PDF : c'est sans doute un scan. Passe-le d'abord dans « Rendre un PDF cherchable ».");
    const sizes = all.map((l) => l.size).sort((a, b) => a - b);
    const body = sizes[Math.floor(sizes.length / 2)];
    const children: Paragraph[] = [];
    pages.forEach((lines, pi) => {
      let buf: Line[] = [];
      const flush = (pageBreak: boolean) => {
        if (!buf.length) return;
        const size = Math.max(...buf.map((l) => l.size));
        const text = buf.map((l) => l.text.trim()).join(" ").replace(/(\w)- (\w)/g, "$1$2");
        const heading = size > body * 1.6 ? HeadingLevel.HEADING_1 : size > body * 1.25 ? HeadingLevel.HEADING_2 : undefined;
        children.push(new Paragraph({
          heading,
          pageBreakBefore: pageBreak,
          alignment: AlignmentType.LEFT,
          spacing: { after: 160 },
          children: [new TextRun({ text, bold: !heading && buf.every((l) => l.bold), size: heading ? undefined : Math.round(Math.min(Math.max(size, 8), 14) * 2) })],
        }));
        buf = [];
      };
      let first = true;
      lines.forEach((l, i) => {
        const prev = lines[i - 1];
        const gap = prev ? l.y - prev.y : 0;
        if (prev && (gap > prev.size * 1.7 || Math.abs(l.size - prev.size) > 1.5 || /^[•\-–▪●]\s/.test(l.text))) {
          flush(first && pi > 0 && children.length > 0);
          first = false;
        }
        buf.push(l);
      });
      flush(first && pi > 0);
    });
    setWarn("La mise en page complexe (colonnes, tableaux, images) n'est pas reproduite : le texte et les titres le sont.");
    const blob = await Packer.toBlob(new Document({ sections: [{ children }] }));
    return [{ name: `${f.name}.docx`, bytes: new Uint8Array(await blob.arrayBuffer()) }];
  });
  return (
    <div className="tool-body">
      {drop}
      {file && (
        <>
          <p style={{ margin: 0 }}><strong>{file.pages} pages</strong></p>
          <div className="tool-actions">
            {progress && <span className="muted">{progress}</span>}
            <button className="btn btn-primary" disabled={s.busy} onClick={() => convert(file)}>Convertir en Word →</button>
          </div>
          {warn && s.saved.length > 0 && <p className="muted" style={{ margin: 0 }}>{warn}</p>}
          {s.status}
        </>
      )}
    </div>
  );
}

// ── 32 Numériser ──
interface Shot { path: string; bmp: ImageBitmap; quad: Pt[]; mode: "color" | "gray" | "document" }

export function ScanDocument() {
  const [shots, setShots] = useState<Shot[]>([]);
  const [current, setCurrent] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const s = useSaver();

  const add = async (paths: string[]) => {
    const next = [...shots];
    for (const p of paths) {
      try {
        const bmp = await loadImage(p);
        const ix = bmp.width * 0.03, iy = bmp.height * 0.03;
        next.push({ path: p, bmp, mode: "document", quad: [{ x: ix, y: iy }, { x: bmp.width - ix, y: iy }, { x: bmp.width - ix, y: bmp.height - iy }, { x: ix, y: bmp.height - iy }] });
      } catch (e) {
        setErr(String((e as Error).message));
      }
    }
    setShots(next);
  };
  const shot = shots[current];
  const update = (patch: Partial<Shot>) => setShots(shots.map((x, i) => (i === current ? { ...x, ...patch } : x)));

  const render = (sh: Shot) => {
    const src = new OffscreenCanvas(sh.bmp.width, sh.bmp.height);
    const sctx = src.getContext("2d")!;
    sctx.drawImage(sh.bmp, 0, 0);
    const data = sctx.getImageData(0, 0, src.width, src.height).data;
    const { w, h } = outputSize(sh.quad, 2200);
    const out = warp(data, src.width, src.height, sh.quad, w, h);
    filter(out, sh.mode);
    const c = new OffscreenCanvas(w, h);
    c.getContext("2d")!.putImageData(new ImageData(out as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
    return canvasBytes(c, "image/jpeg", sh.mode === "document" ? 0.8 : 0.85);
  };

  return (
    <div className="tool-body">
      <FileDrop files={[]} onChange={add} accept={["jpg", "jpeg", "png", "webp"]} label="Glisse les photos des pages" />
      <p className="muted" style={{ margin: 0 }}>Photographie chaque page avec ton téléphone, puis ajuste les 4 coins : Toolbox redresse la page et nettoie le fond.</p>
      {err && <ErrorNote>{err}</ErrorNote>}
      {shot && (
        <>
          <div className="row">
            {shots.map((x, i) => (
              <button key={i} className="btn btn-sm" aria-pressed={i === current} style={i === current ? { background: "var(--select)" } : undefined} onClick={() => setCurrent(i)}>{i + 1}. {basename(x.path)}</button>
            ))}
          </div>
          <div className="row">
            <Seg label="Filtre" value={shot.mode} onChange={(mode) => update({ mode })} options={[{ id: "document", label: "Document" }, { id: "gray", label: "Gris" }, { id: "color", label: "Couleur" }]} />
            <button className="btn btn-sm btn-ghost" onClick={() => (setShots(shots.filter((_, i) => i !== current)), setCurrent(Math.max(0, current - 1)))}>Retirer cette page</button>
          </div>
          <div className="canvas-frame"><CornerEditor shot={shot} onChange={(quad) => update({ quad })} /></div>
          <div className="tool-actions">
            <button className="btn btn-primary" disabled={s.busy} onClick={() => s.run(async () => {
              const pages = [];
              for (const sh of shots) pages.push(await render(sh));
              return [{ name: "scan.pdf", bytes: await P.imagesToPdf(pages, "a4", 0) }];
            })}>Créer le PDF ({shots.length} page{shots.length > 1 ? "s" : ""}) →</button>
          </div>
          {s.status}
        </>
      )}
    </div>
  );
}

function CornerEditor({ shot, onChange }: { shot: Shot; onChange: (q: Pt[]) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<number | null>(null);
  const W = 620;
  const scale = W / shot.bmp.width;
  useEffect(() => {
    const c = ref.current!;
    c.width = W;
    c.height = shot.bmp.height * scale;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(shot.bmp, 0, 0, c.width, c.height);
    ctx.fillStyle = "rgba(31,27,22,0.45)";
    ctx.beginPath();
    ctx.rect(0, 0, c.width, c.height);
    shot.quad.forEach((p, i) => (i ? ctx.lineTo(p.x * scale, p.y * scale) : ctx.moveTo(p.x * scale, p.y * scale)));
    ctx.closePath();
    ctx.fill("evenodd");
    ctx.strokeStyle = "#e2572b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    shot.quad.forEach((p, i) => (i ? ctx.lineTo(p.x * scale, p.y * scale) : ctx.moveTo(p.x * scale, p.y * scale)));
    ctx.closePath();
    ctx.stroke();
    for (const p of shot.quad) {
      ctx.beginPath();
      ctx.arc(p.x * scale, p.y * scale, 11, 0, Math.PI * 2);
      ctx.fillStyle = "#f3ede1";
      ctx.fill();
      ctx.stroke();
    }
  }, [shot, scale]);
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * shot.bmp.width, y: ((e.clientY - r.top) / r.height) * shot.bmp.height };
  };
  return (
    <canvas
      ref={ref}
      className="canvas-preview canvas-draw"
      onPointerDown={(e) => {
        const p = at(e);
        let best = -1, bd = Infinity;
        shot.quad.forEach((q, i) => { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) (bd = d), (best = i); });
        if (bd < 40 / scale) { drag.current = best; (e.target as Element).setPointerCapture(e.pointerId); }
      }}
      onPointerMove={(e) => {
        if (drag.current === null) return;
        const p = at(e);
        const q = shot.quad.slice();
        q[drag.current] = { x: Math.min(Math.max(0, p.x), shot.bmp.width), y: Math.min(Math.max(0, p.y), shot.bmp.height) };
        onChange(q);
      }}
      onPointerUp={() => (drag.current = null)}
    />
  );
}
