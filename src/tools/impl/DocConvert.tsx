// 49 Convertir des documents · 50 Word→PDF · 51 PowerPoint→PDF · 52 Excel→PDF · 53 Page web→PDF · 54 Markdown→PDF
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";
import { api, formatBytes, useJobs } from "../../lib/api";
import { basename, readFileBytes, saveTemp, stem } from "../../lib/io";
import { FileDrop } from "../../components/FileDrop";
import { JobRow } from "../../components/JobRow";
import { EngineGate } from "../../components/EngineGate";
import { BatchResults, type BatchResult } from "../../components/BatchResults";
import { ErrorNote, Seg, TextField } from "../../components/ui";

export function ConvertDocuments() {
  const [files, setFiles] = useState<string[]>([]);
  const [to, setTo] = useState("docx");
  const { jobs, running, start, cancel } = useJobs<BatchResult>("convert-documents");
  return (
    <EngineGate engines={["pandoc"]}>
      <div className="tool-body">
        <FileDrop files={files} onChange={setFiles} accept={["docx", "odt", "rtf", "html", "htm", "md", "markdown", "txt", "epub", "tex"]} label="Glisse des documents (Word, OpenDocument, RTF, HTML, Markdown, texte)" />
        <div className="field">
          <span className="field-label">Convertir en</span>
          <Seg label="Format" value={to} onChange={setTo} options={[{ id: "docx", label: "Word" }, { id: "odt", label: "OpenDocument" }, { id: "rtf", label: "RTF" }, { id: "html", label: "HTML" }, { id: "md", label: "Markdown" }, { id: "txt", label: "Texte" }]} />
        </div>
        <div className="tool-actions">
          <button className="btn btn-primary" disabled={!files.length || running} onClick={() => start(() => invoke<number>("documents_convert", { paths: files, to }))}>Convertir →</button>
        </div>
        {jobs.map((j) => <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)}>{j.status === "done" && j.result && <BatchResults result={j.result} showSizes={false} />}</JobRow>)}
      </div>
    </EngineGate>
  );
}

function OfficeToPdf({ tool, kind, accept, app }: { tool: string; kind: string; accept: string[]; app: string }) {
  const [files, setFiles] = useState<string[]>([]);
  const { jobs, running, start, cancel } = useJobs<BatchResult>(tool);
  return (
    <div className="tool-body">
      <FileDrop files={files} onChange={setFiles} accept={accept} />
      <p className="muted" style={{ margin: 0 }}>Utilise {app} s'il est installé (rendu identique), sinon LibreOffice.</p>
      <div className="tool-actions">
        <button className="btn btn-primary" disabled={!files.length || running} onClick={() => start(() => invoke<number>("office_to_pdf", { tool, kind, paths: files }))}>Convertir en PDF →</button>
      </div>
      {jobs.map((j) => <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)}>{j.status === "done" && j.result && <BatchResults result={j.result} />}</JobRow>)}
    </div>
  );
}

export const WordToPdf = () => <OfficeToPdf tool="word-to-pdf" kind="word" app="Microsoft Word" accept={["doc", "docx", "rtf", "odt", "txt", "dotx"]} />;
export const PowerPointToPdf = () => <OfficeToPdf tool="powerpoint-to-pdf" kind="powerpoint" app="PowerPoint" accept={["ppt", "pptx", "odp", "pps", "ppsx"]} />;
export const ExcelToPdf = () => <OfficeToPdf tool="excel-to-pdf" kind="excel" app="Excel" accept={["xls", "xlsx", "ods", "csv", "xlsm"]} />;

function PdfJobs({ tool }: { tool: string }) {
  const { jobs, cancel } = useJobs<{ output: string; size: number }>(tool);
  return (
    <>
      {jobs.map((j) => (
        <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)}>
          {j.status === "done" && j.result && (
            <div className="row"><strong>{basename(j.result.output)}</strong><span className="muted">{formatBytes(j.result.size)}</span><button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => api.reveal(j.result!.output)}>Afficher</button></div>
          )}
        </JobRow>
      ))}
    </>
  );
}

export function WebpageToPdf() {
  const [url, setUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const { running, start } = useJobs("webpage-to-pdf");
  const go = async () => {
    setErr(null);
    let u = url.trim();
    if (!/^https?:\/\//.test(u)) u = "https://" + u;
    let name = "page";
    try { name = new URL(u).hostname.replace(/^www\./, ""); } catch { return setErr("Adresse invalide."); }
    try { await start(() => invoke<number>("html_to_pdf", { tool: "webpage-to-pdf", target: u, name })); } catch (e) { setErr(String(e)); }
  };
  return (
    <div className="tool-body">
      <form className="row" onSubmit={(e) => (e.preventDefault(), go())}>
        <label className="field" style={{ flex: 1 }}>
          <span className="field-label">Adresse de la page</span>
          <input className="input" type="text" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <button className="btn btn-primary" style={{ alignSelf: "flex-end" }} disabled={!url.trim() || running} type="submit">Enregistrer en PDF →</button>
      </form>
      <p className="muted" style={{ margin: 0 }}>La page est ouverte par Microsoft Edge en arrière-plan, sans tes cookies : les pages qui demandent une connexion apparaîtront déconnectées.</p>
      {err && <ErrorNote>{err}</ErrorNote>}
      <PdfJobs tool="webpage-to-pdf" />
    </div>
  );
}

const PRINT_CSS = `
@page { size: A4; margin: 22mm 20mm; }
body { font-family: "Segoe UI", system-ui, sans-serif; font-size: 11pt; line-height: 1.55; color: #1f1b16; }
h1, h2, h3 { line-height: 1.2; break-after: avoid; } h1 { font-size: 24pt; } h2 { font-size: 17pt; margin-top: 1.6em; } h3 { font-size: 13pt; }
code { font-family: Consolas, monospace; font-size: 9.5pt; background: #f3ede1; padding: 1px 4px; border-radius: 3px; }
pre { background: #f3ede1; padding: 10px 12px; border-radius: 6px; white-space: pre-wrap; break-inside: avoid; } pre code { background: none; padding: 0; }
blockquote { border-left: 3px solid #e2572b; margin-left: 0; padding-left: 14px; color: #5e5547; }
table { border-collapse: collapse; width: 100%; break-inside: avoid; } th, td { border: 1px solid #cfc6b4; padding: 5px 8px; text-align: left; } th { background: #f3ede1; }
img { max-width: 100%; } a { color: #a33a12; } hr { border: 0; border-top: 1px solid #cfc6b4; }`;

export function MarkdownToPdf() {
  const [files, setFiles] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const { running, start } = useJobs("markdown-to-pdf");
  const go = async () => {
    setErr(null);
    try {
      const md = files[0] ? new TextDecoder().decode(await readFileBytes(files[0])) : text;
      const name = files[0] ? stem(files[0]) : (md.match(/^#\s+(.+)$/m)?.[1] ?? "notes").slice(0, 60);
      const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${name}</title><style>${PRINT_CSS}</style></head><body>${await marked.parse(md)}</body></html>`;
      const tmp = await saveTemp(`${name}.html`, new TextEncoder().encode(html));
      await start(() => invoke<number>("html_to_pdf", { tool: "markdown-to-pdf", target: tmp, name }));
    } catch (e) {
      setErr(String(e));
    }
  };
  return (
    <div className="tool-body">
      <FileDrop files={files} onChange={setFiles} multiple={false} accept={["md", "markdown", "txt"]} label="Glisse un fichier Markdown" />
      {!files.length && <TextField label="Ou colle ton Markdown" value={text} onChange={setText} rows={10} />}
      {err && <ErrorNote>{err}</ErrorNote>}
      <div className="tool-actions">
        <button className="btn btn-primary" disabled={(!files.length && !text.trim()) || running} onClick={go}>Créer le PDF →</button>
      </div>
      <PdfJobs tool="markdown-to-pdf" />
    </div>
  );
}
