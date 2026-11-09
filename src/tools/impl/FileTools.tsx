// 64 QR code · 65 Renommage par lot · 66 Doublons · 67 Zip / Dézip · 68 Ranger les téléchargements
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import QRCode from "qrcode";
import { api, formatBytes, useJobs } from "../../lib/api";
import { basename, saveOutput } from "../../lib/io";
import { applyRules, DEFAULT_RULES, duplicates, type RenameRules } from "../logic/rename";
import { FileDrop } from "../../components/FileDrop";
import { JobRow } from "../../components/JobRow";
import { CopyButton, ErrorNote, Seg, TextField, Toggle } from "../../components/ui";

// ── 64 QR code ──────────────────────────────────────────────────────────────

type Ecc = "L" | "M" | "Q" | "H";
const wifiEscape = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");

export function QrCodeTool() {
  const [tab, setTab] = useState<"make" | "read">("make");
  const [kind, setKind] = useState<"text" | "wifi">("text");
  const [text, setText] = useState("https://");
  const [ssid, setSsid] = useState("");
  const [pass, setPass] = useState("");
  const [sec, setSec] = useState<"WPA" | "WEP" | "nopass">("WPA");
  const [ecc, setEcc] = useState<Ecc>("M");
  const [dark, setDark] = useState("#1f1b16");
  const [svg, setSvg] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [decoded, setDecoded] = useState<{ format: string; text: string }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const payload = kind === "wifi" ? `WIFI:T:${sec};S:${wifiEscape(ssid)};P:${sec === "nopass" ? "" : wifiEscape(pass)};;` : text;

  useEffect(() => {
    if (!payload.trim()) return setSvg("");
    QRCode.toString(payload, { type: "svg", errorCorrectionLevel: ecc, margin: 2, color: { dark, light: "#ffffff" } })
      .then((s) => (setSvg(s), setErr(null)))
      .catch((e) => setErr(String(e.message ?? e)));
    setSaved(null);
  }, [payload, ecc, dark]);

  const savePng = async () => {
    const url = await QRCode.toDataURL(payload, { errorCorrectionLevel: ecc, margin: 2, width: 1024, color: { dark, light: "#ffffff" } });
    const bytes = Uint8Array.from(atob(url.split(",")[1]), (c) => c.charCodeAt(0));
    setSaved(await saveOutput("qr-code.png", bytes));
  };
  const saveSvg = async () => setSaved(await saveOutput("qr-code.svg", new TextEncoder().encode(svg)));

  useEffect(() => {
    if (!files[0]) return;
    setDecoded(null);
    invoke<{ format: string; text: string }[]>("qr_decode", { path: files[0] }).then(setDecoded).catch((e) => setErr(String(e)));
  }, [files]);

  return (
    <div className="tool-body">
      <Seg label="Mode" value={tab} onChange={(t) => (setTab(t), setErr(null))} options={[{ id: "make", label: "Créer" }, { id: "read", label: "Lire" }]} />
      {tab === "make" ? (
        <div className="editor-layout">
          <div className="tool-body">
            <Seg label="Contenu" value={kind} onChange={setKind} options={[{ id: "text", label: "Texte ou lien" }, { id: "wifi", label: "Wi-Fi" }]} />
            {kind === "text" ? (
              <TextField label="Contenu" value={text} onChange={setText} rows={4} mono={false} />
            ) : (
              <>
                <label className="field"><span className="field-label">Nom du réseau (SSID)</span><input className="input" type="text" value={ssid} onChange={(e) => setSsid(e.target.value)} /></label>
                <label className="field"><span className="field-label">Mot de passe</span><input className="input" type="text" value={pass} onChange={(e) => setPass(e.target.value)} disabled={sec === "nopass"} /></label>
                <Seg label="Sécurité" value={sec} onChange={setSec} options={[{ id: "WPA", label: "WPA/WPA2/WPA3" }, { id: "WEP", label: "WEP" }, { id: "nopass", label: "Ouvert" }]} />
              </>
            )}
            <div className="field">
              <span className="field-label">Correction d'erreur</span>
              <Seg label="Correction" value={ecc} onChange={setEcc} options={[{ id: "L", label: "Faible" }, { id: "M", label: "Moyenne" }, { id: "Q", label: "Forte" }, { id: "H", label: "Maximale" }]} />
            </div>
            <div className="field">
              <span className="field-label">Couleur</span>
              <div className="swatches">
                {["#1f1b16", "#a33a12", "#1f4fa8", "#226b3c", "#5b36a8"].map((c) => (
                  <button key={c} className="swatch" style={{ background: c }} aria-pressed={dark === c} aria-label={`Couleur ${c}`} onClick={() => setDark(c)} />
                ))}
              </div>
            </div>
          </div>
          <div className="editor-panel" style={{ alignItems: "center" }}>
            {svg ? <div className="qr-preview" dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="muted">Saisis un contenu.</p>}
            <div className="row" style={{ justifyContent: "center" }}>
              <button className="btn" disabled={!svg} onClick={saveSvg}>SVG</button>
              <button className="btn btn-primary" disabled={!svg} onClick={savePng}>PNG →</button>
            </div>
            {saved && <button className="btn btn-ghost btn-sm" onClick={() => api.reveal(saved)}>✓ Enregistré — Afficher</button>}
          </div>
        </div>
      ) : (
        <>
          <FileDrop files={files} onChange={setFiles} multiple={false} accept={["png", "jpg", "jpeg", "webp", "gif", "bmp"]} label="Glisse une image contenant un code" />
          {decoded && (
            <ul className="list-mono">
              {decoded.map((d, i) => (
                <li key={i}><span><small className="muted">{d.format}</small><br />{d.text}</span><CopyButton text={d.text} /></li>
              ))}
            </ul>
          )}
        </>
      )}
      {err && <ErrorNote>{err}</ErrorNote>}
    </div>
  );
}

// ── 65 Renommage par lot ────────────────────────────────────────────────────

export function BatchRename() {
  const [files, setFiles] = useState<string[]>([]);
  const [r, setR] = useState<RenameRules>(DEFAULT_RULES);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof RenameRules>(k: K, v: RenameRules[K]) => (setR({ ...r, [k]: v }), setDone(null));

  const preview = useMemo(() => applyRules(files.map(basename), r), [files, r]);
  const dup = useMemo(() => duplicates(preview.map((p) => p.name)), [preview]);
  const changes = preview.filter((p, i) => p.name !== basename(files[i])).length;
  const blocked = preview.some((p) => p.error) || dup.size > 0;

  const apply = async () => {
    setErr(null);
    try {
      const n = await invoke<number>("rename_files", { items: files.map((f, i) => ({ from: f, to: preview[i].name })) });
      setFiles(files.map((f, i) => f.slice(0, f.length - basename(f).length) + preview[i].name));
      setR(DEFAULT_RULES);
      setDone(`${n} fichier${n > 1 ? "s" : ""} renommé${n > 1 ? "s" : ""}.`);
    } catch (e) {
      setErr(String(e));
    }
  };

  const text = (label: string, k: keyof RenameRules, w = 200) => (
    <label className="field" style={{ width: w }}>
      <span className="field-label">{label}</span>
      <input className="input" type="text" value={r[k] as string} onChange={(e) => set(k, e.target.value as never)} />
    </label>
  );

  return (
    <div className="tool-body">
      <FileDrop files={files} onChange={(f) => (setFiles(f), setDone(null))} label="Glisse les fichiers à renommer" />
      <div className="row" style={{ alignItems: "flex-end" }}>
        {text("Rechercher", "find")}
        {text("Remplacer par", "replace")}
        <Toggle checked={r.regex} onChange={(v) => set("regex", v)}>Regex</Toggle>
        <Toggle checked={r.matchCase} onChange={(v) => set("matchCase", v)}>Respecter la casse</Toggle>
      </div>
      <div className="row" style={{ alignItems: "flex-end" }}>
        {text("Nouveau nom", "newName")}
        {text("Préfixe", "prefix", 150)}
        {text("Suffixe", "suffix", 150)}
      </div>
      <div className="row">
        <Seg label="Casse" value={r.caseMode} onChange={(v) => set("caseMode", v)} options={[{ id: "keep", label: "Casse inchangée" }, { id: "lower", label: "minuscules" }, { id: "upper", label: "MAJUSCULES" }, { id: "title", label: "Titre" }]} />
        <Seg label="Extension" value={r.extension} onChange={(v) => set("extension", v)} options={[{ id: "keep", label: ".Ext inchangée" }, { id: "lower", label: ".ext" }, { id: "upper", label: ".EXT" }]} />
      </div>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <Toggle checked={r.numbering} onChange={(v) => set("numbering", v)}>Numéroter</Toggle>
        {r.numbering && (
          <>
            <label className="field" style={{ width: 100 }}><span className="field-label">Début</span><input className="input" type="number" value={r.numberStart} onChange={(e) => set("numberStart", +e.target.value)} /></label>
            <label className="field" style={{ width: 100 }}><span className="field-label">Chiffres</span><input className="input" type="number" min={1} max={8} value={r.numberPad} onChange={(e) => set("numberPad", +e.target.value)} /></label>
            <Seg label="Position" value={r.numberPosition} onChange={(v) => set("numberPosition", v)} options={[{ id: "prefix", label: "Avant" }, { id: "suffix", label: "Après" }]} />
          </>
        )}
      </div>
      {files.length > 0 && (
        <div className="table-wrap" style={{ maxHeight: 360, overflow: "auto" }}>
          <table className="data">
            <thead><tr><th>Avant</th><th>Après</th></tr></thead>
            <tbody>
              {files.map((f, i) => (
                <tr key={f}>
                  <td className="mono">{basename(f)}</td>
                  <td className="mono">
                    {preview[i].name}
                    {preview[i].error && <span className="status-bad"> — {preview[i].error}</span>}
                    {dup.has(i) && <span className="status-bad"> — en double</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {err && <ErrorNote>{err}</ErrorNote>}
      <div className="tool-actions">
        {done && <span className="status-ok">✓ {done}</span>}
        <button className="btn btn-primary" disabled={!changes || blocked} onClick={apply}>Renommer {changes || ""} →</button>
      </div>
    </div>
  );
}

// ── 66 Doublons ─────────────────────────────────────────────────────────────

interface DupGroup { size: number; files: { path: string; name: string; modified: number }[] }

export function FindDuplicates() {
  const [folders, setFolders] = useState<string[]>([]);
  const [minKb, setMinKb] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [trashed, setTrashed] = useState<Set<string>>(new Set());
  const { jobs, running, start, cancel } = useJobs<{ scanned: number; groups: DupGroup[] }>("find-duplicates");
  const last = jobs.find((j) => j.status === "done");

  useEffect(() => {
    // Par défaut : garder le plus ancien de chaque groupe, sélectionner les autres.
    if (last?.result) setSelected(new Set(last.result.groups.flatMap((g) => g.files.slice(1).map((f) => f.path))));
  }, [last?.id]);

  const pick = async () => {
    const d = await open({ directory: true, multiple: true });
    if (d) setFolders([...new Set([...folders, ...(Array.isArray(d) ? d : [d])])]);
  };
  const toggle = (p: string) => {
    const s = new Set(selected);
    s.has(p) ? s.delete(p) : s.add(p);
    setSelected(s);
  };
  const toTrash = [...selected].filter((p) => !trashed.has(p));
  const bytes = last?.result?.groups.reduce((s, g) => s + g.files.filter((f) => selected.has(f.path) && !trashed.has(f.path)).length * g.size, 0) ?? 0;

  const doTrash = async () => {
    await invoke("trash_files", { paths: toTrash });
    setTrashed(new Set([...trashed, ...toTrash]));
  };

  return (
    <div className="tool-body">
      <div className="row">
        <button className="btn" onClick={pick}>Choisir des dossiers…</button>
        <label className="field" style={{ width: 170 }}>
          <span className="sr-only">Taille minimale</span>
          <input className="input" type="number" min={0} value={minKb} onChange={(e) => setMinKb(+e.target.value)} aria-label="Taille minimale en Ko" />
        </label>
        <span className="muted">Ko minimum</span>
      </div>
      <FileDrop files={folders} onChange={setFolders} label="Ou glisse des dossiers ici" />
      <div className="tool-actions">
        <button className="btn btn-primary" disabled={!folders.length || running} onClick={() => (setTrashed(new Set()), start(() => invoke<number>("find_duplicates", { paths: folders, minSize: minKb * 1024 })))}>
          Chercher →
        </button>
      </div>
      {jobs.filter((j) => j.status !== "done" || j.id === last?.id).slice(0, 1).map((j) => (
        <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)}>
          {j.status === "done" && j.result && (
            j.result.groups.length === 0 ? <p style={{ margin: 0 }}>Aucun doublon parmi {j.result.scanned} fichiers.</p> : (
              <>
                <div className="row">
                  <strong>{j.result.groups.length} groupe{j.result.groups.length > 1 ? "s" : ""} de doublons · {j.result.scanned} fichiers analysés</strong>
                  <span style={{ marginLeft: "auto" }} />
                  <button className="btn btn-primary" disabled={!toTrash.length} onClick={doTrash}>
                    Mettre {toTrash.length} fichier{toTrash.length > 1 ? "s" : ""} à la corbeille ({formatBytes(bytes)})
                  </button>
                </div>
                {j.result.groups.slice(0, 300).map((g, gi) => (
                  <div key={gi} className="dup-group">
                    <span className="muted" style={{ fontWeight: 700 }}>{formatBytes(g.size)} × {g.files.length}</span>
                    {g.files.map((f) => (
                      <label key={f.path} className={`toggle dup-file ${trashed.has(f.path) ? "dup-trashed" : ""}`}>
                        <input type="checkbox" disabled={trashed.has(f.path)} checked={selected.has(f.path)} onChange={() => toggle(f.path)} />
                        <span className="mono" style={{ fontSize: 13 }}>{f.path}</span>
                        <span className="muted" style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>{new Date(f.modified * 1000).toLocaleDateString("fr-FR")}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </>
            )
          )}
        </JobRow>
      ))}
    </div>
  );
}

// ── 67 Zip / Dézip ──────────────────────────────────────────────────────────

export function ZipUnzip() {
  const [mode, setMode] = useState<"create" | "extract">("create");
  const [files, setFiles] = useState<string[]>([]);
  const [name, setName] = useState("archive");
  const [password, setPassword] = useState("");
  const { jobs, running, start, cancel } = useJobs<{ output: string; size?: number }>("zip-unzip");

  useEffect(() => setFiles([]), [mode]);
  useEffect(() => {
    if (mode === "create" && files.length === 1) setName(basename(files[0]).replace(/\.[^.]+$/, ""));
  }, [files, mode]);

  const run = () =>
    start(() =>
      mode === "create"
        ? invoke<number>("zip_create", { paths: files, name, password: password || null })
        : invoke<number>("archive_extract", { path: files[0], password: password || null }),
    );

  return (
    <div className="tool-body">
      <Seg label="Mode" value={mode} onChange={setMode} options={[{ id: "create", label: "Créer un ZIP" }, { id: "extract", label: "Extraire" }]} />
      {mode === "create" ? (
        <>
          <FileDrop files={files} onChange={setFiles} label="Glisse fichiers et dossiers à compresser" />
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label className="field" style={{ flex: 1 }}><span className="field-label">Nom de l'archive</span><input className="input" type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="field" style={{ flex: 1 }}><span className="field-label">Mot de passe (facultatif, AES-256)</span><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          </div>
        </>
      ) : (
        <>
          <FileDrop files={files} onChange={setFiles} multiple={false} accept={["zip", "7z", "tar", "gz", "tgz", "rar"]} label="Glisse une archive (ZIP, 7z, TAR, TAR.GZ)" />
          <label className="field" style={{ maxWidth: 420 }}><span className="field-label">Mot de passe (si l'archive est protégée)</span><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        </>
      )}
      <div className="tool-actions">
        <button className="btn btn-primary" disabled={!files.length || running} onClick={run}>{mode === "create" ? "Compresser" : "Extraire"} →</button>
      </div>
      {jobs.map((j) => (
        <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)}>
          {j.status === "done" && j.result && (
            <div className="row">
              <span className="mono selectable" style={{ fontSize: 13 }}>{j.result.output}</span>
              {j.result.size != null && <span className="muted">{formatBytes(j.result.size)}</span>}
              <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => api.reveal(j.result!.output)}>Afficher</button>
            </div>
          )}
        </JobRow>
      ))}
    </div>
  );
}

// ── 68 Ranger les téléchargements ───────────────────────────────────────────

interface DlItem { path: string; name: string; source: string | null }

export function OrganizeDownloads() {
  const [dir, setDir] = useState<string | null>(null);
  const [items, setItems] = useState<DlItem[] | null>(null);
  const [includeUnknown, setIncludeUnknown] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const scan = (d: string | null) =>
    invoke<{ dir: string; items: DlItem[] }>("downloads_scan", { dir: d }).then((r) => (setDir(r.dir), setItems(r.items), setErr(null))).catch((e) => setErr(String(e)));
  useEffect(() => void scan(null), []);

  const groups = useMemo(() => {
    const m = new Map<string, DlItem[]>();
    for (const it of items ?? []) {
      const k = it.source ?? "";
      m.set(k, [...(m.get(k) ?? []), it]);
    }
    return [...m.entries()].sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : b[1].length - a[1].length));
  }, [items]);

  const moves = (items ?? []).filter((i) => i.source || includeUnknown).map((i) => ({ path: i.path, folder: i.source ?? "Origine inconnue" }));

  const organize = async () => {
    try {
      const n = await invoke<number>("downloads_organize", { dir, moves });
      setDone(`${n} image${n > 1 ? "s" : ""} rangée${n > 1 ? "s" : ""}.`);
      scan(dir);
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <div className="tool-body">
      <div className="row">
        <span className="mono selectable" style={{ fontSize: 13 }}>{dir}</span>
        <button className="btn btn-sm" onClick={async () => { const d = await open({ directory: true }); if (typeof d === "string") scan(d); }}>Autre dossier…</button>
      </div>
      <p className="muted" style={{ margin: 0 }}>Windows note le site d'origine de chaque fichier téléchargé : Toolbox range les images dans un dossier par site.</p>
      {items && items.length === 0 && <p>Aucune image à ranger dans ce dossier.</p>}
      {groups.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Dossier créé</th><th>Images</th><th>Exemples</th></tr></thead>
            <tbody>
              {groups.map(([src, list]) => (
                <tr key={src} style={{ opacity: src || includeUnknown ? 1 : 0.5 }}>
                  <td><strong>{src || "Origine inconnue"}</strong></td>
                  <td>{list.length}</td>
                  <td className="mono">{list.slice(0, 3).map((i) => i.name).join(", ")}{list.length > 3 ? "…" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Toggle checked={includeUnknown} onChange={setIncludeUnknown}>Ranger aussi les images d'origine inconnue</Toggle>
      {err && <ErrorNote>{err}</ErrorNote>}
      <div className="tool-actions">
        {done && <span className="status-ok">✓ {done}</span>}
        {done && dir && <button className="btn btn-ghost btn-sm" onClick={() => api.reveal(dir)}>Ouvrir le dossier</button>}
        <button className="btn btn-primary" disabled={!moves.length} onClick={organize}>Ranger {moves.length || ""} image{moves.length > 1 ? "s" : ""} →</button>
      </div>
    </div>
  );
}
