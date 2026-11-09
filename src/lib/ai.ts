// IA locale : appel du modèle avec réponse en flux, extraction de texte des documents, recherche d'extraits.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readFileBytes } from "./io";
import { openPdf } from "./pdfjs";
import type { JobState } from "./api";

export interface Msg { role: "system" | "user" | "assistant"; content: string }

/** Lance une génération ; `onDelta` reçoit le texte au fil de l'eau. Renvoie le texte final. */
export async function runLlm(tool: string, messages: Msg[], onDelta?: (d: string) => void, opts: { maxTokens?: number; temperature?: number; onJob?: (id: number) => void } = {}): Promise<string> {
  // On écoute avant de lancer : aucun événement n'est perdu.
  const pending: { id: number; delta: string }[] = [];
  let id = -1;
  let settle: { ok: (s: string) => void; ko: (e: Error) => void } | null = null;
  const jobs: JobState<{ text: string }>[] = [];
  const handleJob = (j: JobState<{ text: string }>) => {
    if (j.id !== id || !settle) return;
    if (j.status === "done") settle.ok(j.result?.text ?? "");
    if (j.status === "error") settle.ko(new Error(j.error ?? "Erreur de l'IA"));
    if (j.status === "cancelled") settle.ko(new Error("Annulé"));
  };
  const un1 = await listen<{ id: number; delta: string }>("llm-stream", ({ payload }) => (id === -1 ? pending.push(payload) : payload.id === id && onDelta?.(payload.delta)));
  const un2 = await listen<JobState<{ text: string }>>("job", ({ payload }) => (id === -1 ? jobs.push(payload) : handleJob(payload)));
  try {
    id = await invoke<number>("llm_chat", { tool, messages, maxTokens: opts.maxTokens ?? 1024, temperature: opts.temperature ?? 0.3 });
    opts.onJob?.(id);
    return await new Promise<string>((ok, ko) => {
      settle = { ok, ko };
      pending.filter((p) => p.id === id).forEach((p) => onDelta?.(p.delta));
      jobs.forEach(handleJob);
    });
  } finally {
    un1();
    un2();
  }
}

export interface DocText { text: string; pages: string[] | null }

/** Texte brut d'un document : PDF (par page), Word, ou texte. */
export async function documentText(path: string): Promise<DocText> {
  const ext = path.split(".").pop()?.toLowerCase();
  const bytes = new Uint8Array(await readFileBytes(path));
  if (ext === "pdf") {
    const doc = await openPdf(bytes);
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const c = await (await doc.getPage(i)).getTextContent();
      pages.push(c.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join("").replace(/[ \t]+\n/g, "\n").trim());
    }
    if (!pages.some((p) => p.length > 20)) throw new Error("Ce PDF ne contient pas de texte (scan) : passe-le d'abord dans « Rendre un PDF cherchable ».");
    return { text: pages.join("\n\n"), pages };
  }
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const r = await mammoth.extractRawText({ arrayBuffer: bytes.buffer as ArrayBuffer });
    return { text: r.value, pages: null };
  }
  let text = new TextDecoder().decode(bytes);
  if (ext === "html" || ext === "htm") text = new DOMParser().parseFromString(text, "text/html").body.innerText;
  return { text, pages: null };
}

/** Découpe en morceaux d'environ `size` caractères, sur des limites de paragraphes. */
export function chunkText(text: string, size: number): string[] {
  const paras = text.split(/\n\s*\n/);
  const out: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length > size) {
      out.push(cur);
      cur = "";
    }
    if (p.length > size) {
      for (let i = 0; i < p.length; i += size) out.push(p.slice(i, i + size));
    } else cur += (cur ? "\n\n" : "") + p;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const STOP = new Set("le la les un une des de du d l et ou en au aux a à est sont pour par sur dans que qui quoi ce cet cette ces il elle ils elles on nous vous je tu ne pas plus se sa son ses leur leurs avec comme mais the a an of to in is are and or for on with what which who how".split(" "));
const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const terms = (s: string) => norm(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOP.has(w)).map((w) => w.replace(/(s|x|es|ment)$/, ""));

export interface Passage { text: string; page: number | null }

/** Classement BM25 des passages pour une question. */
export function rankPassages(passages: Passage[], question: string, k = 5): Passage[] {
  const q = [...new Set(terms(question))];
  const docs = passages.map((p) => terms(p.text));
  const avg = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, docs.length);
  const df = new Map(q.map((t) => [t, docs.filter((d) => d.includes(t)).length]));
  const N = docs.length;
  const scored = docs.map((d, i) => {
    let s = 0;
    for (const t of q) {
      const f = d.filter((x) => x === t).length;
      if (!f) continue;
      const idf = Math.log(1 + (N - df.get(t)! + 0.5) / (df.get(t)! + 0.5));
      s += idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.length / avg))));
    }
    return { i, s };
  });
  return scored.sort((a, b) => b.s - a.s).slice(0, k).filter((x) => x.s > 0).map((x) => passages[x.i]);
}

export function toPassages(doc: DocText, size = 1200): Passage[] {
  if (doc.pages) return doc.pages.flatMap((p, i) => chunkText(p, size).map((text) => ({ text, page: i + 1 })));
  return chunkText(doc.text, size).map((text) => ({ text, page: null }));
}

// Sous-titres SRT

export interface SrtBlock { index: string; time: string; text: string }
export function parseSrt(s: string): SrtBlock[] {
  return s.replace(/\r/g, "").trim().split(/\n\s*\n/).map((b) => {
    const lines = b.split("\n");
    const t = lines.findIndex((l) => l.includes("-->"));
    return { index: lines.slice(0, Math.max(t, 0)).join(" ").trim(), time: lines[t] ?? "", text: lines.slice(t + 1).join("\n") };
  }).filter((b) => b.time);
}
export const formatSrt = (blocks: SrtBlock[]) => blocks.map((b, i) => `${b.index || i + 1}\n${b.time}\n${b.text}`).join("\n\n") + "\n";
