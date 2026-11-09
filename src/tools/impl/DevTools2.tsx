// 91 Comparateur · 92 Regex · 93 Liens · 94 Coordonnées · 95 Unicode
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { diffLines, diffWordsWithSpace, type Change } from "diff";
import {
  cleanLink, findUrls, formatDistance, haversine, inspectChars, parseCoord, sanitizeText, toDms, type Coord,
} from "../logic/dev";
import type { RegexRequest, RegexResponse } from "../logic/regexWorker";
import { CopyButton, ErrorNote, Seg, TextField, Toggle } from "../../components/ui";

// ── 91 Comparateur ──────────────────────────────────────────────────────────

interface Row { left?: string; right?: string; ln?: number; rn?: number; kind: "same" | "del" | "add" | "mod" }

function buildRows(changes: Change[]): Row[] {
  const rows: Row[] = [];
  let ln = 1, rn = 1;
  const lines = (c: Change) => c.value.replace(/\n$/, "").split("\n");
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    if (!c.added && !c.removed) {
      for (const l of lines(c)) rows.push({ left: l, right: l, ln: ln++, rn: rn++, kind: "same" });
    } else if (c.removed && changes[i + 1]?.added) {
      const a = lines(c), b = lines(changes[i + 1]);
      for (let k = 0; k < Math.max(a.length, b.length); k++) {
        rows.push({ left: a[k], right: b[k], ln: a[k] !== undefined ? ln++ : undefined, rn: b[k] !== undefined ? rn++ : undefined, kind: "mod" });
      }
      i++;
    } else if (c.removed) {
      for (const l of lines(c)) rows.push({ left: l, ln: ln++, kind: "del" });
    } else {
      for (const l of lines(c)) rows.push({ right: l, rn: rn++, kind: "add" });
    }
  }
  return rows;
}

function WordDiff({ a, b, side }: { a: string; b: string; side: "left" | "right" }) {
  const parts = diffWordsWithSpace(a, b);
  return (
    <>
      {parts.map((p, i) =>
        p.added ? (side === "right" ? <span key={i} className="diff-add-word">{p.value}</span> : null)
        : p.removed ? (side === "left" ? <span key={i} className="diff-del-word">{p.value}</span> : null)
        : <Fragment key={i}>{p.value}</Fragment>,
      )}
    </>
  );
}

export function DiffChecker() {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [mode, setMode] = useState<"split" | "inline">("split");
  const [ignoreWs, setIgnoreWs] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const changes = useMemo(
    (): Change[] => (a || b ? diffLines(a, b, { ignoreWhitespace: ignoreWs, stripTrailingCr: true }) : []),
    [a, b, ignoreWs],
  );
  const rows = useMemo(() => buildRows(changes), [changes]);
  const added = changes.filter((c) => c.added).reduce((n, c) => n + (c.count ?? 0), 0);
  const removed = changes.filter((c) => c.removed).reduce((n, c) => n + (c.count ?? 0), 0);

  const load = async (set: (s: string) => void) => {
    const p = await open({ multiple: false });
    if (typeof p !== "string") return;
    try {
      set(await invoke<string>("read_text_file", { path: p }));
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <div className="tool-body">
      <div className="grid-2">
        <TextField label="Original" value={a} onChange={setA} rows={10} actions={<button className="btn btn-sm" onClick={() => load(setA)}>Ouvrir…</button>} />
        <TextField label="Modifié" value={b} onChange={setB} rows={10} actions={<button className="btn btn-sm" onClick={() => load(setB)}>Ouvrir…</button>} />
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      <div className="row">
        <Seg label="Affichage" value={mode} onChange={setMode} options={[{ id: "split", label: "Côte à côte" }, { id: "inline", label: "En ligne" }]} />
        <Toggle checked={ignoreWs} onChange={setIgnoreWs}>Ignorer les espaces</Toggle>
        {(a || b) && (
          <span style={{ marginLeft: "auto", fontWeight: 800 }}>
            {added || removed ? <><span className="status-ok">+{added}</span> · <span className="status-bad">−{removed}</span> lignes</> : <span className="status-ok">✓ Identiques</span>}
          </span>
        )}
      </div>
      {rows.length > 0 && (added > 0 || removed > 0) && (
        <div className={`table-wrap diff ${mode === "inline" ? "diff-inline" : ""}`}>
          {mode === "split"
            ? rows.map((r, i) => (
                <div key={i} className="diff-row">
                  <span className="diff-num">{r.ln ?? ""}</span>
                  <span className={`diff-cell ${r.left === undefined ? "diff-empty" : r.kind === "del" || r.kind === "mod" ? "diff-del" : ""}`}>
                    {r.kind === "mod" && r.left !== undefined && r.right !== undefined ? <WordDiff a={r.left} b={r.right} side="left" /> : r.left}
                  </span>
                  <span className="diff-num">{r.rn ?? ""}</span>
                  <span className={`diff-cell ${r.right === undefined ? "diff-empty" : r.kind === "add" || r.kind === "mod" ? "diff-add" : ""}`}>
                    {r.kind === "mod" && r.left !== undefined && r.right !== undefined ? <WordDiff a={r.left} b={r.right} side="right" /> : r.right}
                  </span>
                </div>
              ))
            : rows.flatMap((r, i) =>
                r.kind === "same"
                  ? [<div key={i} className="diff-row"><span className="diff-num">{r.ln}</span><span className="diff-num">{r.rn}</span><span className="diff-cell">{r.left}</span></div>]
                  : [
                      r.left !== undefined && <div key={`${i}l`} className="diff-row"><span className="diff-num">{r.ln}</span><span className="diff-num" /><span className="diff-cell diff-del">− {r.left}</span></div>,
                      r.right !== undefined && <div key={`${i}r`} className="diff-row"><span className="diff-num" /><span className="diff-num">{r.rn}</span><span className="diff-cell diff-add">+ {r.right}</span></div>,
                    ],
              )}
        </div>
      )}
    </div>
  );
}

// ── 92 Regex ────────────────────────────────────────────────────────────────

const FLAGS: { f: string; label: string }[] = [
  { f: "g", label: "Toutes (g)" }, { f: "i", label: "Sans casse (i)" }, { f: "m", label: "Multiligne (m)" },
  { f: "s", label: "Point = tout (s)" }, { f: "u", label: "Unicode (u)" },
];
const TIMEOUT_MS = 1500;

export function RegexTester() {
  const [pattern, setPattern] = useState("(\\w+)@(\\w+)\\.com");
  const [flags, setFlags] = useState("g");
  const [text, setText] = useState("contact@exemple.com, support@toolbox.com");
  const [replace, setReplace] = useState("");
  const [useReplace, setUseReplace] = useState(false);
  const [res, setRes] = useState<RegexResponse | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!pattern) return setRes(null);
    const id = ++seq.current;
    if (!worker.current) worker.current = new Worker(new URL("../logic/regexWorker.ts", import.meta.url), { type: "module" });
    const w = worker.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    w.onmessage = (e: MessageEvent<RegexResponse>) => {
      if (e.data.id !== seq.current) return;
      if (e.data.started) {
        // Le chrono démarre quand le worker commence vraiment (son premier chargement peut être lent).
        timer = setTimeout(() => {
          // Regex trop lente : on tue le worker, un nouveau sera créé au prochain essai.
          w.terminate();
          if (worker.current === w) worker.current = null;
          setTimedOut(true);
          setRes(null);
        }, TIMEOUT_MS);
        return;
      }
      clearTimeout(timer);
      setTimedOut(false);
      setRes(e.data);
    };
    w.postMessage({ id, pattern, flags, text, replace: useReplace ? replace : null } satisfies RegexRequest);
    return () => clearTimeout(timer);
  }, [pattern, flags, text, replace, useReplace]);

  useEffect(
    () => () => {
      worker.current?.terminate();
      worker.current = null;
    },
    [],
  );

  const highlighted = useMemo(() => {
    if (!res?.matches?.length) return text;
    const out: React.ReactNode[] = [];
    let pos = 0;
    res.matches.forEach((m, i) => {
      out.push(text.slice(pos, m.index));
      out.push(<mark key={i} className={i % 2 ? "alt" : undefined}>{m.text || "​"}</mark>);
      pos = m.end;
    });
    out.push(text.slice(pos));
    return out;
  }, [res, text]);

  return (
    <div className="tool-body">
      <div className="field">
        <span className="field-label">Expression régulière</span>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <span className="mono" style={{ fontSize: 22, fontWeight: 600 }}>/</span>
          <input className={`input mono ${res?.error ? "input-invalid" : ""}`} type="text" aria-label="Expression" value={pattern} onChange={(e) => setPattern(e.target.value)} />
          <span className="mono" style={{ fontSize: 22, fontWeight: 600 }}>/{flags}</span>
        </div>
      </div>
      <div className="row">
        {FLAGS.map(({ f, label }) => (
          <Toggle key={f} checked={flags.includes(f)} onChange={(on) => setFlags(on ? flags + f : flags.replace(f, ""))}>{label}</Toggle>
        ))}
      </div>
      {res?.error && <ErrorNote>{res.error}</ErrorNote>}
      {timedOut && <ErrorNote>Cette expression prend trop de temps (plus de {TIMEOUT_MS / 1000} s) : elle est probablement catastrophique.</ErrorNote>}
      <TextField label="Texte de test" value={text} onChange={setText} rows={6} />
      <div className="field">
        <div className="field-head">
          <span className="field-label">Correspondances</span>
          <span className="muted" style={{ fontWeight: 700 }}>{res?.matches ? `${res.matches.length}${res.truncated ? "+" : ""}` : "—"}</span>
        </div>
        <div className="result">{highlighted}</div>
      </div>
      {res?.matches && res.matches.some((m) => m.groups.length) && (
        <div className="table-wrap" style={{ maxHeight: 300, overflow: "auto" }}>
          <table className="data">
            <thead><tr><th>#</th><th>Correspondance</th>{res.matches[0].groups.map((_, i) => <th key={i}>Groupe {i + 1}</th>)}</tr></thead>
            <tbody>
              {res.matches.slice(0, 200).map((m, i) => (
                <tr key={i}><td>{i + 1}</td><td className="mono">{m.text}</td>{m.groups.map((g, k) => <td key={k} className="mono">{g ?? "—"}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Toggle checked={useReplace} onChange={setUseReplace}>Remplacer</Toggle>
      {useReplace && (
        <>
          <input className="input mono" type="text" aria-label="Remplacement" value={replace} onChange={(e) => setReplace(e.target.value)} placeholder="$1, $<nom>, $&…" />
          <TextField label="Aperçu" value={res?.replaced ?? ""} readOnly rows={6} actions={<CopyButton text={res?.replaced ?? ""} />} />
        </>
      )}
    </div>
  );
}

// ── 93 Liens ────────────────────────────────────────────────────────────────

export function CleanLinks() {
  const [text, setText] = useState("");
  const results = useMemo(() => [...new Set(findUrls(text))].map(cleanLink), [text]);
  const all = results.map((r) => r.cleaned).join("\n");
  const changed = results.filter((r) => r.cleaned !== r.original).length;
  return (
    <div className="tool-body">
      <TextField label="Liens ou texte" value={text} onChange={setText} rows={6} placeholder="Colle un ou plusieurs liens, ou un texte qui en contient" />
      {results.length > 0 && (
        <>
          <div className="row">
            <span style={{ fontWeight: 800 }}>{results.length} lien{results.length > 1 ? "s" : ""} · {changed} nettoyé{changed > 1 ? "s" : ""}</span>
            <span style={{ marginLeft: "auto" }} />
            <CopyButton text={all} label="Copier tous les liens" />
            <CopyButton text={results.reduce((t, r) => t.split(r.original).join(r.cleaned), text)} label="Copier le texte nettoyé" />
          </div>
          <ul className="list-mono">
            {results.map((r) => (
              <li key={r.original}>
                <span>
                  {r.cleaned}
                  {(r.removed.length > 0 || r.unwrapped > 0) && (
                    <><br /><small className="muted" style={{ fontFamily: "var(--font)" }}>
                      {r.unwrapped > 0 && `redirection retirée${r.unwrapped > 1 ? ` ×${r.unwrapped}` : ""}`}
                      {r.unwrapped > 0 && r.removed.length > 0 && " · "}
                      {r.removed.length > 0 && `retiré : ${r.removed.join(", ")}`}
                    </small></>
                  )}
                </span>
                <CopyButton text={r.cleaned} />
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted" style={{ margin: 0 }}>Les liens raccourcis (bit.ly, t.co…) ne sont pas suivis : Toolbox ne contacte aucun serveur.</p>
    </div>
  );
}

// ── 94 Coordonnées ──────────────────────────────────────────────────────────

export function CoordinatePicker() {
  const [text, setText] = useState("");
  const lines = text.split("\n").filter((l) => l.trim());
  const parsed = lines.map((l) => ({ line: l, c: parseCoord(l) }));
  const coords = parsed.map((p) => p.c).filter(Boolean) as Coord[];
  const total = coords.slice(1).reduce((s, c, i) => s + haversine(coords[i], c), 0);
  const csv = ["latitude,longitude", ...coords.map((c) => `${c.lat},${c.lng}`)].join("\n");

  return (
    <div className="tool-body">
      <TextField
        label="Coordonnées ou liens de carte (un par ligne)"
        value={text}
        onChange={setText}
        rows={6}
        placeholder={"https://www.google.com/maps/@48.8566,2.3522,13z\n45.764, 4.8357\n43°17′47″N 5°22′12″E"}
      />
      <p className="muted" style={{ margin: 0 }}>Liens Google Maps, OpenStreetMap, Bing, Apple Plans, geo:, coordonnées décimales ou en degrés-minutes-secondes.</p>
      {parsed.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>#</th><th>Latitude</th><th>Longitude</th><th>DMS</th><th>Distance</th><th /></tr></thead>
              <tbody>
                {parsed.map((p, i) => {
                  const idx = coords.indexOf(p.c!);
                  return p.c ? (
                    <tr key={i}>
                      <td>{idx + 1}</td>
                      <td className="mono">{p.c.lat.toFixed(6)}</td>
                      <td className="mono">{p.c.lng.toFixed(6)}</td>
                      <td className="mono">{toDms(p.c.lat, "N", "S")} {toDms(p.c.lng, "E", "O")}</td>
                      <td>{idx > 0 ? formatDistance(haversine(coords[idx - 1], p.c)) : "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <CopyButton text={`${p.c.lat}, ${p.c.lng}`} />{" "}
                        <a className="btn btn-sm btn-ghost" href={`https://www.openstreetmap.org/?mlat=${p.c.lat}&mlon=${p.c.lng}#map=15/${p.c.lat}/${p.c.lng}`} target="_blank" rel="noreferrer">Carte ↗</a>
                      </td>
                    </tr>
                  ) : (
                    <tr key={i}><td>✗</td><td colSpan={5} className="muted">Non reconnu : {p.line}</td></tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {coords.length > 1 && (
            <div className="row">
              <span style={{ fontWeight: 800 }}>Distance totale : {formatDistance(total)}</span>
              <span className="muted">à vol d'oiseau</span>
              <span style={{ marginLeft: "auto" }} />
              <CopyButton text={csv} label="Copier en CSV" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── 95 Unicode ──────────────────────────────────────────────────────────────

const FLAG_LABEL = { invisible: "invisible", bidi: "contrôle de sens", space: "espace spéciale", confusable: "sosie", control: "contrôle" };

export function UnicodeInspector() {
  const [text, setText] = useState("");
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const chars = useMemo(() => inspectChars(text), [text]);
  const flagged = chars.filter((c) => c.flag);
  const shown = (onlyFlagged ? flagged : chars).slice(0, 2000);
  const clean = useMemo(() => sanitizeText(text), [text]);
  return (
    <div className="tool-body">
      <TextField label="Texte" value={text} onChange={setText} rows={5} mono={false} />
      {chars.length > 0 && (
        <>
          <div className="row">
            <span style={{ fontWeight: 800 }}>{chars.length} caractère{chars.length > 1 ? "s" : ""}</span>
            {flagged.length > 0
              ? <span className="status-bad">{flagged.length} suspect{flagged.length > 1 ? "s" : ""}</span>
              : <span className="status-ok">✓ Rien de suspect</span>}
            <Toggle checked={onlyFlagged} onChange={setOnlyFlagged}>Seulement les suspects</Toggle>
            <span style={{ marginLeft: "auto" }} />
            {flagged.length > 0 && <CopyButton text={clean} label="Copier le texte nettoyé" />}
          </div>
          <div className="table-wrap" style={{ maxHeight: 460, overflow: "auto" }}>
            <table className="data">
              <thead><tr><th>Car.</th><th>Code</th><th>UTF-8</th><th>Type</th><th>Écriture</th><th>Alerte</th></tr></thead>
              <tbody>
                {shown.map((c, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ fontSize: 18 }}>{c.flag === "invisible" || c.flag === "bidi" || c.code < 33 ? "·" : c.char}</td>
                    <td className="mono">{c.hex}</td>
                    <td className="mono">{c.utf8}</td>
                    <td>{c.name ?? c.category}</td>
                    <td>{c.script ?? "—"}</td>
                    <td>{c.flag && <span className={`flag flag-${c.flag}`}>{FLAG_LABEL[c.flag]}{c.looksLike ? ` de « ${c.looksLike} »` : ""}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length >= 2000 && <p className="muted">Seuls les 2 000 premiers caractères sont affichés.</p>}
        </>
      )}
    </div>
  );
}
