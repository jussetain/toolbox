// Briques communes aux outils PDF : chargement + mot de passe, vignettes, liste ordonnable, enregistrement.
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { basename, readFileBytes, saveOutput, stem } from "../lib/io";
import { openPdf, renderPage, type PdfDoc } from "../lib/pdfjs";
import { ErrorNote } from "./ui";

export interface PdfFile {
  path: string;
  name: string;
  bytes: Uint8Array;
  doc: PdfDoc;
  pages: number;
  password?: string;
}

/** Charge un PDF ; demande le mot de passe s'il est protégé. */
export function usePdf(path: string | undefined) {
  const [file, setFile] = useState<PdfFile | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);

  const tryOpen = async (b: Uint8Array, password?: string) => {
    try {
      const doc = await openPdf(b, password);
      setFile({ path: path!, name: stem(path!), bytes: b, doc, pages: doc.numPages, password });
      setNeedsPassword(false);
      setError(null);
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === "PasswordException") {
        setNeedsPassword(true);
        if (password) setError("Mot de passe incorrect.");
      } else setError("Ce fichier n'est pas un PDF lisible.");
    }
  };

  useEffect(() => {
    setFile(null);
    setBytes(null);
    setNeedsPassword(false);
    setError(null);
    if (!path) return;
    readFileBytes(path).then((ab) => {
      const b = new Uint8Array(ab);
      setBytes(b);
      tryOpen(b);
    });
  }, [path]);

  return { file, needsPassword, error, unlock: (pw: string) => bytes && tryOpen(bytes, pw) };
}

export function PasswordGate({ pdf }: { pdf: ReturnType<typeof usePdf> }) {
  const [pw, setPw] = useState("");
  if (!pdf.needsPassword && !pdf.error) return null;
  return (
    <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      {pdf.needsPassword && (
        <form className="row" onSubmit={(e) => (e.preventDefault(), pdf.unlock(pw))}>
          <label className="field" style={{ flex: 1 }}>
            <span className="field-label">Ce PDF est protégé : mot de passe</span>
            <input className="input" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
          </label>
          <button className="btn" style={{ alignSelf: "flex-end" }} type="submit">Ouvrir</button>
        </form>
      )}
      {pdf.error && <ErrorNote>{pdf.error}</ErrorNote>}
    </div>
  );
}

/** Vignette de page rendue à la demande (quand elle devient visible). */
export function PageThumb({ doc, index, width = 150, rotate = 0 }: { doc: PdfDoc; index: number; width?: number; rotate?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    let done = false;
    const io = new IntersectionObserver((entries) => {
      if (done || !entries[0].isIntersecting) return;
      done = true;
      renderPage(doc, index, { width: width * 1.5, canvas: c }).catch(() => {});
    });
    io.observe(c);
    return () => io.disconnect();
  }, [doc, index, width]);
  return <canvas ref={ref} className="thumb" style={{ width, transform: `rotate(${rotate}deg)` }} />;
}

/** Bouton d'enregistrement + lien « Afficher » après coup. */
export function useSaver() {
  const [saved, setSaved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<{ name: string; bytes: Uint8Array }[]>) => {
    setBusy(true);
    setError(null);
    setSaved([]);
    try {
      const outs = await fn();
      const paths = [];
      for (const o of outs) paths.push(await saveOutput(o.name, o.bytes));
      setSaved(paths);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  const status = (
    <>
      {error && <ErrorNote>{error}</ErrorNote>}
      {saved.length > 0 && (
        <div className="row">
          <span className="status-ok">✓ {saved.length > 1 ? `${saved.length} fichiers enregistrés` : `Enregistré : ${basename(saved[0])}`}</span>
          <button className="btn btn-sm" onClick={() => api.reveal(saved[0])}>Afficher</button>
        </div>
      )}
    </>
  );
  return { run, busy, status, saved };
}

/** Liste ordonnable (boutons ↑ ↓) pour fusion et images vers PDF. */
export function OrderList({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  const move = (i: number, d: number) => {
    const next = items.slice();
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <ul className="list-mono">
      {items.map((p, i) => (
        <li key={p}>
          <span style={{ fontFamily: "var(--font)", fontWeight: 700, fontSize: 15 }}>{i + 1}. {basename(p)}</span>
          <button className="btn btn-sm btn-ghost" aria-label="Monter" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
          <button className="btn btn-sm btn-ghost" aria-label="Descendre" disabled={i === items.length - 1} onClick={() => move(i, 1)}>↓</button>
          <button className="btn btn-sm btn-ghost" onClick={() => onChange(items.filter((x) => x !== p))}>Retirer</button>
        </li>
      ))}
    </ul>
  );
}
