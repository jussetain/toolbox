// Vidéo (1–15) et audio (16, 18–20) — FFmpeg / yt-dlp.
import { useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { api, formatBytes, useJobs } from "../../lib/api";
import { basename } from "../../lib/io";
import { FileDrop } from "../../components/FileDrop";
import { JobRow } from "../../components/JobRow";
import { EngineGate } from "../../components/EngineGate";
import { BatchResults, type BatchResult } from "../../components/BatchResults";
import { OrderList } from "../../components/PdfParts";
import { ErrorNote, Seg, Toggle } from "../../components/ui";

const VIDEO = ["mp4", "mov", "m4v", "mkv", "webm", "avi", "wmv", "flv", "mts", "m2ts", "3gp"];
const AUDIO = ["mp3", "m4a", "wav", "flac", "aiff", "aif", "ogg", "opus", "aac", "wma"];

type Op = Record<string, unknown> & { op: string };

export const fmtTime = (s: number) => {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
};
export const parseTime = (t: string) => {
  const parts = t.trim().replace(",", ".").split(":").map(Number);
  if (parts.some(isNaN)) return NaN;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
};

/** Gabarit : dépôt de fichiers média, options, lancement, suivi. */
function MediaBatch({ tool, accept, op, action, multiple = true, children, label, ready = true }: {
  tool: string; accept: string[]; op: Op; action: string; multiple?: boolean; children?: (files: string[]) => React.ReactNode; label?: string; ready?: boolean;
}) {
  const [files, setFiles] = useState<string[]>([]);
  const { jobs, running, start, cancel } = useJobs<BatchResult>(tool);
  return (
    <EngineGate engines={["ffmpeg"]}>
      <div className="tool-body">
        <FileDrop files={files} onChange={setFiles} accept={accept} multiple={multiple} label={label ?? (multiple ? "Glisse tes fichiers ici" : "Glisse un fichier ici")} />
        {children?.(files)}
        <div className="tool-actions">
          <button className="btn btn-primary" disabled={!files.length || running || !ready} onClick={() => start(() => invoke<number>("media_process", { tool, paths: files, op }))}>{action} →</button>
        </div>
        {jobs.map((j) => (
          <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)}>
            {j.status === "done" && j.result && <BatchResults result={j.result} />}
          </JobRow>
        ))}
      </div>
    </EngineGate>
  );
}

/** Lecteur avec repères début/fin. */
function RangePlayer({ path, audio, start, end, onChange }: { path: string; audio?: boolean; start: number; end: number; onChange: (s: number, e: number) => void }) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [dur, setDur] = useState(0);
  const [startText, setStartText] = useState(fmtTime(start));
  const [endText, setEndText] = useState(fmtTime(end));
  useEffect(() => setStartText(fmtTime(start)), [start]);
  useEffect(() => setEndText(fmtTime(end)), [end]);
  const src = convertFileSrc(path);
  const Media = audio ? "audio" : "video";
  return (
    <div className="tool-body">
      <Media
        ref={ref}
        src={src}
        controls
        className="media-player"
        onLoadedMetadata={(e) => {
          const d = (e.target as HTMLMediaElement).duration;
          setDur(d);
          if (end === 0) onChange(0, d);
        }}
      />
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="field" style={{ width: 130 }}>
          <span className="field-label">Début</span>
          <input className="input mono" type="text" value={startText} onChange={(e) => setStartText(e.target.value)} onBlur={() => { const v = parseTime(startText); if (!isNaN(v)) onChange(Math.min(Math.max(0, v), dur), end); }} />
        </label>
        <button className="btn" onClick={() => onChange(ref.current!.currentTime, Math.max(end, ref.current!.currentTime))}>Début = position</button>
        <label className="field" style={{ width: 130 }}>
          <span className="field-label">Fin</span>
          <input className="input mono" type="text" value={endText} onChange={(e) => setEndText(e.target.value)} onBlur={() => { const v = parseTime(endText); if (!isNaN(v)) onChange(start, Math.min(Math.max(0, v), dur)); }} />
        </label>
        <button className="btn" onClick={() => onChange(Math.min(start, ref.current!.currentTime), ref.current!.currentTime)}>Fin = position</button>
        <span className="muted">Durée gardée : <strong>{fmtTime(Math.max(0, end - start))}</strong> sur {fmtTime(dur)}</span>
      </div>
    </div>
  );
}

// ── 6 Compresser ──
export function CompressVideo() {
  const [level, setLevel] = useState("balanced");
  const [height, setHeight] = useState(0);
  const [gpu, setGpu] = useState(true);
  return (
    <MediaBatch tool="compress-video" accept={VIDEO} action="Compresser" op={{ op: "compressVideo", level, height: height || null, gpu }}>
      {() => (
        <>
          <div className="row">
            <div className="field"><span className="field-label">Niveau</span><Seg label="Niveau" value={level} onChange={setLevel} options={[{ id: "light", label: "Léger" }, { id: "balanced", label: "Équilibré" }, { id: "strong", label: "Fort" }]} /></div>
            <div className="field"><span className="field-label">Résolution</span><Seg label="Résolution" value={height} onChange={setHeight} options={[{ id: 0, label: "Garder" }, { id: 1080, label: "1080p" }, { id: 720, label: "720p" }, { id: 480, label: "480p" }]} /></div>
          </div>
          <Toggle checked={gpu} onChange={setGpu}>Utiliser la carte graphique si possible (plus rapide)</Toggle>
        </>
      )}
    </MediaBatch>
  );
}

// ── 7 Convertir ──
export function ConvertVideo() {
  const [format, setFormat] = useState("mp4");
  return (
    <MediaBatch tool="convert-video" accept={VIDEO} action="Convertir" op={{ op: "convertVideo", format }}>
      {() => <Seg label="Format" value={format} onChange={setFormat} options={[{ id: "mp4", label: "MP4" }, { id: "mov", label: "MOV" }, { id: "webm", label: "WebM" }, { id: "m4v", label: "M4V" }]} />}
    </MediaBatch>
  );
}

// ── 8 Redimensionner ──
export function ResizeVideo() {
  const [w, setW] = useState(1280);
  const [h, setH] = useState(0);
  return (
    <MediaBatch tool="resize-video" accept={VIDEO} action="Redimensionner" op={{ op: "resizeVideo", width: w || null, height: h || null }}>
      {() => (
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="field" style={{ width: 150 }}><span className="field-label">Largeur</span><input className="input" type="number" min={0} value={w} onChange={(e) => setW(+e.target.value)} /></label>
          <label className="field" style={{ width: 150 }}><span className="field-label">Hauteur</span><input className="input" type="number" min={0} value={h} onChange={(e) => setH(+e.target.value)} /></label>
          <span className="muted">0 = proportionnel</span>
        </div>
      )}
    </MediaBatch>
  );
}

// ── 9 Recadrer et pivoter ──
export function CropRotateVideo() {
  const [rotate, setRotate] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [crop, setCrop] = useState<[number, number, number, number] | null>(null);
  return (
    <MediaBatch tool="crop-rotate-video" accept={VIDEO} multiple={false} action="Appliquer" op={{ op: "cropRotate", rotate, flipH, flipV, crop }} ready={!!(rotate || flipH || flipV || crop)}>
      {(files) => (
        <>
          <div className="row">
            <Seg label="Rotation" value={rotate} onChange={setRotate} options={[{ id: 0, label: "Aucune" }, { id: 90, label: "90° ↻" }, { id: 180, label: "180°" }, { id: 270, label: "90° ↺" }]} />
            <Toggle checked={flipH} onChange={setFlipH}>Miroir horizontal</Toggle>
            <Toggle checked={flipV} onChange={setFlipV}>Miroir vertical</Toggle>
          </div>
          {files[0] && <CropSelector path={files[0]} crop={crop} onChange={setCrop} />}
        </>
      )}
    </MediaBatch>
  );
}

function CropSelector({ path, crop, onChange }: { path: string; crop: [number, number, number, number] | null; onChange: (c: [number, number, number, number] | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const a = useRef<{ x: number; y: number } | null>(null);
  const at = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  return (
    <div className="tool-body">
      <div className="row"><span className="field-label">Recadrage : trace la zone à garder sur l'image</span>{crop && <button className="btn btn-sm" onClick={() => onChange(null)}>Retirer le recadrage</button>}</div>
      <div className="canvas-frame">
        <div ref={box} style={{ position: "relative", display: "inline-block", touchAction: "none", cursor: "crosshair" }}
          onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); a.current = at(e); }}
          onPointerMove={(e) => { if (!a.current) return; const b = at(e); const x = Math.min(a.current.x, b.x), y = Math.min(a.current.y, b.y); onChange([x, y, Math.abs(b.x - a.current.x), Math.abs(b.y - a.current.y)]); }}
          onPointerUp={() => { a.current = null; if (crop && (crop[2] < 0.02 || crop[3] < 0.02)) onChange(null); }}>
          <video src={convertFileSrc(path) + "#t=1"} className="media-player" style={{ pointerEvents: "none", maxHeight: 360 }} muted />
          {crop && <div className="crop-box" style={{ left: `${crop[0] * 100}%`, top: `${crop[1] * 100}%`, width: `${crop[2] * 100}%`, height: `${crop[3] * 100}%` }} />}
        </div>
      </div>
    </div>
  );
}

// ── 11 Couper ──
export function TrimVideo() {
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [precise, setPrecise] = useState(false);
  return (
    <MediaBatch tool="trim-video" accept={VIDEO} multiple={false} action="Couper" op={{ op: "trimVideo", start: range[0], end: range[1], precise }} ready={range[1] > range[0]}>
      {(files) => files[0] && (
        <>
          <RangePlayer key={files[0]} path={files[0]} start={range[0]} end={range[1]} onChange={(s, e) => setRange([s, e])} />
          <Toggle checked={precise} onChange={setPrecise}>Coupe à l'image près (réencode, plus lent)</Toggle>
          {!precise && <p className="muted" style={{ margin: 0 }}>Sans réencodage, la coupe se cale sur l'image clé la plus proche (à une ou deux secondes près).</p>}
        </>
      )}
    </MediaBatch>
  );
}

// ── 13 Couper le son ──
export const MuteVideo = () => <MediaBatch tool="mute-video" accept={VIDEO} action="Retirer le son" op={{ op: "muteVideo" }} />;

// ── 14 Remplacer l'audio ──
export function ReplaceAudio() {
  const [audio, setAudio] = useState<string[]>([]);
  const [mix, setMix] = useState(false);
  const [volume, setVolume] = useState(100);
  return (
    <MediaBatch tool="replace-audio" accept={VIDEO} multiple={false} label="Glisse la vidéo" action="Appliquer" op={{ op: "replaceAudio", audio: audio[0] ?? "", mix, volume: volume / 100 }} ready={!!audio[0]}>
      {() => (
        <>
          <div className="row">
            <button className="btn" onClick={async () => { const p = await open({ filters: [{ name: "Audio", extensions: [...AUDIO, ...VIDEO] }] }); if (typeof p === "string") setAudio([p]); }}>
              {audio[0] ? `Son : ${basename(audio[0])}` : "Choisir la musique ou la voix…"}
            </button>
            <Seg label="Mode" value={mix ? "mix" : "replace"} onChange={(v) => setMix(v === "mix")} options={[{ id: "replace", label: "Remplacer" }, { id: "mix", label: "Mixer avec l'original" }]} />
          </div>
          <label className="field" style={{ maxWidth: 360 }}><span className="field-label">Volume du nouveau son : {volume} %</span><input type="range" min={5} max={200} value={volume} onChange={(e) => setVolume(+e.target.value)} /></label>
        </>
      )}
    </MediaBatch>
  );
}

// ── 15 Vidéo vers GIF ──
export function VideoToGif() {
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [fps, setFps] = useState(12);
  const [width, setWidth] = useState(480);
  const dur = Math.min(range[1] - range[0], 30);
  return (
    <MediaBatch tool="video-to-gif" accept={VIDEO} multiple={false} action="Créer le GIF" op={{ op: "videoToGif", fps, width, start: range[0], duration: dur }} ready={dur > 0}>
      {(files) => files[0] && (
        <>
          <RangePlayer key={files[0]} path={files[0]} start={range[0]} end={range[1]} onChange={(s, e) => setRange([s, e])} />
          <div className="row">
            <Seg label="Fluidité" value={fps} onChange={setFps} options={[{ id: 8, label: "8 i/s" }, { id: 12, label: "12 i/s" }, { id: 20, label: "20 i/s" }]} />
            <Seg label="Largeur" value={width} onChange={setWidth} options={[{ id: 320, label: "320 px" }, { id: 480, label: "480 px" }, { id: 720, label: "720 px" }]} />
          </div>
          {range[1] - range[0] > 30 && <p className="muted" style={{ margin: 0 }}>Un GIF est limité à 30 secondes.</p>}
        </>
      )}
    </MediaBatch>
  );
}

// ── 3 Vitesse ──
export function ChangeSpeed() {
  const [factor, setFactor] = useState(2);
  return (
    <MediaBatch tool="change-speed" accept={VIDEO} action="Appliquer" op={{ op: "changeSpeed", factor }}>
      {() => <Seg label="Vitesse" value={factor} onChange={setFactor} options={[0.25, 0.5, 0.75, 1.25, 1.5, 2, 4].map((f) => ({ id: f, label: `${String(f).replace(".", ",")}×` }))} />}
    </MediaBatch>
  );
}

// ── 4 Extraire des images ──
export function ExtractFrames() {
  const [every, setEvery] = useState(1);
  const [format, setFormat] = useState("png");
  return (
    <MediaBatch tool="extract-frames" accept={VIDEO} action="Extraire" op={{ op: "extractFrames", every, format }}>
      {() => (
        <div className="row">
          <Seg label="Fréquence" value={every} onChange={setEvery} options={[{ id: 0.5, label: "2 par seconde" }, { id: 1, label: "1 par seconde" }, { id: 5, label: "toutes les 5 s" }, { id: 30, label: "toutes les 30 s" }]} />
          <Seg label="Format" value={format} onChange={setFormat} options={[{ id: "png", label: "PNG" }, { id: "jpg", label: "JPEG" }]} />
        </div>
      )}
    </MediaBatch>
  );
}

// ── 12 Fusionner ──
export function MergeVideos() {
  const [files, setFiles] = useState<string[]>([]);
  const { jobs, running, start, cancel } = useJobs<BatchResult>("merge-videos");
  return (
    <EngineGate engines={["ffmpeg"]}>
      <div className="tool-body">
        <FileDrop files={[]} onChange={(f) => setFiles([...files, ...f.filter((x) => !files.includes(x))])} accept={VIDEO} label="Glisse les clips à assembler" />
        {files.length > 0 && <OrderList items={files} onChange={setFiles} />}
        <p className="muted" style={{ margin: 0 }}>Les clips sont mis à la taille du premier ; les bandes noires complètent si les formats diffèrent.</p>
        <div className="tool-actions">
          <button className="btn btn-primary" disabled={files.length < 2 || running} onClick={() => start(() => invoke<number>("media_merge", { paths: files }))}>Fusionner →</button>
        </div>
        {jobs.map((j) => <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)}>{j.status === "done" && j.result && <BatchResults result={j.result} showSizes={false} />}</JobRow>)}
      </div>
    </EngineGate>
  );
}

// ── 10 Infos média ──
interface Stream { codec_type: string; codec_long_name?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string; bit_rate?: string; sample_rate?: string; channels?: number; channel_layout?: string; tags?: Record<string, string> }

export function MediaInfo() {
  const [files, setFiles] = useState<string[]>([]);
  const [info, setInfo] = useState<{ format: Record<string, string> & { tags?: Record<string, string> }; streams: Stream[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setInfo(null);
    if (files[0]) invoke<typeof info>("media_info", { path: files[0] }).then((i) => (setInfo(i), setErr(null))).catch((e) => setErr(String(e)));
  }, [files]);
  const fps = (r?: string) => { if (!r) return ""; const [a, b] = r.split("/").map(Number); return b ? `${(a / b).toFixed(2).replace(/\.00$/, "")} i/s` : r; };
  const rate = (b?: string) => (b ? `${Math.round(+b / 1000)} kb/s` : "");
  return (
    <EngineGate engines={["ffmpeg"]}>
      <div className="tool-body">
        <FileDrop files={files} onChange={setFiles} multiple={false} label="Glisse une vidéo ou un fichier audio" />
        {err && <ErrorNote>{err}</ErrorNote>}
        {info && (
          <>
            <dl className="kv card" style={{ padding: 16 }}>
              <dt>Conteneur</dt><dd>{info.format.format_long_name}</dd><span />
              <dt>Durée</dt><dd>{fmtTime(+info.format.duration)}</dd><span />
              <dt>Taille</dt><dd>{formatBytes(+info.format.size)}</dd><span />
              <dt>Débit total</dt><dd>{rate(info.format.bit_rate)}</dd><span />
              {Object.entries(info.format.tags ?? {}).slice(0, 8).map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{v}</dd><span /></div>)}
            </dl>
            {info.streams.map((s, i) => (
              <dl key={i} className="kv card" style={{ padding: 16 }}>
                <dt>Piste {i + 1}</dt><dd><strong>{{ video: "Vidéo", audio: "Audio", subtitle: "Sous-titres" }[s.codec_type] ?? s.codec_type}</strong> · {s.codec_long_name ?? s.codec_name}</dd><span />
                {s.width && (<><dt>Résolution</dt><dd>{s.width} × {s.height}</dd><span /></>)}
                {s.codec_type === "video" && (<><dt>Images/s</dt><dd>{fps(s.r_frame_rate)}</dd><span /></>)}
                {s.sample_rate && (<><dt>Échantillonnage</dt><dd>{+s.sample_rate / 1000} kHz · {s.channel_layout ?? `${s.channels} canaux`}</dd><span /></>)}
                {s.bit_rate && (<><dt>Débit</dt><dd>{rate(s.bit_rate)}</dd><span /></>)}
                {s.tags?.language && (<><dt>Langue</dt><dd>{s.tags.language}</dd><span /></>)}
              </dl>
            ))}
          </>
        )}
      </div>
    </EngineGate>
  );
}

// ── 1 Télécharger ──
export function DownloadVideo() {
  const [url, setUrl] = useState("");
  const [audio, setAudio] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { jobs, running, start, cancel } = useJobs<{ output: string; size: number }>("download-video");
  return (
    <EngineGate engines={["yt-dlp", "ffmpeg"]}>
      <div className="tool-body">
        <form className="row" onSubmit={async (e) => { e.preventDefault(); setErr(null); try { await start(() => invoke<number>("video_download", { url: url.trim(), audioOnly: audio })); } catch (x) { setErr(String(x)); } }}>
          <label className="field" style={{ flex: 1 }}>
            <span className="field-label">Lien de la vidéo</span>
            <input className="input" type="text" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <button className="btn btn-primary" style={{ alignSelf: "flex-end" }} disabled={!url.trim() || running} type="submit">Télécharger →</button>
        </form>
        <Seg label="Contenu" value={audio ? "audio" : "video"} onChange={(v) => setAudio(v === "audio")} options={[{ id: "video", label: "Vidéo (MP4)" }, { id: "audio", label: "Son seul (MP3)" }]} />
        <p className="muted" style={{ margin: 0 }}>Respecte les droits d'auteur et les conditions des plateformes : télécharge ce que tu as le droit de garder.</p>
        {err && <ErrorNote>{err}</ErrorNote>}
        {jobs.map((j) => (
          <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)}>
            {j.status === "done" && j.result && (
              <div className="row"><strong>{basename(j.result.output)}</strong><span className="muted">{formatBytes(j.result.size)}</span><button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => api.reveal(j.result!.output)}>Afficher</button></div>
            )}
          </JobRow>
        ))}
      </div>
    </EngineGate>
  );
}

// ── Audio ──
export function CleanAudio() {
  const [strength, setStrength] = useState("balanced");
  return (
    <MediaBatch tool="clean-audio" accept={[...AUDIO, ...VIDEO]} action="Nettoyer" op={{ op: "cleanAudio", strength }}>
      {() => (
        <>
          <Seg label="Intensité" value={strength} onChange={setStrength} options={[{ id: "light", label: "Douce" }, { id: "balanced", label: "Équilibrée" }, { id: "strong", label: "Forte" }]} />
          <p className="muted" style={{ margin: 0 }}>Réduit souffle et ronflement, coupe les graves parasites et égalise le volume. Pour une vidéo, l'image est gardée telle quelle.</p>
        </>
      )}
    </MediaBatch>
  );
}

export function TrimAudio() {
  const [range, setRange] = useState<[number, number]>([0, 0]);
  return (
    <MediaBatch tool="trim-audio" accept={AUDIO} multiple={false} action="Couper" op={{ op: "trimAudio", start: range[0], end: range[1] }} ready={range[1] > range[0]}>
      {(files) => files[0] && <RangePlayer key={files[0]} path={files[0]} audio start={range[0]} end={range[1]} onChange={(s, e) => setRange([s, e])} />}
    </MediaBatch>
  );
}

// ── Normaliser le volume ──
export function NormalizeAudio() {
  const [target, setTarget] = useState(-14);
  return (
    <MediaBatch tool="normalize-audio" accept={[...AUDIO, ...VIDEO]} action="Normaliser" op={{ op: "normalizeAudio", target }}>
      {() => (
        <>
          <div className="field">
            <span className="field-label">Destination</span>
            <Seg label="Destination" value={target} onChange={setTarget} options={[{ id: -14, label: "Web et réseaux (−14 LUFS)" }, { id: -16, label: "Podcast (−16 LUFS)" }, { id: -23, label: "TV (−23 LUFS)" }]} />
          </div>
          <p className="muted" style={{ margin: 0 }}>Les passages trop faibles sont remontés, les trop forts contenus, sans saturation. Pour une vidéo, l'image est gardée telle quelle.</p>
        </>
      )}
    </MediaBatch>
  );
}

const AUDIO_FORMATS = [{ id: "mp3", label: "MP3" }, { id: "m4a", label: "M4A" }, { id: "wav", label: "WAV" }, { id: "flac", label: "FLAC" }, { id: "aiff", label: "AIFF" }];

export function ExtractAudio() {
  const [format, setFormat] = useState("mp3");
  return (
    <MediaBatch tool="extract-audio" accept={VIDEO} action="Extraire" op={{ op: "extractAudio", format }}>
      {() => <Seg label="Format" value={format} onChange={setFormat} options={AUDIO_FORMATS} />}
    </MediaBatch>
  );
}

export function ConvertAudio() {
  const [format, setFormat] = useState("mp3");
  const [bitrate, setBitrate] = useState(192);
  return (
    <MediaBatch tool="convert-audio" accept={AUDIO} action="Convertir" op={{ op: "convertAudio", format, bitrate }}>
      {() => (
        <div className="row">
          <Seg label="Format" value={format} onChange={setFormat} options={AUDIO_FORMATS} />
          {(format === "mp3" || format === "m4a") && <Seg label="Débit" value={bitrate} onChange={setBitrate} options={[{ id: 128, label: "128 kb/s" }, { id: 192, label: "192 kb/s" }, { id: 320, label: "320 kb/s" }]} />}
        </div>
      )}
    </MediaBatch>
  );
}
