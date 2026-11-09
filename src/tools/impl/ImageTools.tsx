// 24 Convertir · 25 Compresser · 26 Redimensionner · 27 Pivoter · 28 Supprimer les métadonnées
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useJobs } from "../../lib/api";
import { FileDrop } from "../../components/FileDrop";
import { JobRow } from "../../components/JobRow";
import { BatchResults, type BatchResult } from "../../components/BatchResults";
import { Seg, Toggle } from "../../components/ui";

const IMG = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "ico"];

type Op =
  | { op: "convert"; format: string; quality: number }
  | { op: "compress"; quality: number }
  | { op: "resize"; mode: string; percent?: number; width?: number; height?: number; noUpscale: boolean }
  | { op: "rotate"; degrees: number; flipH: boolean; flipV: boolean }
  | { op: "stripMetadata" };

/** Gabarit commun : dépôt d'images, options, bouton, suivi et résultats. */
function ImageBatch({ op, action, children }: { op: Op; action: string; children?: React.ReactNode }) {
  const [files, setFiles] = useState<string[]>([]);
  const { jobs, running, start, cancel } = useJobs<BatchResult>("images");
  return (
    <div className="tool-body">
      <FileDrop files={files} onChange={setFiles} accept={IMG} label="Glisse tes images ici" />
      {children}
      <div className="tool-actions">
        <button className="btn btn-primary" disabled={!files.length || running} onClick={() => start(() => invoke<number>("images_process", { paths: files, op }))}>
          {action} →
        </button>
      </div>
      {jobs.map((j) => (
        <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)}>
          {j.status === "done" && j.result && <BatchResults result={j.result} />}
        </JobRow>
      ))}
    </div>
  );
}

function Quality({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label className="field" style={{ maxWidth: 420 }}>
      <span className="field-label">Qualité : {value}</span>
      <input type="range" min={40} max={100} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

export function ConvertImages() {
  const [format, setFormat] = useState("jpeg");
  const [quality, setQuality] = useState(90);
  return (
    <ImageBatch op={{ op: "convert", format, quality }} action="Convertir">
      <div className="field">
        <span className="field-label">Format de sortie</span>
        <Seg label="Format" value={format} onChange={setFormat} options={[
          { id: "jpeg", label: "JPEG" }, { id: "png", label: "PNG" }, { id: "webp", label: "WebP" }, { id: "tiff", label: "TIFF" }, { id: "bmp", label: "BMP" },
        ]} />
      </div>
      {format === "jpeg" && <Quality value={quality} onChange={setQuality} />}
      {format === "webp" && <p className="muted" style={{ margin: 0 }}>WebP sans perte : qualité identique à l'original.</p>}
    </ImageBatch>
  );
}

export function CompressImages() {
  const [level, setLevel] = useState<"light" | "balanced" | "strong">("balanced");
  const quality = { light: 88, balanced: 78, strong: 62 }[level];
  return (
    <ImageBatch op={{ op: "compress", quality }} action="Compresser">
      <div className="field">
        <span className="field-label">Niveau</span>
        <Seg label="Niveau" value={level} onChange={setLevel} options={[{ id: "light", label: "Léger" }, { id: "balanced", label: "Équilibré" }, { id: "strong", label: "Fort" }]} />
      </div>
      <p className="muted" style={{ margin: 0 }}>Les PNG sont optimisés sans aucune perte. Si une image ne peut pas être allégée, l'original est conservé.</p>
    </ImageBatch>
  );
}

export function ResizeImages() {
  const [mode, setMode] = useState<"percent" | "longest" | "fit" | "exact">("longest");
  const [percent, setPercent] = useState(50);
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [noUpscale, setNoUpscale] = useState(true);
  const num = (label: string, v: number, set: (n: number) => void) => (
    <label className="field" style={{ width: 150 }}>
      <span className="field-label">{label}</span>
      <input className="input" type="number" min={1} value={v} onChange={(e) => set(+e.target.value)} />
    </label>
  );
  return (
    <ImageBatch op={{ op: "resize", mode, percent, width, height, noUpscale }} action="Redimensionner">
      <Seg label="Mode" value={mode} onChange={setMode} options={[
        { id: "longest", label: "Côté le plus long" }, { id: "percent", label: "Pourcentage" }, { id: "fit", label: "Tenir dans un cadre" }, { id: "exact", label: "Taille exacte" },
      ]} />
      <div className="row">
        {mode === "percent" && num("Pourcentage", percent, setPercent)}
        {mode === "longest" && num("Pixels", width, setWidth)}
        {(mode === "fit" || mode === "exact") && (<>{num("Largeur", width, setWidth)}{num("Hauteur", height, setHeight)}</>)}
      </div>
      {mode === "exact" && <p className="muted" style={{ margin: 0 }}>Taille exacte : l'image est étirée si les proportions diffèrent.</p>}
      <Toggle checked={noUpscale} onChange={setNoUpscale}>Ne jamais agrandir</Toggle>
    </ImageBatch>
  );
}

export function RotateImages() {
  const [degrees, setDegrees] = useState(90);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  return (
    <ImageBatch op={{ op: "rotate", degrees, flipH, flipV }} action="Appliquer">
      <Seg label="Rotation" value={degrees} onChange={setDegrees} options={[
        { id: 0, label: "Aucune" }, { id: 90, label: "90° ↻" }, { id: 180, label: "180°" }, { id: 270, label: "90° ↺" },
      ]} />
      <div className="row">
        <Toggle checked={flipH} onChange={setFlipH}>Miroir horizontal</Toggle>
        <Toggle checked={flipV} onChange={setFlipV}>Miroir vertical</Toggle>
      </div>
    </ImageBatch>
  );
}

export function RemoveMetadata() {
  return (
    <ImageBatch op={{ op: "stripMetadata" }} action="Nettoyer">
      <p className="muted" style={{ margin: 0 }}>
        Retire la position GPS, l'appareil, la date et les commentaires. Les JPEG et PNG sont nettoyés sans réencodage : aucune perte de qualité.
      </p>
    </ImageBatch>
  );
}
