// 34 Formulaires · 38 Fusionner · 39 Découper · 40 Organiser · 41 Supprimer · 42 Extraire · 43 Images→PDF
// 44 Recadrer · 45 Compresser · 46 Ajouter un mot de passe · 47 Retirer · 48 PDF→images
import { useEffect, useMemo, useRef, useState } from "react";
import { formatBytes } from "../../lib/api";
import { readFileBytes } from "../../lib/io";
import { canvasBytes, recodeJpeg, renderPage } from "../../lib/pdfjs";
import * as P from "../logic/pdf";
import { FileDrop } from "../../components/FileDrop";
import { OrderList, PageThumb, PasswordGate, usePdf, useSaver } from "../../components/PdfParts";
import { ErrorNote, Seg, Toggle } from "../../components/ui";

const bytesOf = async (p: string) => new Uint8Array(await readFileBytes(p));

/** Gabarit : un PDF déposé, déverrouillé si besoin, puis le contenu de l'outil. */
function OnePdf({ children }: { children: (pdf: NonNullable<ReturnType<typeof usePdf>["file"]>) => React.ReactNode }) {
  const [files, setFiles] = useState<string[]>([]);
  const pdf = usePdf(files[0]);
  return (
    <div className="tool-body">
      <FileDrop files={files} onChange={setFiles} multiple={false} accept={["pdf"]} label="Glisse un PDF ici" />
      <PasswordGate pdf={pdf} />
      {pdf.file && children(pdf.file)}
    </div>
  );
}

// ── 38 Fusionner ──
export function MergePdfs() {
  const [files, setFiles] = useState<string[]>([]);
  const s = useSaver();
  return (
    <div className="tool-body">
      <FileDrop files={[]} onChange={(f) => setFiles([...files, ...f.filter((x) => !files.includes(x))])} accept={["pdf", "jpg", "jpeg", "png"]} label="Glisse des PDF et des images" />
      {files.length > 0 && <OrderList items={files} onChange={setFiles} />}
      <div className="tool-actions">
        <button className="btn btn-primary" disabled={files.length < 2 || s.busy} onClick={() => s.run(async () => {
          const inputs = await Promise.all(files.map(async (f) => ({ name: f, bytes: await bytesOf(f) })));
          return [{ name: "fusion.pdf", bytes: await P.merge(inputs) }];
        })}>Fusionner →</button>
      </div>
      {s.status}
    </div>
  );
}

// ── 39 Découper ──
export function SplitPdf() {
  const [mode, setMode] = useState<"each" | "ranges">("each");
  const [ranges, setRanges] = useState("1-2; 3-");
  const s = useSaver();
  return (
    <OnePdf>{(f) => (
      <>
        <p style={{ margin: 0 }}><strong>{f.pages} pages</strong></p>
        <Seg label="Mode" value={mode} onChange={setMode} options={[{ id: "each", label: "Une page par fichier" }, { id: "ranges", label: "Par plages" }]} />
        {mode === "ranges" && (
          <label className="field">
            <span className="field-label">Plages, séparées par « ; » (un fichier par plage)</span>
            <input className="input mono" type="text" value={ranges} onChange={(e) => setRanges(e.target.value)} />
          </label>
        )}
        <div className="tool-actions">
          <button className="btn btn-primary" disabled={s.busy} onClick={() => s.run(async () => {
            const groups = mode === "each" ? "each" : ranges.split(";").filter((x) => x.trim()).map((r) => P.parseRanges(r, f.pages));
            const parts = await P.split(f.bytes, groups, f.password);
            return parts.map((p) => ({ name: `${f.name}-${p.label}.pdf`, bytes: p.bytes }));
          })}>Découper →</button>
        </div>
        {s.status}
      </>
    )}</OnePdf>
  );
}

// ── 40/41/42 Grille de pages ──
interface PageState { index: number; rotate: number; selected: boolean }

function PageGrid({ mode }: { mode: "organize" | "delete" | "extract" }) {
  return (
    <OnePdf>{(f) => <PageGridInner key={f.path} f={f} mode={mode} />}</OnePdf>
  );
}

function PageGridInner({ f, mode }: { f: NonNullable<ReturnType<typeof usePdf>["file"]>; mode: "organize" | "delete" | "extract" }) {
  const [pages, setPages] = useState<PageState[]>(() => Array.from({ length: f.pages }, (_, index) => ({ index, rotate: 0, selected: false })));
  const [ranges, setRanges] = useState("");
  const [rangeErr, setRangeErr] = useState<string | null>(null);
  const drag = useRef<number | null>(null);
  const s = useSaver();

  const applyRanges = () => {
    try {
      const sel = new Set(P.parseRanges(ranges, f.pages));
      setPages(pages.map((p) => ({ ...p, selected: sel.has(p.index) })));
      setRangeErr(null);
    } catch (e) {
      setRangeErr((e as Error).message);
    }
  };
  const update = (i: number, patch: Partial<PageState>) => setPages(pages.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const drop = (to: number) => {
    const from = drag.current;
    if (from === null || from === to) return;
    const next = pages.slice();
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    setPages(next);
  };

  const kept = mode === "delete" ? pages.filter((p) => !p.selected) : mode === "extract" ? pages.filter((p) => p.selected) : pages.filter((p) => !p.selected);
  const label = mode === "organize" ? "Enregistrer" : mode === "delete" ? `Supprimer ${pages.filter((p) => p.selected).length} page(s)` : `Extraire ${kept.length} page(s)`;
  const suffix = mode === "organize" ? "organise" : mode === "delete" ? "allege" : "extrait";

  return (
    <>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="field" style={{ width: 260 }}>
          <span className="field-label">{mode === "organize" ? "Pages à retirer" : mode === "delete" ? "Pages à supprimer" : "Pages à extraire"}</span>
          <input className="input mono" type="text" placeholder="ex. 1-3, 7" value={ranges} onChange={(e) => setRanges(e.target.value)} onKeyDown={(e) => e.key === "Enter" && applyRanges()} />
        </label>
        <button className="btn" onClick={applyRanges}>Sélectionner</button>
        {mode === "organize" && <button className="btn" onClick={() => setPages(pages.map((p) => ({ ...p, rotate: (p.rotate + 90) % 360 })))}>Tout pivoter ↻</button>}
        <span className="muted">{mode === "organize" ? "Glisse les vignettes pour réordonner ; clic = retirer." : "Clique sur les vignettes pour (dé)sélectionner."}</span>
      </div>
      {rangeErr && <ErrorNote>{rangeErr}</ErrorNote>}
      <div className="page-grid">
        {pages.map((p, i) => (
          <div
            key={p.index}
            className={`page-card ${p.selected ? (mode === "extract" ? "page-picked" : "page-removed") : ""}`}
            draggable={mode === "organize"}
            onDragStart={() => (drag.current = i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drop(i)}
          >
            <button className="page-hit" aria-pressed={p.selected} aria-label={`Page ${p.index + 1}`} onClick={() => update(i, { selected: !p.selected })}>
              <PageThumb doc={f.doc} index={p.index} rotate={p.rotate} width={130} />
            </button>
            <div className="page-foot">
              <span>{p.index + 1}</span>
              {mode === "organize" && (
                <>
                  <button className="btn btn-sm btn-ghost" aria-label="Pivoter à gauche" onClick={() => update(i, { rotate: (p.rotate + 270) % 360 })}>↺</button>
                  <button className="btn btn-sm btn-ghost" aria-label="Pivoter à droite" onClick={() => update(i, { rotate: (p.rotate + 90) % 360 })}>↻</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="tool-actions">
        <button className="btn btn-primary" disabled={!kept.length || s.busy || (mode !== "organize" && !pages.some((p) => p.selected))} onClick={() => s.run(async () => [{
          name: `${f.name}-${suffix}.pdf`,
          bytes: await P.selectPages(f.bytes, kept.map((p) => ({ index: p.index, rotate: p.rotate })), f.password),
        }])}>{label} →</button>
      </div>
      {s.status}
    </>
  );
}

export const OrganizePdf = () => <PageGrid mode="organize" />;
export const DeletePages = () => <PageGrid mode="delete" />;
export const ExtractPages = () => <PageGrid mode="extract" />;

// ── 43 Images vers PDF ──
export function ImagesToPdf() {
  const [files, setFiles] = useState<string[]>([]);
  const [size, setSize] = useState<"fit" | "a4" | "letter">("a4");
  const [margin, setMargin] = useState(true);
  const s = useSaver();
  return (
    <div className="tool-body">
      <FileDrop files={[]} onChange={(f) => setFiles([...files, ...f.filter((x) => !files.includes(x))])} accept={["jpg", "jpeg", "png"]} label="Glisse des photos ou des scans (JPEG, PNG)" />
      {files.length > 0 && <OrderList items={files} onChange={setFiles} />}
      <div className="row">
        <Seg label="Taille de page" value={size} onChange={setSize} options={[{ id: "a4", label: "A4" }, { id: "letter", label: "Lettre US" }, { id: "fit", label: "Taille de l'image" }]} />
        {size !== "fit" && <Toggle checked={margin} onChange={setMargin}>Marges</Toggle>}
      </div>
      <div className="tool-actions">
        <button className="btn btn-primary" disabled={!files.length || s.busy} onClick={() => s.run(async () => [{
          name: "images.pdf",
          bytes: await P.imagesToPdf(await Promise.all(files.map(bytesOf)), size, size !== "fit" && margin ? 28 : 0),
        }])}>Créer le PDF →</button>
      </div>
      {s.status}
    </div>
  );
}

// ── 44 Recadrer ──
export function CropPdf() {
  const [m, setM] = useState({ top: 5, right: 5, bottom: 5, left: 5 });
  const s = useSaver();
  return (
    <OnePdf>{(f) => (
      <>
        <div className="editor-layout">
          <div className="canvas-frame" style={{ position: "relative" }}>
            <div style={{ position: "relative", display: "inline-block" }}>
              <PageThumb doc={f.doc} index={0} width={360} />
              <div className="crop-box" style={{ top: `${m.top}%`, right: `${m.right}%`, bottom: `${m.bottom}%`, left: `${m.left}%` }} />
            </div>
          </div>
          <div className="editor-panel">
            {(["top", "bottom", "left", "right"] as const).map((k) => (
              <label key={k} className="field">
                <span className="field-label">{{ top: "Haut", bottom: "Bas", left: "Gauche", right: "Droite" }[k]} : {m[k]} %</span>
                <input type="range" min={0} max={40} value={m[k]} onChange={(e) => setM({ ...m, [k]: +e.target.value })} />
              </label>
            ))}
            <p className="muted" style={{ margin: 0 }}>Appliqué aux {f.pages} pages.</p>
          </div>
        </div>
        <div className="tool-actions">
          <button className="btn btn-primary" disabled={s.busy} onClick={() => s.run(async () => [{ name: `${f.name}-recadre.pdf`, bytes: await P.crop(f.bytes, m, f.password) }])}>Recadrer →</button>
        </div>
        {s.status}
      </>
    )}</OnePdf>
  );
}

// ── 45 Compresser ──
export function CompressPdf() {
  const [level, setLevel] = useState<"light" | "balanced" | "strong">("balanced");
  const [info, setInfo] = useState<string | null>(null);
  const s = useSaver();
  const cfg = { light: [2400, 0.8], balanced: [1800, 0.7], strong: [1200, 0.55] }[level] as [number, number];
  return (
    <OnePdf>{(f) => (
      <>
        <p style={{ margin: 0 }}><strong>{formatBytes(f.bytes.length)}</strong> · {f.pages} pages</p>
        <Seg label="Niveau" value={level} onChange={setLevel} options={[{ id: "light", label: "Léger" }, { id: "balanced", label: "Équilibré" }, { id: "strong", label: "Fort" }]} />
        <p className="muted" style={{ margin: 0 }}>Les photos du document sont réduites et réencodées ; le texte et les dessins vectoriels ne changent pas.</p>
        <div className="tool-actions">
          {info && <span className="status-ok">{info}</span>}
          <button className="btn btn-primary" disabled={s.busy} onClick={() => s.run(async () => {
            const r = await P.compress(f.bytes, recodeJpeg, cfg[0], cfg[1], f.password);
            setInfo(r.smaller ? `${formatBytes(f.bytes.length)} → ${formatBytes(r.bytes.length)} (−${Math.round((1 - r.bytes.length / f.bytes.length) * 100)} %)` : "Ce PDF est déjà compact : rien à gagner.");
            return r.smaller ? [{ name: `${f.name}-compresse.pdf`, bytes: r.bytes }] : [];
          })}>Compresser →</button>
        </div>
        {s.status}
      </>
    )}</OnePdf>
  );
}

// ── 46 Ajouter un mot de passe ──
export function AddPassword() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [perms, setPerms] = useState<P.Permissions>({ printing: true, copying: false, modifying: false });
  const s = useSaver();
  const mismatch = pw2 && pw !== pw2;
  return (
    <OnePdf>{(f) => (
      <>
        <div className="row">
          <label className="field" style={{ flex: 1 }}><span className="field-label">Mot de passe d'ouverture</span><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          <label className="field" style={{ flex: 1 }}><span className="field-label">Confirmation</span><input className={`input ${mismatch ? "input-invalid" : ""}`} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
        </div>
        {mismatch && <ErrorNote>Les deux mots de passe diffèrent.</ErrorNote>}
        <div className="row">
          <Toggle checked={perms.printing} onChange={(v) => setPerms({ ...perms, printing: v })}>Autoriser l'impression</Toggle>
          <Toggle checked={perms.copying} onChange={(v) => setPerms({ ...perms, copying: v })}>Autoriser la copie du texte</Toggle>
          <Toggle checked={perms.modifying} onChange={(v) => setPerms({ ...perms, modifying: v })}>Autoriser les modifications</Toggle>
        </div>
        <p className="muted" style={{ margin: 0 }}>Chiffrement AES-256. Sans le mot de passe, le document est illisible : garde-le précieusement.</p>
        <div className="tool-actions">
          <button className="btn btn-primary" disabled={!pw || pw !== pw2 || s.busy} onClick={() => s.run(async () => [{ name: `${f.name}-protege.pdf`, bytes: await P.protect(f.password ? await P.unlock(f.bytes, f.password) : f.bytes, pw, "", perms) }])}>Protéger →</button>
        </div>
        {s.status}
      </>
    )}</OnePdf>
  );
}

// ── 47 Retirer le mot de passe ──
export function RemovePassword() {
  const s = useSaver();
  return (
    <OnePdf>{(f) => (
      <>
        <p style={{ margin: 0 }}>{f.password ? "✓ Déverrouillé avec ton mot de passe." : "Ce PDF n'a pas de mot de passe d'ouverture ; les restrictions éventuelles seront retirées."}</p>
        <div className="tool-actions">
          <button className="btn btn-primary" disabled={s.busy} onClick={() => s.run(async () => [{ name: `${f.name}-deverrouille.pdf`, bytes: await P.unlock(f.bytes, f.password ?? "") }])}>Enregistrer sans mot de passe →</button>
        </div>
        {s.status}
      </>
    )}</OnePdf>
  );
}

// ── 48 PDF vers images ──
export function PdfToImages() {
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [dpi, setDpi] = useState(150);
  const [progress, setProgress] = useState<string | null>(null);
  const s = useSaver();
  return (
    <OnePdf>{(f) => (
      <>
        <p style={{ margin: 0 }}><strong>{f.pages} pages</strong></p>
        <div className="row">
          <Seg label="Format" value={format} onChange={setFormat} options={[{ id: "png", label: "PNG" }, { id: "jpeg", label: "JPEG" }]} />
          <Seg label="Résolution" value={dpi} onChange={setDpi} options={[{ id: 72, label: "72 ppp (écran)" }, { id: 150, label: "150 ppp" }, { id: 300, label: "300 ppp (impression)" }]} />
        </div>
        <div className="tool-actions">
          {progress && s.busy && <span className="muted">{progress}</span>}
          <button className="btn btn-primary" disabled={s.busy} onClick={() => s.run(async () => {
            const out = [];
            for (let i = 0; i < f.pages; i++) {
              setProgress(`Page ${i + 1} / ${f.pages}`);
              const c = await renderPage(f.doc, i, { scale: dpi / 72 });
              out.push({ name: `${f.name}-p${String(i + 1).padStart(String(f.pages).length, "0")}.${format === "png" ? "png" : "jpg"}`, bytes: await canvasBytes(c, `image/${format}`, 0.9) });
              c.width = c.height = 0;
            }
            return out;
          })}>Exporter {f.pages} image{f.pages > 1 ? "s" : ""} →</button>
        </div>
        {s.status}
      </>
    )}</OnePdf>
  );
}

// ── 34 Remplir et aplatir ──
export function FillForms() {
  return <OnePdf>{(f) => <FillFormsInner key={f.path} f={f} />}</OnePdf>;
}

function FillFormsInner({ f }: { f: NonNullable<ReturnType<typeof usePdf>["file"]> }) {
  const [fields, setFields] = useState<P.FieldInfo[] | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [flatten, setFlatten] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const s = useSaver();

  useEffect(() => {
    P.listFields(f.bytes, f.password)
      .then((fs) => {
        setFields(fs);
        setValues(Object.fromEntries(fs.filter((x) => x.type !== "other").map((x) => [x.name, (x as { value: string | boolean }).value])));
      })
      .catch((e) => setErr(String(e.message ?? e)));
  }, [f]);

  const editable = useMemo(() => fields?.filter((x) => x.type !== "other") ?? [], [fields]);
  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (!fields) return null;
  if (!editable.length) return <p>Ce PDF n'a pas de champs de formulaire à remplir.</p>;

  return (
    <>
      <div className="form-fields">
        {editable.map((x) => (
          <div key={x.name} className="field">
            <span className="field-label">{x.name}</span>
            {x.type === "text" && (x.multiline
              ? <textarea className="input input-prose" rows={3} value={String(values[x.name] ?? "")} onChange={(e) => setValues({ ...values, [x.name]: e.target.value })} aria-label={x.name} />
              : <input className="input" type="text" value={String(values[x.name] ?? "")} onChange={(e) => setValues({ ...values, [x.name]: e.target.value })} aria-label={x.name} />)}
            {x.type === "checkbox" && <Toggle checked={!!values[x.name]} onChange={(v) => setValues({ ...values, [x.name]: v })}>Coché</Toggle>}
            {(x.type === "choice" || x.type === "radio") && (
              <select className="input" value={String(values[x.name] ?? "")} onChange={(e) => setValues({ ...values, [x.name]: e.target.value })} aria-label={x.name}>
                <option value="">—</option>
                {x.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
          </div>
        ))}
      </div>
      <Toggle checked={flatten} onChange={setFlatten}>Aplatir (les réponses deviennent du texte non modifiable)</Toggle>
      <div className="tool-actions">
        <button className="btn btn-primary" disabled={s.busy} onClick={() => s.run(async () => [{ name: `${f.name}-rempli.pdf`, bytes: await P.fillForm(f.bytes, values, flatten, f.password) }])}>Enregistrer →</button>
      </div>
      {s.status}
    </>
  );
}
