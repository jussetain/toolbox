// 35 OCR PDF · 55 Transcrire · 56 Résumer · 57 Extraire le texte · 58 Capturer du texte
// 59 Traduire · 60 Synthèse vocale · 61 Interroger un document
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { api, formatBytes, useJobs } from "../../lib/api";
import { basename, readFileBytes, saveOutput, saveTemp, stem } from "../../lib/io";
import { canvasBytes, openPdf, renderPage } from "../../lib/pdfjs";
import { chunkText, documentText, formatSrt, parseSrt, rankPassages, runLlm, toPassages, type Msg, type Passage } from "../../lib/ai";
import { addTextLayer, type OcrWord } from "../logic/pdf";
import { FileDrop } from "../../components/FileDrop";
import { JobRow } from "../../components/JobRow";
import { EngineGate } from "../../components/EngineGate";
import { CopyButton, ErrorNote, Seg, TextField } from "../../components/ui";

/** Suivi en direct des générations de l'IA pour un outil. */
function LiveJob({ tool }: { tool: string }) {
  const { jobs, cancel } = useJobs(tool);
  return <>{jobs.filter((j) => j.status === "running").slice(0, 1).map((j) => <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)} />)}</>;
}

const DOCS = ["pdf", "docx", "txt", "md", "markdown", "html", "htm", "srt", "vtt"];
const LLM = ["llama", "llm-model"];

interface OcrResult { text: string; lines: { text: string; words: OcrWord[] }[]; width: number; height: number }

function useOcrLanguages() {
  const [langs, setLangs] = useState<{ tag: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void invoke<typeof langs>("ocr_languages").then(setLangs).catch((e) => setError(String(e))), []);
  return { langs, error };
}

function LangSelect({ value, onChange, langs }: { value: string; onChange: (v: string) => void; langs: { tag: string; name: string }[] }) {
  return (
    <label className="field" style={{ width: 260 }}>
      <span className="field-label">Langue du texte</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Langues de Windows (auto)</option>
        {langs.map((l) => <option key={l.tag} value={l.tag}>{l.name}</option>)}
      </select>
    </label>
  );
}

/** OCR des pages d'un PDF rendues en image. */
async function ocrPdfPages(path: string, lang: string, onPage: (i: number, n: number) => void) {
  const doc = await openPdf(new Uint8Array(await readFileBytes(path)));
  const out: OcrResult[] = [];
  for (let i = 0; i < doc.numPages; i++) {
    onPage(i + 1, doc.numPages);
    const c = await renderPage(doc, i, { scale: 2.5 });
    const tmp = await saveTemp(`ocr-${i}.png`, await canvasBytes(c, "image/png"));
    out.push(await invoke<OcrResult>("ocr_image", { path: tmp, language: lang || null }));
    c.width = c.height = 0;
  }
  return out;
}

// ── 57 Extraire le texte ──
export function ExtractText() {
  const [files, setFiles] = useState<string[]>([]);
  const [lang, setLang] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { langs, error } = useOcrLanguages();
  const run = async () => {
    setErr(null); setText("");
    try {
      const parts: string[] = [];
      for (const f of files) {
        if (f.toLowerCase().endsWith(".pdf")) {
          const pages = await ocrPdfPages(f, lang, (i, n) => setBusy(`${basename(f)} · page ${i}/${n}`));
          parts.push(pages.map((p) => p.lines.map((l) => l.text).join("\n")).join("\n\n"));
        } else {
          setBusy(basename(f));
          const r = await invoke<OcrResult>("ocr_image", { path: f, language: lang || null });
          parts.push(r.lines.map((l) => l.text).join("\n"));
        }
      }
      setText(parts.join("\n\n———\n\n"));
    } catch (e) { setErr(String(e)); }
    setBusy(null);
  };
  return (
    <div className="tool-body">
      {error && <ErrorNote>{error}</ErrorNote>}
      <FileDrop files={files} onChange={setFiles} accept={["png", "jpg", "jpeg", "bmp", "gif", "tif", "tiff", "pdf"]} label="Glisse des images, captures ou PDF scannés" />
      <div className="row" style={{ alignItems: "flex-end" }}>
        <LangSelect value={lang} onChange={setLang} langs={langs} />
        <button className="btn btn-primary" disabled={!files.length || !!busy} onClick={run}>{busy ? "Lecture…" : "Extraire le texte →"}</button>
        {busy && <span className="muted">{busy}</span>}
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      {text && <TextField label="Texte reconnu" value={text} onChange={setText} rows={14} mono={false} actions={<><CopyButton text={text} /><SaveText text={text} name={files[0] ? stem(files[0]) : "texte"} /></>} />}
    </div>
  );
}

function SaveText({ text, name, ext = "txt" }: { text: string; name: string; ext?: string }) {
  const [p, setP] = useState<string | null>(null);
  return p ? <button className="btn btn-sm btn-ghost" onClick={() => api.reveal(p)}>✓ Afficher</button> : <button className="btn btn-sm" onClick={async () => setP(await saveOutput(`${name}.${ext}`, new TextEncoder().encode(text)))}>Enregistrer</button>;
}

// ── 58 Capturer du texte ──
export function CaptureText() {
  const [lang, setLang] = useState("");
  const { langs, error } = useOcrLanguages();
  const { jobs, running, start, cancel } = useJobs<OcrResult>("capture-text");
  const last = jobs.find((j) => j.status === "done")?.result;
  const text = last?.lines.map((l) => l.text).join("\n") ?? "";
  useEffect(() => { if (text) navigator.clipboard.writeText(text); }, [text]);
  return (
    <div className="tool-body">
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="row" style={{ alignItems: "flex-end" }}>
        <LangSelect value={lang} onChange={setLang} langs={langs} />
        <button className="btn btn-primary" disabled={running} onClick={() => start(() => invoke<number>("capture_text", { language: lang || null }))}>Sélectionner une zone →</button>
      </div>
      <p className="muted" style={{ margin: 0 }}>L'outil Capture de Windows s'ouvre : entoure le texte, il est lu puis copié automatiquement.</p>
      {jobs.filter((j) => j.status !== "done").slice(0, 1).map((j) => <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)} />)}
      {last && (text ? <TextField label="Texte copié dans le presse-papiers ✓" value={text} readOnly rows={8} mono={false} actions={<CopyButton text={text} />} /> : <p>Aucun texte trouvé dans la zone.</p>)}
    </div>
  );
}

// ── 35 Rendre un PDF cherchable ──
export function OcrPdf() {
  const [files, setFiles] = useState<string[]>([]);
  const [lang, setLang] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { langs, error } = useOcrLanguages();
  const run = async () => {
    setErr(null); setSaved(null);
    try {
      const pages = await ocrPdfPages(files[0], lang, (i, n) => setBusy(`Page ${i} / ${n}`));
      setBusy("Assemblage…");
      const bytes = new Uint8Array(await readFileBytes(files[0]));
      const out = await addTextLayer(bytes, pages.map((p) => ({ words: p.lines.flatMap((l) => l.words), width: p.width, height: p.height })));
      setSaved(await saveOutput(`${stem(files[0])}-cherchable.pdf`, out));
    } catch (e) { setErr(String((e as Error).message ?? e)); }
    setBusy(null);
  };
  return (
    <div className="tool-body">
      {error && <ErrorNote>{error}</ErrorNote>}
      <FileDrop files={files} onChange={setFiles} multiple={false} accept={["pdf"]} label="Glisse un PDF scanné" />
      <div className="row" style={{ alignItems: "flex-end" }}>
        <LangSelect value={lang} onChange={setLang} langs={langs} />
        <button className="btn btn-primary" disabled={!files.length || !!busy} onClick={run}>{busy ? "Lecture…" : "Rendre cherchable →"}</button>
        {busy && <span className="muted">{busy}</span>}
      </div>
      <p className="muted" style={{ margin: 0 }}>Les pages restent identiques ; un calque de texte invisible permet de rechercher, sélectionner et copier.</p>
      {err && <ErrorNote>{err}</ErrorNote>}
      {saved && <div className="row"><span className="status-ok">✓ {basename(saved)}</span><button className="btn btn-sm" onClick={() => api.reveal(saved)}>Afficher</button></div>}
    </div>
  );
}

// ── 55 Transcrire ──
const SPEECH_LANGS = [{ id: "auto", label: "Détection auto" }, { id: "fr", label: "Français" }, { id: "en", label: "Anglais" }, { id: "es", label: "Espagnol" }, { id: "de", label: "Allemand" }, { id: "it", label: "Italien" }, { id: "pt", label: "Portugais" }];
export interface Transcript { text: string; txt: string; srt: string; vtt: string; json?: string }

export function TranscribeView({ path, onDone }: { path?: string; onDone?: (t: Transcript) => void }) {
  const [files, setFiles] = useState<string[]>(path ? [path] : []);
  const [lang, setLang] = useState("auto");
  const { jobs, running, start, cancel } = useJobs<Transcript>("transcribe");
  const done = jobs.find((j) => j.status === "done")?.result;
  useEffect(() => { if (done) onDone?.(done); }, [done]);
  return (
    <EngineGate engines={["ffmpeg", "whisper", "whisper-model"]}>
      <div className="tool-body">
        {!path && <FileDrop files={files} onChange={setFiles} multiple={false} label="Glisse un audio ou une vidéo" />}
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="field" style={{ width: 220 }}><span className="field-label">Langue parlée</span>
            <select className="input" value={lang} onChange={(e) => setLang(e.target.value)}>{SPEECH_LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select>
          </label>
          <button className="btn btn-primary" disabled={!files.length || running} onClick={() => start(() => invoke<number>("transcribe", { path: files[0], language: lang === "auto" ? "" : lang }))}>Transcrire →</button>
        </div>
        {jobs.filter((j) => j.status !== "done").slice(0, 1).map((j) => <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)} />)}
        {done && (
          <>
            <TextField label="Transcription" value={done.text} readOnly rows={12} mono={false} actions={<CopyButton text={done.text} />} />
            <div className="row">
              <span className="muted">Enregistrée en TXT, SRT (sous-titres) et VTT.</span>
              <button className="btn btn-sm" onClick={() => api.reveal(done.srt)}>Afficher les fichiers</button>
            </div>
          </>
        )}
      </div>
    </EngineGate>
  );
}
export const Transcribe = () => <TranscribeView />;

// ── 60 Synthèse vocale ──
interface Voice { id: string; name: string; language: string; default: boolean }
export function TextToSpeech() {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voice, setVoice] = useState("");
  const [rate, setRate] = useState(1);
  const [format, setFormat] = useState("mp3");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const { jobs, running, start, cancel } = useJobs<{ output: string; size: number }>("text-to-speech");
  useEffect(() => void invoke<Voice[]>("tts_voices").then((v) => (setVoices(v), setVoice(v.find((x) => x.default)?.id ?? v[0]?.id ?? ""))).catch((e) => setErr(String(e))), []);
  useEffect(() => { if (files[0]) documentText(files[0]).then((d) => setText(d.text)).catch((e) => setErr(String(e.message ?? e))); }, [files]);
  return (
    <div className="tool-body">
      <FileDrop files={files} onChange={setFiles} multiple={false} accept={["txt", "md", "pdf", "docx", "html"]} label="Glisse un document, ou écris ci-dessous" />
      <TextField label="Texte à lire" value={text} onChange={setText} rows={8} mono={false} />
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="field" style={{ minWidth: 280 }}><span className="field-label">Voix</span>
          <select className="input" value={voice} onChange={(e) => setVoice(e.target.value)}>{voices.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.language})</option>)}</select>
        </label>
        <label className="field" style={{ width: 220 }}><span className="field-label">Vitesse : {rate.toFixed(1).replace(".", ",")}×</span><input type="range" min={0.5} max={2} step={0.1} value={rate} onChange={(e) => setRate(+e.target.value)} /></label>
        <Seg label="Format" value={format} onChange={setFormat} options={[{ id: "mp3", label: "MP3" }, { id: "m4a", label: "M4A" }, { id: "wav", label: "WAV" }]} />
      </div>
      <p className="muted" style={{ margin: 0 }}>Plus de voix : Paramètres Windows › Heure et langue › Voix. MP3/M4A utilisent FFmpeg s'il est installé, sinon WAV.</p>
      {err && <ErrorNote>{err}</ErrorNote>}
      <div className="tool-actions">
        <button className="btn btn-primary" disabled={!text.trim() || running} onClick={() => start(() => invoke<number>("tts_synthesize", { text, voice: voice || null, rate, format, name: files[0] ? stem(files[0]) : "lecture" }))}>Créer l'audio →</button>
      </div>
      {jobs.map((j) => <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)}>{j.status === "done" && j.result && <div className="row"><strong>{basename(j.result.output)}</strong><span className="muted">{formatBytes(j.result.size)}</span><button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => api.reveal(j.result!.output)}>Afficher</button></div>}</JobRow>)}
    </div>
  );
}

// ── Saisie commune : document ou texte collé ──
function useDocInput() {
  const [files, setFiles] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [doc, setDoc] = useState<{ text: string; pages: string[] | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setDoc(null);
    if (files[0]) documentText(files[0]).then((d) => (setDoc(d), setErr(null))).catch((e) => setErr(String(e.message ?? e)));
  }, [files]);
  const current = files[0] ? doc : text.trim() ? { text, pages: null } : null;
  const ui = (
    <>
      <FileDrop files={files} onChange={setFiles} multiple={false} accept={DOCS} label="Glisse un document (PDF, Word, texte)" />
      {!files.length && <TextField label="Ou colle le texte" value={text} onChange={setText} rows={6} mono={false} />}
      {doc && <span className="muted">{doc.text.length.toLocaleString("fr-FR")} caractères{doc.pages ? ` · ${doc.pages.length} pages` : ""}</span>}
      {err && <ErrorNote>{err}</ErrorNote>}
    </>
  );
  return { ui, current, name: files[0] ? stem(files[0]) : "texte", ext: files[0]?.split(".").pop()?.toLowerCase() ?? "txt" };
}

/** Bouton « Arrêter » pour une génération en cours. */
function useLlmRun() {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const job = useRef<number | null>(null);
  const cancelled = useRef(false);
  const run = async (fn: (call: (tool: string, m: Msg[], onDelta?: (d: string) => void, maxTokens?: number) => Promise<string>) => Promise<void>) => {
    setErr(null);
    cancelled.current = false;
    try {
      await fn((tool, m, onDelta, maxTokens) => {
        if (cancelled.current) throw new Error("Annulé");
        return runLlm(tool, m, onDelta, { maxTokens, onJob: (id) => (job.current = id) });
      });
    } catch (e) {
      if (!cancelled.current) setErr(String((e as Error).message ?? e));
    }
    setBusy(null);
  };
  const stop = () => { cancelled.current = true; if (job.current != null) api.cancelJob(job.current); };
  return { busy, setBusy, err, run, stop };
}

// ── 56 Résumer ──
const SYS = "Tu es un assistant précis et concis. Tu réponds en français, sans inventer d'information absente du texte fourni.";
export function Summarize() {
  const input = useDocInput();
  const [length, setLength] = useState<"short" | "medium" | "long">("medium");
  const [style, setStyle] = useState<"bullets" | "prose">("bullets");
  const [out, setOut] = useState("");
  const llm = useLlmRun();
  const go = () => llm.run(async (call) => {
    const text = input.current!.text;
    const chunks = chunkText(text, 9000);
    const want = { short: "en 3 à 5 phrases", medium: "en 8 à 12 points ou phrases", long: "de façon détaillée, section par section" }[length];
    const form = style === "bullets" ? "sous forme de liste à puces" : "en paragraphes rédigés";
    let notes = text;
    if (chunks.length > 1) {
      const parts: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        llm.setBusy(`Lecture de la partie ${i + 1} / ${chunks.length}`);
        parts.push(await call("summarize", [{ role: "system", content: SYS }, { role: "user", content: `Prends des notes détaillées (faits, chiffres, décisions) sur cet extrait :\n\n${chunks[i]}` }], undefined, 700));
      }
      notes = parts.join("\n\n");
    }
    llm.setBusy("Rédaction du résumé…");
    setOut("");
    await call("summarize", [{ role: "system", content: SYS }, { role: "user", content: `Résume ce texte ${want}, ${form}. Commence directement par le résumé.\n\n${notes}` }], (d) => setOut((o) => o + d), 1500);
  });
  return (
    <EngineGate engines={LLM}>
      <div className="tool-body">
        {input.ui}
        <div className="row">
          <Seg label="Longueur" value={length} onChange={setLength} options={[{ id: "short", label: "Court" }, { id: "medium", label: "Moyen" }, { id: "long", label: "Détaillé" }]} />
          <Seg label="Forme" value={style} onChange={setStyle} options={[{ id: "bullets", label: "Points" }, { id: "prose", label: "Paragraphes" }]} />
        </div>
        <div className="tool-actions">
          {llm.busy && <><span className="muted">{llm.busy}</span><button className="btn btn-ghost" onClick={llm.stop}>Arrêter</button></>}
          <button className="btn btn-primary" disabled={!input.current || !!llm.busy} onClick={go}>Résumer →</button>
        </div>
        <LiveJob tool="summarize" />
        {llm.err && <ErrorNote>{llm.err}</ErrorNote>}
        {out && <TextField label="Résumé" value={out} readOnly rows={12} mono={false} actions={<><CopyButton text={out} /><SaveText text={out} name={`${input.name}-resume`} ext="md" /></>} />}
        <p className="muted" style={{ margin: 0 }}>Tout se passe sur ton PC (modèle Llama 3.2, Built with Llama). Vérifie les points importants dans le texte d'origine.</p>
      </div>
    </EngineGate>
  );
}

// ── 59 Traduire ──
const TARGETS = ["français", "anglais", "espagnol", "allemand", "italien", "portugais", "néerlandais", "polonais", "russe", "chinois", "japonais", "arabe"];
export function Translate() {
  const input = useDocInput();
  const [to, setTo] = useState("anglais");
  const [out, setOut] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const llm = useLlmRun();
  const sys = (extra = "") => `Tu es un traducteur professionnel. Traduis vers le ${to} en gardant le sens, le ton, la mise en forme (Markdown, listes, sauts de ligne) et les noms propres. Réponds uniquement par la traduction.${extra}`;
  const go = () => llm.run(async (call) => {
    setOut(""); setSaved(null);
    const isSrt = input.ext === "srt" || input.ext === "vtt";
    if (isSrt) {
      const blocks = parseSrt(input.current!.text);
      for (let i = 0; i < blocks.length; i += 25) {
        llm.setBusy(`Sous-titres ${i + 1}–${Math.min(i + 25, blocks.length)} / ${blocks.length}`);
        const batch = blocks.slice(i, i + 25);
        const src = batch.map((b, k) => `[${k + 1}] ${b.text.replace(/\n/g, " / ")}`).join("\n");
        const res = await call("translate", [{ role: "system", content: sys(" Garde exactement la numérotation [n] et une ligne par numéro ; « / » marque un retour à la ligne.") }, { role: "user", content: src }], undefined, 2000);
        const map = new Map([...res.matchAll(/^\[(\d+)\]\s*(.*)$/gm)].map((m) => [+m[1], m[2]]));
        batch.forEach((b, k) => { const t = map.get(k + 1); if (t) b.text = t.split(" / ").join("\n"); });
        setOut(formatSrt(blocks));
      }
      const name = `${input.name}.${to.slice(0, 2)}.srt`;
      setSaved(await saveOutput(name, new TextEncoder().encode(formatSrt(blocks))));
      return;
    }
    const chunks = chunkText(input.current!.text, 3500);
    let acc = "";
    for (let i = 0; i < chunks.length; i++) {
      llm.setBusy(chunks.length > 1 ? `Partie ${i + 1} / ${chunks.length}` : "Traduction…");
      let cur = "";
      const sep = i ? "\n\n" : "";
      const t = await call("translate", [{ role: "system", content: sys() }, { role: "user", content: chunks[i] }], (d) => { cur += d; setOut(acc + sep + cur); }, 3000);
      acc += sep + t;
      setOut(acc);
    }
  });
  return (
    <EngineGate engines={LLM}>
      <div className="tool-body">
        {input.ui}
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="field" style={{ width: 220 }}><span className="field-label">Traduire vers</span>
            <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>{TARGETS.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</select>
          </label>
          <span style={{ flex: 1 }} />
          {llm.busy && <><span className="muted">{llm.busy}</span><button className="btn btn-ghost" onClick={llm.stop}>Arrêter</button></>}
          <button className="btn btn-primary" disabled={!input.current || !!llm.busy} onClick={go}>Traduire →</button>
        </div>
        {input.ext === "srt" && <p className="muted" style={{ margin: 0 }}>Sous-titres : les horaires sont conservés à l'identique.</p>}
        <LiveJob tool="translate" />
        {llm.err && <ErrorNote>{llm.err}</ErrorNote>}
        {out && <TextField label="Traduction" value={out} readOnly rows={12} mono={false} actions={<><CopyButton text={out} />{!saved && <SaveText text={out} name={`${input.name}.${to.slice(0, 2)}`} />}</>} />}
        {saved && <div className="row"><span className="status-ok">✓ {basename(saved)}</span><button className="btn btn-sm" onClick={() => api.reveal(saved)}>Afficher</button></div>}
      </div>
    </EngineGate>
  );
}

// ── 61 Interroger un document ──
interface Turn { q: string; a: string; sources: Passage[] }
export function AskDocument() {
  const input = useDocInput();
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const llm = useLlmRun();
  const passages = input.current ? toPassages(input.current) : [];
  const ask = () => llm.run(async (call) => {
    const question = q.trim();
    setQ("");
    const top = rankPassages(passages, question, 5);
    const ctx = (top.length ? top : passages.slice(0, 3)).map((p, i) => `[Extrait ${i + 1}${p.page ? ` — page ${p.page}` : ""}]\n${p.text}`).join("\n\n");
    setTurns((t) => [...t, { q: question, a: "", sources: top }]);
    llm.setBusy("Recherche dans le document…");
    const history: Msg[] = turns.slice(-2).flatMap((t) => [{ role: "user" as const, content: t.q }, { role: "assistant" as const, content: t.a }]);
    await call("ask-document", [
      { role: "system", content: `${SYS} Réponds uniquement à partir des extraits fournis. Cite les pages entre crochets, par exemple [p. 3]. Si la réponse n'y est pas, dis-le clairement.` },
      ...history,
      { role: "user", content: `Extraits du document :\n\n${ctx}\n\nQuestion : ${question}` },
    ], (d) => setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: x.a + d } : x))), 900);
  });
  return (
    <EngineGate engines={LLM}>
      <div className="tool-body">
        {input.ui}
        {turns.map((t, i) => (
          <div key={i} className="qa">
            <p className="qa-q">{t.q}</p>
            <div className="qa-a selectable">{t.a || "…"}</div>
            {t.sources.some((s) => s.page) && <span className="muted" style={{ fontSize: 13 }}>Extraits utilisés : pages {[...new Set(t.sources.map((s) => s.page).filter(Boolean))].join(", ")}</span>}
          </div>
        ))}
        <form className="row" onSubmit={(e) => (e.preventDefault(), q.trim() && ask())}>
          <input className="input" style={{ flex: 1 }} type="text" aria-label="Question" placeholder={input.current ? "Pose une question sur le document…" : "Ajoute d'abord un document"} value={q} disabled={!input.current} onChange={(e) => setQ(e.target.value)} />
          {llm.busy ? <button type="button" className="btn btn-ghost" onClick={llm.stop}>Arrêter</button> : <button className="btn btn-primary" disabled={!input.current || !q.trim()} type="submit">Demander →</button>}
        </form>
        <LiveJob tool="ask-document" />
        {llm.err && <ErrorNote>{llm.err}</ErrorNote>}
      </div>
    </EngineGate>
  );
}
