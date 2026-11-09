// 5 Enregistrer l'écran · 17 Enregistrer (et transcrire) l'audio
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useJobs } from "../../lib/api";
import { saveTemp } from "../../lib/io";
import { EngineGate } from "../../components/EngineGate";
import { JobRow } from "../../components/JobRow";
import { BatchResults, type BatchResult } from "../../components/BatchResults";
import { ErrorNote, Seg, Toggle } from "../../components/ui";
import { fmtTime } from "./MediaTools";
import { TranscribeView } from "./AiTools";

function pickMime(kind: "video" | "audio") {
  const list = kind === "video" ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"] : ["audio/webm;codecs=opus", "audio/webm"];
  return list.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

/** Enregistreur générique : démarre un flux, l'enregistre, puis le convertit avec FFmpeg. */
function useRecorder(tool: string, kind: "video" | "audio", format: string) {
  const [state, setState] = useState<"idle" | "recording" | "saving">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const streams = useRef<MediaStream[]>([]);
  const jobs = useJobs<BatchResult>(tool);

  useEffect(() => {
    if (state !== "recording") return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 250);
    return () => clearInterval(id);
  }, [state]);

  const start = async (stream: MediaStream, extra: MediaStream[] = []) => {
    streams.current = [stream, ...extra];
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream, { mimeType: pickMime(kind), videoBitsPerSecond: 8_000_000 });
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      setState("saving");
      try {
        const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
        const stamp = new Date().toLocaleTimeString("fr-FR").replace(/:/g, "h").slice(0, 5);
        const tmp = await saveTemp(`${kind === "video" ? "Enregistrement écran" : "Mémo vocal"} ${stamp}.webm`, bytes);
        await jobs.start(() => invoke<number>("media_process", { tool, paths: [tmp], op: { op: "convertRecording", format } }));
      } catch (e) {
        setError(String(e));
      }
      setState("idle");
    };
    stream.getTracks().forEach((t) => (t.onended = () => r.state === "recording" && r.stop()));
    r.start(1000);
    rec.current = r;
    setElapsed(0);
    setError(null);
    setState("recording");
  };
  const stop = () => rec.current?.state === "recording" && rec.current.stop();
  return { state, elapsed, error, setError, start, stop, jobs };
}

export function RecordScreen() {
  const [mic, setMic] = useState(false);
  const [sysAudio, setSysAudio] = useState(true);
  const r = useRecorder("record-screen", "video", "mp4");

  const go = async () => {
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: sysAudio });
      const extra: MediaStream[] = [];
      let stream = display;
      if (mic) {
        const m = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        extra.push(m);
        // Mélange son du système + micro dans une seule piste.
        const ctx = new AudioContext();
        const dest = ctx.createMediaStreamDestination();
        ctx.createMediaStreamSource(m).connect(dest);
        if (display.getAudioTracks().length) ctx.createMediaStreamSource(display).connect(dest);
        stream = new MediaStream([...display.getVideoTracks(), ...dest.stream.getAudioTracks()]);
        extra.push(display);
      }
      await r.start(stream, extra);
    } catch (e) {
      if ((e as Error).name !== "NotAllowedError") r.setError(String((e as Error).message ?? e));
    }
  };

  return (
    <EngineGate engines={["ffmpeg"]}>
      <div className="tool-body">
        {r.state === "recording" ? (
          <div className="card rec-card">
            <span className="rec-dot" aria-hidden="true" />
            <span className="rec-time">{fmtTime(r.elapsed)}</span>
            <button className="btn btn-primary" onClick={r.stop}>Arrêter</button>
          </div>
        ) : (
          <>
            <div className="row">
              <Toggle checked={sysAudio} onChange={setSysAudio}>Son de l'ordinateur</Toggle>
              <Toggle checked={mic} onChange={setMic}>Micro</Toggle>
            </div>
            <p className="muted" style={{ margin: 0 }}>Windows te demandera quel écran, quelle fenêtre ou quel onglet enregistrer.</p>
            <div className="tool-actions">
              <button className="btn btn-primary" disabled={r.state === "saving"} onClick={go}>{r.state === "saving" ? "Enregistrement…" : "Choisir et enregistrer →"}</button>
            </div>
          </>
        )}
        {r.error && <ErrorNote>{r.error}</ErrorNote>}
        {r.jobs.jobs.map((j) => <JobRow key={j.id} job={j} onCancel={() => r.jobs.cancel(j.id)}>{j.status === "done" && j.result && <BatchResults result={j.result} showSizes={false} />}</JobRow>)}
      </div>
    </EngineGate>
  );
}

export function RecordAudio() {
  const [format, setFormat] = useState("m4a");
  const [level, setLevel] = useState(0);
  const r = useRecorder("record-audio", "audio", format);
  const raf = useRef(0);

  const go = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(peak / 128);
        raf.current = requestAnimationFrame(tick);
      };
      tick();
      s.getTracks()[0].addEventListener("ended", () => (cancelAnimationFrame(raf.current), ctx.close()));
      await r.start(s);
    } catch (e) {
      r.setError((e as Error).name === "NotAllowedError" ? "Accès au micro refusé (Paramètres Windows › Confidentialité › Microphone)." : String((e as Error).message ?? e));
    }
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <EngineGate engines={["ffmpeg"]}>
      <div className="tool-body">
        {r.state === "recording" ? (
          <div className="card rec-card">
            <span className="rec-dot" aria-hidden="true" />
            <span className="rec-time">{fmtTime(r.elapsed)}</span>
            <div className="meter" aria-hidden="true"><div style={{ width: `${Math.min(100, level * 140)}%` }} /></div>
            <button className="btn btn-primary" onClick={() => (cancelAnimationFrame(raf.current), r.stop())}>Arrêter</button>
          </div>
        ) : (
          <>
            <Seg label="Format" value={format} onChange={setFormat} options={[{ id: "m4a", label: "M4A" }, { id: "mp3", label: "MP3" }, { id: "wav", label: "WAV" }]} />
            <div className="tool-actions">
              <button className="btn btn-primary" disabled={r.state === "saving"} onClick={go}>{r.state === "saving" ? "Enregistrement…" : "Enregistrer →"}</button>
            </div>
          </>
        )}
        {r.error && <ErrorNote>{r.error}</ErrorNote>}
        {r.jobs.jobs.map((j) => (
          <JobRow key={j.id} job={j} onCancel={() => r.jobs.cancel(j.id)}>
            {j.status === "done" && j.result && (
              <>
                <BatchResults result={j.result} showSizes={false} />
                {j.result.files[0]?.output && <TranscribeView key={j.result.files[0].output} path={j.result.files[0].output} />}
              </>
            )}
          </JobRow>
        ))}
      </div>
    </EngineGate>
  );
}
