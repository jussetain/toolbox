// 2 Incruster des sous-titres : découpage (phrases ou N mots), police, taille, position, couleurs,
// mot prononcé surligné, décalage — avec aperçu en direct sur la vidéo.
import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useJobs } from "../../lib/api";
import { basename, readFileBytes, saveOutput, saveTemp, stem } from "../../lib/io";
import { activeAt, cueText, DEFAULT_STYLE, fontPx, group, PRESETS, toAss, toSrt, wordsFromSrt, wordsFromWhisper, type Split, type SubStyle, type Word } from "../logic/subtitles";
import { FileDrop } from "../../components/FileDrop";
import { JobRow } from "../../components/JobRow";
import { EngineGate } from "../../components/EngineGate";
import { BatchResults, type BatchResult } from "../../components/BatchResults";
import { ErrorNote, Seg, Toggle } from "../../components/ui";
import { TranscribeView, type Transcript } from "./AiTools";

const VIDEO = ["mp4", "mov", "m4v", "mkv", "webm", "avi", "wmv", "flv", "mts", "m2ts", "3gp"];
const FONTS = ["Arial", "Arial Black", "Bahnschrift", "Calibri", "Cambria", "Comic Sans MS", "Consolas", "Georgia", "Impact", "Segoe UI", "Segoe UI Black", "Tahoma", "Trebuchet MS", "Verdana"];
const text = async (p: string) => new TextDecoder().decode(await readFileBytes(p));

export function BurnSubtitles() {
  const [files, setFiles] = useState<string[]>([]);
  const [words, setWords] = useState<Word[] | null>(null);
  /** Fichier ASS déjà stylé : incrusté tel quel. */
  const [ass, setAss] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const video = files[0];
  const reset = () => (setWords(null), setAss(null), setSource(""), setErr(null));
  useEffect(reset, [video]);

  const fromTranscript = async (t: Transcript) => {
    try {
      let w: Word[] = [];
      if (t.json) w = await text(t.json).then((s) => wordsFromWhisper(JSON.parse(s))).catch(() => []);
      if (!w.length) w = wordsFromSrt(await text(t.srt));
      if (!w.length) throw new Error("Aucune parole détectée dans cette vidéo.");
      setWords(w);
      setSource("Transcription automatique");
    } catch (e) { setErr(String((e as Error).message ?? e)); }
  };
  const pickFile = async () => {
    const p = await open({ filters: [{ name: "Sous-titres", extensions: ["srt", "vtt", "ass"] }] });
    if (typeof p !== "string") return;
    setErr(null);
    if (p.toLowerCase().endsWith(".ass")) { setAss(p); setSource(basename(p)); return; }
    const w = wordsFromSrt(await text(p));
    if (!w.length) return setErr("Aucun sous-titre lisible dans ce fichier.");
    setWords(w);
    setSource(basename(p));
  };

  return (
    <EngineGate engines={["ffmpeg"]}>
      <div className="tool-body">
        <FileDrop files={files} onChange={setFiles} accept={VIDEO} multiple={false} label="Glisse la vidéo" />
        {video && !words && !ass && (
          <>
            <TranscribeView key={video} path={video} onDone={fromTranscript} />
            <div className="row">
              <button className="btn" onClick={pickFile}>Choisir un fichier de sous-titres…</button>
              <span className="muted">SRT ou VTT : tu pourras changer le style et le découpage. ASS : incrusté tel quel.</span>
            </div>
          </>
        )}
        {err && <ErrorNote>{err}</ErrorNote>}
        {video && (words || ass) && (
          <div className="row">
            <span>Sous-titres : <strong>{source}</strong></span>
            <button className="btn btn-sm btn-ghost" onClick={reset}>Changer</button>
          </div>
        )}
        {video && words && <Studio key={video} video={video} words={words} />}
        {video && ass && <Burn video={video} prepare={async () => ass} />}
      </div>
    </EngineGate>
  );
}

function Burn({ video, prepare, extra }: { video: string; prepare: () => Promise<string>; extra?: React.ReactNode }) {
  const { jobs, running, start, cancel } = useJobs<BatchResult>("burn-subtitles");
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setErr(null);
    try {
      const subtitles = await prepare();
      await start(() => invoke<number>("media_process", { tool: "burn-subtitles", paths: [video], op: { op: "burnSubtitles", subtitles } }));
    } catch (e) { setErr(String((e as Error).message ?? e)); }
  };
  return (
    <>
      <div className="tool-actions">
        {extra}
        <button className="btn btn-primary" disabled={running} onClick={run}>Incruster →</button>
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      {jobs.map((j) => <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)}>{j.status === "done" && j.result && <BatchResults result={j.result} />}</JobRow>)}
    </>
  );
}

function Studio({ video, words }: { video: string; words: Word[] }) {
  const [preset, setPreset] = useState("classic");
  const [split, setSplit] = useState<Split>(PRESETS[0].split);
  const [style, setStyle] = useState<SubStyle>({ ...DEFAULT_STYLE, ...PRESETS[0].style });
  const [customFont, setCustomFont] = useState(false);
  const [dims, setDims] = useState({ w: 1920, h: 1080 });
  const [srtSaved, setSrtSaved] = useState<string | null>(null);
  const cues = useMemo(() => group(words, split), [words, split]);
  const set = <K extends keyof SubStyle>(k: K, v: SubStyle[K]) => (setStyle((s) => ({ ...s, [k]: v })), setPreset(""));
  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)!;
    setPreset(id);
    setSplit(p.split);
    setStyle((s) => ({ ...s, ...p.style }));
    setCustomFont(!FONTS.includes(p.style.font ?? style.font));
  };

  return (
    <>
      <div className="field">
        <span className="field-label">Préréglage</span>
        <Seg label="Préréglage" value={preset} onChange={applyPreset} options={PRESETS.map((p) => ({ id: p.id, label: p.label }))} />
      </div>
      <div className="editor-layout">
        <Preview video={video} cues={cues} style={style} onDims={setDims} />
        <div className="editor-panel">
          <div className="field">
            <span className="field-label">Découpage</span>
            <Seg label="Découpage" value={split.maxWords ? "words" : "sentences"} onChange={(v) => (setSplit(v === "words" ? { maxWords: 3, maxChars: 27 } : { maxWords: 0, maxChars: 84 }), setPreset(""))}
              options={[{ id: "sentences", label: "Phrases" }, { id: "words", label: "Mots" }]} />
            {split.maxWords > 0 && <input type="range" min={1} max={8} value={split.maxWords} aria-label="Mots par sous-titre" onChange={(e) => (setSplit({ maxWords: +e.target.value, maxChars: Math.max(14, +e.target.value * 9) }), setPreset(""))} />}
            <span className="muted">{split.maxWords ? `${split.maxWords} mot${split.maxWords > 1 ? "s" : ""} max. par sous-titre` : "Une phrase (ou un morceau) à la fois"} · {cues.length} sous-titres</span>
          </div>
          <label className="field">
            <span className="field-label">Police</span>
            <select className="input" value={customFont ? "*" : style.font} onChange={(e) => (e.target.value === "*" ? setCustomFont(true) : (setCustomFont(false), set("font", e.target.value)))}>
              {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
              <option value="*">Autre police installée…</option>
            </select>
          </label>
          {customFont && <label className="field"><span className="field-label">Nom exact de la police</span><input className="input" type="text" value={style.font} onChange={(e) => set("font", e.target.value)} /></label>}
          <label className="field"><span className="field-label">Taille : {style.size.toLocaleString("fr-FR")} % de la hauteur ({fontPx(style, dims.h)} px)</span><input type="range" min={2} max={15} step={0.5} value={style.size} onChange={(e) => set("size", +e.target.value)} /></label>
          <div className="row">
            <Toggle checked={style.bold} onChange={(v) => set("bold", v)}>Gras</Toggle>
            <Toggle checked={style.upper} onChange={(v) => set("upper", v)}>MAJUSCULES</Toggle>
          </div>
          <div className="field">
            <span className="field-label">Position</span>
            <Seg label="Position" value={style.position} onChange={(v) => set("position", v)} options={[{ id: "top", label: "Haut" }, { id: "middle", label: "Milieu" }, { id: "bottom", label: "Bas" }]} />
          </div>
          {style.position !== "middle" && <label className="field"><span className="field-label">Marge : {style.margin} %</span><input type="range" min={0} max={40} value={style.margin} onChange={(e) => set("margin", +e.target.value)} /></label>}
          <div className="row">
            <Color label="Texte" value={style.color} onChange={(v) => set("color", v)} />
            {!style.box && <Color label="Contour" value={style.outlineColor} onChange={(v) => set("outlineColor", v)} />}
            {style.box && <Color label="Bandeau" value={style.boxColor} onChange={(v) => set("boxColor", v)} />}
          </div>
          <Toggle checked={style.box} onChange={(v) => set("box", v)}>Bandeau derrière le texte</Toggle>
          {style.box
            ? <label className="field"><span className="field-label">Opacité du bandeau : {style.boxOpacity} %</span><input type="range" min={10} max={100} value={style.boxOpacity} onChange={(e) => set("boxOpacity", +e.target.value)} /></label>
            : <label className="field"><span className="field-label">Contour : {style.outline} %</span><input type="range" min={0} max={30} value={style.outline} onChange={(e) => set("outline", +e.target.value)} /></label>}
          <div className="row">
            <Toggle checked={!!style.highlight} onChange={(v) => set("highlight", v ? "#FFD400" : null)}>Surligner le mot prononcé</Toggle>
            {style.highlight && <Color label="" value={style.highlight} onChange={(v) => set("highlight", v)} />}
          </div>
          <label className="field" style={{ width: 180 }}>
            <span className="field-label">Décalage (secondes)</span>
            <input className="input" type="number" step={0.1} value={style.offset} onChange={(e) => set("offset", +e.target.value || 0)} />
          </label>
        </div>
      </div>
      <Burn
        video={video}
        prepare={() => saveTemp(`${stem(video)}.ass`, new TextEncoder().encode(toAss(cues, style, dims.w, dims.h)))}
        extra={srtSaved
          ? <span className="status-ok">✓ {basename(srtSaved)}</span>
          : <button className="btn" onClick={async () => setSrtSaved(await saveOutput(`${stem(video)}.srt`, new TextEncoder().encode(toSrt(cues, style))))}>Enregistrer le SRT</button>}
      />
    </>
  );
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field" style={{ width: "auto" }}>
      {label && <span className="field-label">{label}</span>}
      <input type="color" className="color-input" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label={label || "Couleur"} />
    </label>
  );
}

/** Vidéo + sous-titre courant dessiné par-dessus, à l'échelle de l'affichage. */
function Preview({ video, cues, style, onDims }: { video: string; cues: ReturnType<typeof group>; style: SubStyle; onDims: (d: { w: number; h: number }) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const [shown, setShown] = useState(360);
  useEffect(() => {
    let raf = 0;
    const tick = () => { if (ref.current) setT(ref.current.currentTime); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    const ro = new ResizeObserver(() => ref.current && setShown(ref.current.clientHeight));
    ro.observe(ref.current!);
    return () => (cancelAnimationFrame(raf), ro.disconnect());
  }, []);
  const a = activeAt(cues, t - style.offset);
  const h = ref.current?.videoHeight || 1080;
  const k = shown / h;
  // libass mesure la taille sur la hauteur de ligne ; le CSS sur le cadratin (≈ 1,15× plus grand).
  const fs = (fontPx(style, h) * k) / 1.15;
  const outline = style.box ? 0 : (fontPx(style, h) * style.outline * k) / 100;
  const up = (s: string) => (style.upper ? s.toLocaleUpperCase("fr-FR") : s);
  const hexA = (hex: string, o: number) => hex + Math.round((o / 100) * 255).toString(16).padStart(2, "0");
  return (
    <div className="canvas-frame" style={{ flexDirection: "column", alignItems: "center" }}>
      <div style={{ position: "relative", display: "inline-block" }}>
        <video ref={ref} src={convertFileSrc(video)} controls className="media-player" style={{ maxHeight: 460 }}
          onLoadedMetadata={(e) => { const v = e.currentTarget; onDims({ w: v.videoWidth, h: v.videoHeight }); setShown(v.clientHeight); }} />
        {a && (
          <div aria-hidden="true" style={{
            position: "absolute", left: "5%", right: "5%", pointerEvents: "none", display: "flex", justifyContent: "center", textAlign: "center",
            ...(style.position === "bottom" ? { bottom: `${style.margin}%` } : style.position === "top" ? { top: `${style.margin}%` } : { top: "50%", transform: "translateY(-50%)" }),
          }}>
            <span style={{
              fontFamily: `"${style.font}"`, fontSize: fs, fontWeight: style.bold ? 800 : 400, lineHeight: 1.15, color: style.color,
              WebkitTextStroke: outline ? `${outline * 2}px ${style.outlineColor}` : undefined, paintOrder: "stroke fill",
              background: style.box ? hexA(style.boxColor, style.boxOpacity) : undefined, padding: style.box ? `0 ${fs * 0.25}px` : undefined,
              boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone",
            }}>
              {style.highlight && a.cue.words.length > 1
                ? a.cue.words.map((w, i) => <span key={i} style={i === a.word ? { color: style.highlight! } : undefined}>{(i ? " " : "") + up(w.text)}</span>)
                : up(cueText(a.cue))}
            </span>
          </div>
        )}
      </div>
      <p className="muted" style={{ margin: "8px 0 0" }}>Aperçu fidèle à quelques pixels près ; lance la lecture pour voir le rythme.</p>
    </div>
  );
}
