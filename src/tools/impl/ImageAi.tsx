// 21 Flouter les visages · 23 Supprimer l'arrière-plan · 29 Pipette
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { api } from "../../lib/api";
import { canvasToPng, copyPngToClipboard, loadImage, readFileBytes, saveOutput, saveTemp, stem } from "../../lib/io";
import { canvasBytes } from "../../lib/pdfjs";
import { FileDrop } from "../../components/FileDrop";
import { EngineGate } from "../../components/EngineGate";
import { CopyButton, ErrorNote, Seg } from "../../components/ui";
import { ImageEditor, type Shape } from "./CanvasTools";

// ── 21 ──
async function detectFaces(b: ImageBitmap): Promise<Shape[]> {
  // On envoie l'image déjà orientée (EXIF appliqué) pour que les coordonnées correspondent.
  const c = new OffscreenCanvas(b.width, b.height);
  c.getContext("2d")!.drawImage(b, 0, 0);
  const tmp = await saveTemp("visages.png", await canvasBytes(c, "image/png"));
  const faces = await invoke<{ x: number; y: number; w: number; h: number }[]>("detect_faces", { path: tmp });
  // Marge de 15 % : le front et le menton sont souvent hors du cadre détecté.
  return faces.map((f) => {
    const mx = f.w * 0.15, my = f.h * 0.2;
    return { kind: "pixelate", x1: f.x - mx, y1: f.y - my, x2: f.x + f.w + mx, y2: f.y + f.h + my, color: "#000" };
  });
}
export const BlurFaces = () => (
  <ImageEditor
    suffix="anonyme"
    detect={detectFaces}
    hint="Les visages sont détectés sur ton PC. Ajoute des zones à la main si un visage manque (Ctrl+Z pour annuler)."
    kinds={[{ id: "pixelate", label: "Pixeliser" }, { id: "blur", label: "Flouter" }, { id: "black", label: "Noir" }]}
  />
);

// ── 23 Détourage (ISNet, ONNX Runtime Web) ──
let session: Promise<import("onnxruntime-web").InferenceSession> | null = null;
async function getSession() {
  if (!session) {
    session = (async () => {
      const ort = await import("onnxruntime-web/webgpu");
      const wasm = (await import("onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url")).default;
      const mjs = (await import("onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url")).default;
      ort.env.wasm.wasmPaths = { wasm, mjs };
      ort.env.wasm.numThreads = 1;
      const path = await invoke<string>("engine_file", { id: "rembg-model", file: "isnet-general-use.onnx" });
      const model = new Uint8Array(await readFileBytes(path));
      try {
        return await ort.InferenceSession.create(model, { executionProviders: ["webgpu"] });
      } catch {
        return await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
      }
    })();
    session.catch(() => (session = null));
  }
  return session;
}

async function cutout(b: ImageBitmap): Promise<ImageData> {
  const ort = await import("onnxruntime-web/webgpu");
  const S = 1024;
  const c = new OffscreenCanvas(S, S);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(b, 0, 0, S, S);
  const px = ctx.getImageData(0, 0, S, S).data;
  const input = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) for (let k = 0; k < 3; k++) input[k * S * S + i] = px[i * 4 + k] / 255 - 0.5;
  const sess = await getSession();
  const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, S, S]) });
  const m = out[sess.outputNames[0]].data as Float32Array;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < S * S; i++) { lo = Math.min(lo, m[i]); hi = Math.max(hi, m[i]); }
  const mask = new OffscreenCanvas(S, S);
  const md = new ImageData(S, S);
  for (let i = 0; i < S * S; i++) md.data[i * 4 + 3] = Math.round(((m[i] - lo) / (hi - lo || 1)) * 255);
  mask.getContext("2d")!.putImageData(md, 0, 0);
  // Masque remis à la taille d'origine, puis appliqué comme couche alpha.
  const full = new OffscreenCanvas(b.width, b.height);
  const f = full.getContext("2d")!;
  f.drawImage(b, 0, 0);
  f.globalCompositeOperation = "destination-in";
  f.drawImage(mask, 0, 0, b.width, b.height);
  return f.getImageData(0, 0, b.width, b.height);
}

export function RemoveBackground() {
  const [files, setFiles] = useState<string[]>([]);
  const [result, setResult] = useState<ImageData | null>(null);
  const [bg, setBg] = useState<"none" | "white" | "black" | "accent">("none");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!files[0]) return;
    setResult(null); setSaved(null); setErr(null); setBusy(true);
    loadImage(files[0]).then(cutout).then(setResult).catch((e) => setErr(String(e.message ?? e))).finally(() => setBusy(false));
  }, [files]);
  useEffect(() => {
    if (!result || !canvas.current) return;
    const c = canvas.current;
    c.width = result.width; c.height = result.height;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (bg !== "none") { ctx.fillStyle = { white: "#fff", black: "#000", accent: "#f3ede1" }[bg]; ctx.fillRect(0, 0, c.width, c.height); }
    const tmp = new OffscreenCanvas(result.width, result.height);
    tmp.getContext("2d")!.putImageData(result, 0, 0);
    ctx.drawImage(tmp, 0, 0);
  }, [result, bg]);

  return (
    <EngineGate engines={["rembg-model"]}>
      <div className="tool-body">
        <FileDrop files={files} onChange={setFiles} multiple={false} accept={["jpg", "jpeg", "png", "webp"]} label="Glisse une photo" />
        {busy && <p style={{ margin: 0, fontWeight: 700 }}>Détourage en cours (quelques secondes)…</p>}
        {err && <ErrorNote>{err}</ErrorNote>}
        {result && (
          <>
            <Seg label="Fond" value={bg} onChange={setBg} options={[{ id: "none", label: "Transparent" }, { id: "white", label: "Blanc" }, { id: "black", label: "Noir" }, { id: "accent", label: "Crème" }]} />
            <div className="canvas-frame"><canvas ref={canvas} className="canvas-preview" /></div>
            <div className="tool-actions">
              {saved && <button className="btn btn-ghost btn-sm" onClick={() => api.reveal(saved)}>✓ Enregistré — Afficher</button>}
              <button className="btn" onClick={async () => copyPngToClipboard(await canvasToPng(canvas.current!))}>Copier</button>
              <button className="btn btn-primary" onClick={async () => setSaved(await saveOutput(`${stem(files[0])}-detouree.png`, await (await canvasToPng(canvas.current!)).arrayBuffer()))}>Enregistrer (PNG) →</button>
            </div>
          </>
        )}
      </div>
    </EngineGate>
  );
}

// ── 29 Pipette ──
const hexToRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
function rgbToHsl([r, g, b]: [number, number, number]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}
export function ColorPicker() {
  const [colors, setColors] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("tb-colors") ?? "[]"); } catch { return []; } });
  const [err, setErr] = useState<string | null>(null);
  const supported = "EyeDropper" in window;
  const pick = async () => {
    try {
      // @ts-expect-error EyeDropper : API Chromium (WebView2)
      const { sRGBHex } = await new window.EyeDropper().open();
      const next = [sRGBHex.toUpperCase(), ...colors.filter((c) => c !== sRGBHex.toUpperCase())].slice(0, 12);
      setColors(next);
      try { localStorage.setItem("tb-colors", JSON.stringify(next)); } catch { /* stockage indisponible */ }
    } catch (e) { if ((e as Error).name !== "AbortError") setErr(String(e)); }
  };
  const c = colors[0];
  const rgb = c ? hexToRgb(c) : null;
  const hsl = rgb ? rgbToHsl(rgb) : null;
  const formats = c && rgb && hsl ? [
    ["HEX", c], ["RGB", `rgb(${rgb.join(", ")})`], ["HSL", `hsl(${hsl[0]}, ${hsl[1]}%, ${hsl[2]}%)`],
    ["CSS variable", `--color: ${c.toLowerCase()};`], ["C# / XAML", `Color.FromArgb(255, ${rgb.join(", ")})`],
    ["Swift", `Color(red: ${(rgb[0] / 255).toFixed(3)}, green: ${(rgb[1] / 255).toFixed(3)}, blue: ${(rgb[2] / 255).toFixed(3)})`],
  ] : [];
  return (
    <div className="tool-body">
      {!supported && <ErrorNote>La pipette d'écran n'est pas disponible dans ce moteur d'affichage.</ErrorNote>}
      <div className="tool-actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn btn-primary" disabled={!supported} onClick={pick}>Prendre une couleur à l'écran →</button>
        <span className="muted">Clique n'importe où sur l'écran ; Échap pour annuler.</span>
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      {c && (
        <div className="editor-layout">
          <dl className="kv card" style={{ padding: 16 }}>
            {formats.map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{v}</dd><CopyButton text={v} /></div>)}
          </dl>
          <div className="editor-panel" style={{ alignItems: "center" }}>
            <div style={{ width: 160, height: 160, background: c, border: "var(--line)", borderRadius: 12, boxShadow: "var(--shadow)" }} />
            <div className="swatches">{colors.slice(1).map((x) => <button key={x} className="swatch" style={{ background: x }} aria-label={x} title={x} onClick={() => setColors([x, ...colors.filter((y) => y !== x)])} />)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
