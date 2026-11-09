// Outils Système (69–84).
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import QRCode from "qrcode";
import { api, formatBytes, useJobs } from "../../lib/api";
import { basename } from "../../lib/io";
import { FileDrop } from "../../components/FileDrop";
import { JobRow } from "../../components/JobRow";
import { CopyButton, ErrorNote, Seg, Stat, Toggle } from "../../components/ui";

/** Charge une donnée système ; affiche l'erreur (ex. « Windows uniquement ») le cas échéant. */
function useLoad<T>(cmd: string, args?: Record<string, unknown>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => invoke<T>(cmd, args).then((d) => (setData(d), setError(null))).catch((e) => setError(String(e)));
  useEffect(() => void reload(), [cmd]);
  return { data, error, reload, setError };
}

const ago = (s: number) => new Intl.RelativeTimeFormat("fr", { numeric: "auto" }).format(-Math.round((Date.now() / 1000 - s) / 86400), "day");

// ── 69 Test de débit ──
interface Speed { downloadMbps: number; uploadMbps: number; idleMs: number; loadedMs: number; rpm: number }
export function SpeedTest() {
  const { jobs, running, start, cancel } = useJobs<Speed>("speed-test");
  const r = jobs.find((j) => j.status === "done")?.result;
  const verdict = (rpm: number) => (rpm > 1000 ? "Excellente" : rpm > 400 ? "Bonne" : rpm > 150 ? "Moyenne" : "Faible");
  return (
    <div className="tool-body">
      <div className="tool-actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn btn-primary" disabled={running} onClick={() => start(() => invoke<number>("speed_test"))}>{r ? "Relancer" : "Lancer le test"} →</button>
        <span className="muted">≈ 20 secondes · serveurs Cloudflare</span>
      </div>
      {jobs.filter((j) => j.status !== "done").slice(0, 1).map((j) => <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)} />)}
      {r && (
        <div className="stats">
          <Stat value={`${r.downloadMbps.toLocaleString("fr-FR")}`} label="Mbit/s descendant" />
          <Stat value={`${r.uploadMbps.toLocaleString("fr-FR")}`} label="Mbit/s montant" />
          <Stat value={`${Math.round(r.idleMs)} ms`} label="latence au repos" />
          <Stat value={`${Math.round(r.loadedMs)} ms`} label="latence en charge" />
          <Stat value={verdict(r.rpm)} label={`réactivité (${r.rpm} RPM)`} />
        </div>
      )}
      {r && <p className="muted" style={{ margin: 0 }}>La latence en charge compte pour les visios et les jeux : si elle explose pendant un téléchargement, la box met trop de données en file d'attente.</p>}
    </div>
  );
}

// ── 70 Explorateur de stockage ──
interface Scan { path: string; total: number; files: number; entries: { name: string; path: string; size: number; files: number; dir: boolean }[]; largest: { size: number; path: string }[]; disk: { free: number; total: number } | null }
interface Hog { id: string; label: string; detail: string; size: number; count: number }
export function StorageExplorer() {
  const [stack, setStack] = useState<string[]>([]);
  const { jobs, running, start, cancel } = useJobs<Scan>("storage-explorer");
  const hogs = useLoad<Hog[]>("storage_hogs");
  const [freed, setFreed] = useState<string | null>(null);
  const scan = (p: string) => {
    setStack((s) => { const i = s.indexOf(p); return i >= 0 ? s.slice(0, i + 1) : [...s, p]; });
    return start(() => invoke<number>("storage_scan", { path: p }));
  };
  const r = jobs.find((j) => j.status === "done")?.result;
  const home = navigator.userAgent.includes("Windows") ? "C:\\" : "/home";
  useEffect(() => void scan(home), []);
  return (
    <div className="tool-body">
      {hogs.data && hogs.data.some((h) => h.size > 0) && (
        <div className="cat-list">
          {hogs.data.filter((h) => h.size > 0).map((h) => (
            <div key={h.id} className="setting">
              <div><h2 className="field-label">{h.label} · {formatBytes(h.size)}</h2><p className="muted">{h.detail}</p></div>
              <button className="btn" onClick={async () => { const n = await invoke<number>("storage_clean", { id: h.id }); setFreed(`${formatBytes(n)} libérés.`); hogs.reload(); }}>Libérer</button>
            </div>
          ))}
          {freed && <span className="status-ok">✓ {freed}</span>}
        </div>
      )}
      <div className="row">
        {stack.map((p, i) => <button key={p} className="btn btn-sm" disabled={i === stack.length - 1} onClick={() => scan(p)}>{i === 0 ? p : basename(p)}</button>)}
        {r?.disk && <span className="muted" style={{ marginLeft: "auto" }}>{formatBytes(r.disk.free)} libres sur {formatBytes(r.disk.total)}</span>}
      </div>
      {jobs.filter((j) => j.status !== "done").slice(0, 1).map((j) => <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)} />)}
      {r && !running && (
        <>
          <div className="table-wrap" style={{ maxHeight: 440, overflow: "auto" }}>
            <table className="data">
              <thead><tr><th>Dossier</th><th>Taille</th><th style={{ width: "30%" }} /></tr></thead>
              <tbody>
                {r.entries.filter((e) => e.size > 0).slice(0, 200).map((e) => (
                  <tr key={e.path}>
                    <td>{e.dir ? <button className="btn btn-sm btn-ghost" onClick={() => scan(e.path)}>▸ {e.name}</button> : <span style={{ paddingLeft: 12 }}>{e.name}</span>}</td>
                    <td style={{ whiteSpace: "nowrap", fontWeight: 700 }}>{formatBytes(e.size)}</td>
                    <td><div className="bar"><div style={{ width: `${(e.size / (r.entries[0]?.size || 1)) * 100}%` }} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.largest.length > 0 && (
            <>
              <h2 className="eyebrow" style={{ margin: 0 }}>Plus gros fichiers</h2>
              <ul className="list-mono">
                {r.largest.slice(0, 12).map((f) => (
                  <li key={f.path}><span>{f.path}</span><strong style={{ whiteSpace: "nowrap" }}>{formatBytes(f.size)}</strong><button className="btn btn-sm btn-ghost" onClick={() => api.reveal(f.path)}>Afficher</button></li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── 71 Wi-Fi ──
interface Wifi { ssid: string; password: string | null; auth: string | null }
export function WifiPassword() {
  const { data, error } = useLoad<Wifi[]>("wifi_profiles");
  const [sel, setSel] = useState<Wifi | null>(null);
  const [svg, setSvg] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    if (!sel) return;
    const sec = !sel.password ? "nopass" : /WEP/i.test(sel.auth ?? "") ? "WEP" : "WPA";
    const esc = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");
    QRCode.toString(`WIFI:T:${sec};S:${esc(sel.ssid)};P:${esc(sel.password ?? "")};;`, { type: "svg", margin: 2, color: { dark: "#1f1b16", light: "#ffffff" } }).then(setSvg);
  }, [sel]);
  const list = (data ?? []).filter((w) => w.ssid.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="tool-body">
      {error && <ErrorNote>{error}</ErrorNote>}
      {data && (
        <div className="editor-layout">
          <div className="tool-body">
            <input className="input" type="text" placeholder="Filtrer les réseaux" aria-label="Filtrer" value={q} onChange={(e) => setQ(e.target.value)} />
            <ul className="list-mono">
              {list.map((w) => (
                <li key={w.ssid} style={sel?.ssid === w.ssid ? { background: "var(--select)" } : undefined}>
                  <span style={{ fontFamily: "var(--font)", fontWeight: 700, fontSize: 15 }}>{w.ssid}<br /><small className="mono muted">{w.password ?? "réseau ouvert"}</small></span>
                  {w.password && <CopyButton text={w.password} />}
                  <button className="btn btn-sm" onClick={() => setSel(w)}>QR</button>
                </li>
              ))}
            </ul>
          </div>
          <div className="editor-panel" style={{ alignItems: "center" }}>
            {sel ? <><strong>{sel.ssid}</strong><div className="qr-preview" dangerouslySetInnerHTML={{ __html: svg }} /><span className="muted" style={{ textAlign: "center" }}>Scanne avec l'appareil photo d'un téléphone pour te connecter.</span></> : <p className="muted">Choisis un réseau pour afficher son QR code.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 72 Batterie ──
interface Battery { present: boolean; percent?: number; ac?: boolean; designMwh?: number; fullMwh?: number; cycles?: number; healthPct?: number; name?: string; secondsLeft?: number }
export function BatteryHealth() {
  const { data, error } = useLoad<Battery>("battery_info");
  const wh = (m?: number) => (m ? `${(m / 1000).toFixed(1).replace(".", ",")} Wh` : "—");
  return (
    <div className="tool-body">
      {error && <ErrorNote>{error}</ErrorNote>}
      {data && !data.present && <p>Ce PC n'a pas de batterie.</p>}
      {data?.present && (
        <>
          <div className="stats">
            <Stat value={data.healthPct != null ? `${data.healthPct} %` : "—"} label="santé (capacité restante)" />
            <Stat value={data.cycles ?? "—"} label="cycles de charge" />
            <Stat value={data.percent != null ? `${data.percent} %` : "—"} label={data.ac ? "branché sur secteur" : "sur batterie"} />
            <Stat value={wh(data.fullMwh)} label="capacité actuelle" />
            <Stat value={wh(data.designMwh)} label="capacité d'origine" />
            {data.secondsLeft != null && <Stat value={`${Math.floor(data.secondsLeft / 3600)} h ${Math.round((data.secondsLeft % 3600) / 60)}`} label="autonomie estimée" />}
          </div>
          {data.healthPct != null && <p style={{ margin: 0 }}>{data.healthPct >= 80 ? "✓ Batterie en bonne santé." : data.healthPct >= 60 ? "Batterie usée : l'autonomie a nettement baissé." : "Batterie très usée : un remplacement est à envisager."}</p>}
        </>
      )}
    </div>
  );
}

// ── 73 Empêcher la veille ──
export function KeepAwake() {
  const st = useLoad<{ active: boolean; until?: number }>("keep_awake_status");
  const [minutes, setMinutes] = useState<number>(60);
  const [display, setDisplay] = useState(true);
  return (
    <div className="tool-body">
      {st.data?.active ? (
        <div className="card rec-card">
          <span className="rec-dot" style={{ background: "var(--ok)" }} aria-hidden="true" />
          <span style={{ fontSize: 20, fontWeight: 800 }}>{st.data.until ? `Éveillé jusqu'à ${new Date(st.data.until * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "Éveillé jusqu'à nouvel ordre"}</span>
          <button className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={async () => (await invoke("keep_awake_stop"), st.reload())}>Arrêter</button>
        </div>
      ) : (
        <>
          <Seg label="Durée" value={minutes} onChange={setMinutes} options={[{ id: 30, label: "30 min" }, { id: 60, label: "1 h" }, { id: 120, label: "2 h" }, { id: 240, label: "4 h" }, { id: 0, label: "Sans limite" }]} />
          <Toggle checked={display} onChange={setDisplay}>Garder aussi l'écran allumé</Toggle>
          <div className="tool-actions" style={{ justifyContent: "flex-start" }}>
            <button className="btn btn-primary" onClick={() => invoke("keep_awake_start", { minutes: minutes || null, display }).then(st.reload).catch((e) => st.setError(String(e)))}>Empêcher la veille →</button>
          </div>
        </>
      )}
      {st.error && <ErrorNote>{st.error}</ErrorNote>}
      <p className="muted" style={{ margin: 0 }}>Fonctionne tant que Toolbox tourne (même fenêtre fermée, depuis la zone de notification).</p>
    </div>
  );
}

// ── 74 Désinstaller ──
interface App { name: string; publisher?: string; version?: string; location?: string; size: number; uninstall: string; installDate?: string }
export function UninstallApp() {
  const { data, error, reload } = useLoad<App[]>("apps_list");
  const [q, setQ] = useState("");
  const [launched, setLaunched] = useState<string | null>(null);
  const list = useMemo(() => (data ?? []).filter((a) => `${a.name} ${a.publisher ?? ""}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  return (
    <div className="tool-body">
      {error && <ErrorNote>{error}</ErrorNote>}
      {data && (
        <>
          <input className="input" type="text" placeholder={`Rechercher parmi ${data.length} applications`} aria-label="Rechercher" value={q} onChange={(e) => setQ(e.target.value)} />
          {launched && <p className="status-ok" style={{ margin: 0 }}>Le programme de désinstallation de {launched} est lancé. Suis ses étapes, puis <button className="btn btn-sm" onClick={reload}>Actualiser la liste</button></p>}
          <div className="table-wrap" style={{ maxHeight: 520, overflow: "auto" }}>
            <table className="data">
              <thead><tr><th>Application</th><th>Éditeur</th><th>Taille</th><th /></tr></thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.name}>
                    <td><strong>{a.name}</strong>{a.version && <span className="muted"> {a.version}</span>}</td>
                    <td className="muted">{a.publisher ?? "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{a.size ? formatBytes(a.size) : "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {a.location && <button className="btn btn-sm btn-ghost" onClick={() => api.reveal(a.location!)}>Dossier</button>}
                      <button className="btn btn-sm" onClick={async () => { await invoke("app_uninstall", { command: a.uninstall }); setLaunched(a.name); }}>Désinstaller</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── 75 Mode présentation ──
export function PresentationMode() {
  const [on, setOn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toggle = async () => {
    try { await invoke("presentation_mode", { on: !on }); setOn(!on); setErr(null); } catch (e) { setErr(String(e)); }
  };
  return (
    <div className="tool-body">
      <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
        <li>Masque les icônes du bureau</li><li>Masque automatiquement la barre des tâches</li><li>Coupe les notifications</li><li>Empêche la veille et l'extinction de l'écran</li>
      </ul>
      <div className="tool-actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn btn-primary" onClick={toggle}>{on ? "Quitter le mode présentation" : "Activer le mode présentation →"}</button>
        {on && <span className="status-ok">✓ Actif — tout sera rétabli en le quittant</span>}
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
    </div>
  );
}

// ── 76 Nettoyer le clavier ──
export function CleanKeyboard() {
  const [seconds, setSeconds] = useState(60);
  const [black, setBlack] = useState(false);
  const [left, setLeft] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft(left - 1), 1000);
    if (left === 1 && black) getCurrentWindow().setFullscreen(false);
    return () => clearTimeout(id);
  }, [left]);
  const go = async () => {
    try {
      await invoke("keyboard_lock", { seconds });
      if (black) await getCurrentWindow().setFullscreen(true);
      setLeft(seconds);
      setErr(null);
    } catch (e) { setErr(String(e)); }
  };
  const stop = async () => { await invoke("keyboard_unlock"); setLeft(0); if (black) getCurrentWindow().setFullscreen(false); };
  if (left > 0 && black) return <div className="fullscreen-black" onDoubleClick={stop}><span>{left}</span><small>Double-clic pour arrêter</small></div>;
  return (
    <div className="tool-body">
      {left > 0 ? (
        <div className="card rec-card"><span className="rec-time">{left} s</span><span>Clavier verrouillé : nettoie !</span><button className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={stop}>Déverrouiller</button></div>
      ) : (
        <>
          <Seg label="Durée" value={seconds} onChange={setSeconds} options={[{ id: 30, label: "30 s" }, { id: 60, label: "1 min" }, { id: 120, label: "2 min" }]} />
          <Toggle checked={black} onChange={setBlack}>Écran noir (pour voir la poussière)</Toggle>
          <div className="tool-actions" style={{ justifyContent: "flex-start" }}><button className="btn btn-primary" onClick={go}>Verrouiller le clavier →</button></div>
          <p className="muted" style={{ margin: 0 }}>La souris reste utilisable pour déverrouiller avant la fin. Ctrl+Alt+Suppr reste actif (Windows le réserve).</p>
        </>
      )}
      {err && <ErrorNote>{err}</ErrorNote>}
    </div>
  );
}

// ── 77 Test de pixels morts ──
const PIXEL_COLORS = ["#ff0000", "#00ff00", "#0000ff", "#ffffff", "#000000", "#808080"];
export function DeadPixelTest() {
  const [i, setI] = useState<number | null>(null);
  const win = getCurrentWindow();
  const start = async () => { await win.setFullscreen(true); setI(0); };
  const end = async () => { setI(null); await win.setFullscreen(false); };
  useEffect(() => {
    if (i === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") end();
      else if (e.key === "ArrowLeft") setI((x) => ((x ?? 0) + PIXEL_COLORS.length - 1) % PIXEL_COLORS.length);
      else setI((x) => ((x ?? 0) + 1) % PIXEL_COLORS.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i]);
  if (i !== null) return <div className="fullscreen-color" style={{ background: PIXEL_COLORS[i] }} onClick={() => setI((i + 1) % PIXEL_COLORS.length)} />;
  return (
    <div className="tool-body">
      <p style={{ margin: 0 }}>L'écran se remplit de couleurs unies : cherche un point qui ne change pas de couleur (pixel mort ou bloqué).</p>
      <p className="muted" style={{ margin: 0 }}>Clic ou espace : couleur suivante · ← : précédente · Échap : quitter.</p>
      <div className="tool-actions" style={{ justifyContent: "flex-start" }}><button className="btn btn-primary" onClick={start}>Commencer →</button></div>
    </div>
  );
}

// ── 78 Éjecter ──
interface Drive { letter: string; kind: string; label: string; free?: number; total?: number }
export function EjectAll() {
  const { data, error, reload } = useLoad<Drive[]>("drives_list");
  const [res, setRes] = useState<{ letter: string; ok: boolean; error?: string }[] | null>(null);
  const ejectable = (data ?? []).filter((d) => d.kind !== "fixed");
  return (
    <div className="tool-body">
      {error && <ErrorNote>{error}</ErrorNote>}
      {data && ejectable.length === 0 && <p>Aucun disque amovible ni image disque monté.</p>}
      {ejectable.length > 0 && (
        <>
          <ul className="list-mono">
            {ejectable.map((d) => <li key={d.letter}><span style={{ fontFamily: "var(--font)", fontWeight: 700 }}>{d.letter} {d.label || (d.kind === "cdrom" ? "Lecteur optique / image disque" : "Disque amovible")}</span>{d.total ? <span className="muted">{formatBytes(d.total)}</span> : null}</li>)}
          </ul>
          <div className="tool-actions" style={{ justifyContent: "flex-start" }}>
            <button className="btn btn-primary" onClick={async () => { setRes(await invoke("drives_eject", { letters: ejectable.map((d) => d.letter) })); reload(); }}>Tout éjecter →</button>
          </div>
        </>
      )}
      {res && res.map((r) => <p key={r.letter} className={r.ok ? "status-ok" : "status-bad"} style={{ margin: 0 }}>{r.letter} : {r.ok ? "éjecté, tu peux le retirer" : `impossible (${r.error ?? "un fichier est encore ouvert ?"})`}</p>)}
    </div>
  );
}

// ── 79 Démarrage ──
interface Item { source: string; name: string; command: string; enabled: boolean; editable: boolean }
export function StartupItems() {
  const { data, error, reload, setError } = useLoad<Item[]>("startup_list");
  return (
    <div className="tool-body">
      {error && <ErrorNote>{error}</ErrorNote>}
      {data && (
        <div className="cat-list">
          {data.map((it) => (
            <div key={it.source + it.name} className="setting">
              <div style={{ minWidth: 0 }}>
                <h2 className="field-label">{it.name}</h2>
                <p className="muted mono" style={{ fontSize: 12, overflowWrap: "anywhere" }}>{it.command}</p>
              </div>
              <Toggle checked={it.enabled} onChange={(v) => invoke("startup_set", { source: it.source, name: it.name, enabled: v }).then(reload).catch((e) => setError(String(e)))}>
                {it.enabled ? "Activé" : "Désactivé"}{!it.editable && " (tous les utilisateurs)"}
              </Toggle>
            </div>
          ))}
        </div>
      )}
      <p className="muted" style={{ margin: 0 }}>Désactiver un élément ne le supprime pas : il ne se lance simplement plus à l'ouverture de session.</p>
    </div>
  );
}

// ── 80 Débloquer un fichier ──
interface Trust { blocked: boolean; zone: { zoneId?: string; hostUrl?: string; referrerUrl?: string } | null; signature: { status: string; signer?: string } | null }
export function UnblockFile() {
  const [files, setFiles] = useState<string[]>([]);
  const [info, setInfo] = useState<Trust | null>(null);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setInfo(null); setDone(false);
    if (files[0]) invoke<Trust>("file_trust", { path: files[0] }).then(setInfo).catch((e) => setErr(String(e)));
  }, [files]);
  const sig = info?.signature;
  return (
    <div className="tool-body">
      <FileDrop files={files} onChange={setFiles} multiple={false} label="Glisse le fichier que Windows bloque" />
      {info && (
        <dl className="kv card" style={{ padding: 16 }}>
          <dt>Provenance</dt><dd>{info.zone ? (info.zone.referrerUrl || info.zone.hostUrl || "Internet") : "Pas de marque « téléchargé depuis Internet »"}</dd><span />
          <dt>Signature</dt>
          <dd>{sig ? (sig.status === "Valid" ? <span className="status-ok">✓ Signé par {sig.signer}</span> : sig.status === "NotSigned" ? <span className="status-bad">Non signé</span> : <span className="status-bad">{sig.status}</span>) : "—"}</dd><span />
        </dl>
      )}
      {info && sig?.status !== "Valid" && info.blocked && <p className="status-bad" style={{ margin: 0 }}>Ce fichier n'est pas signé par un éditeur vérifié. Ne le débloque que si tu sais d'où il vient.</p>}
      {info?.blocked && !done && (
        <div className="tool-actions" style={{ justifyContent: "flex-start" }}>
          <button className="btn btn-primary" onClick={() => invoke("file_unblock", { path: files[0] }).then(() => setDone(true)).catch((e) => setErr(String(e)))}>Débloquer →</button>
        </div>
      )}
      {done && <span className="status-ok">✓ Débloqué : Windows ne l'empêchera plus de s'ouvrir.</span>}
      {err && <ErrorNote>{err}</ErrorNote>}
    </div>
  );
}

// ── 81 Autorisations ──
interface Perm { capability: string; app: string; key: string; value: string; lastUsed: number | null; packaged: boolean }
const CAP: Record<string, string> = { webcam: "Caméra", microphone: "Micro", location: "Position", screenshot: "Capture d'écran" };
export function ResetPermissions() {
  const { data, error, reload, setError } = useLoad<Perm[]>("privacy_list");
  const [cap, setCap] = useState("webcam");
  const list = (data ?? []).filter((p) => p.capability === cap).sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0));
  return (
    <div className="tool-body">
      {error && <ErrorNote>{error}</ErrorNote>}
      <Seg label="Accès" value={cap} onChange={setCap} options={Object.entries(CAP).map(([id, label]) => ({ id, label }))} />
      {data && (list.length === 0 ? <p>Aucune application n'a utilisé cet accès.</p> : (
        <ul className="list-mono">
          {list.map((p) => (
            <li key={p.key}>
              <span style={{ fontFamily: "var(--font)" }}><strong>{basename(p.app)}</strong> {p.value === "Deny" && <span className="status-bad">refusé</span>}<br /><small className="muted">{p.lastUsed ? `utilisé ${ago(p.lastUsed)}` : "jamais utilisé"} · {p.app}</small></span>
              <button className="btn btn-sm" onClick={() => invoke("privacy_reset", { key: p.key }).then(reload).catch((e) => setError(String(e)))}>Réinitialiser</button>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

// ── 82 Réglages cachés ──
interface Tweak { id: string; label: string; detail: string; enabled: boolean; restart: boolean }
export function HiddenSettings() {
  const { data, error, reload, setError } = useLoad<Tweak[]>("tweaks_list");
  const [dirty, setDirty] = useState(false);
  return (
    <div className="tool-body">
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="cat-list">
        {data?.map((t) => (
          <div key={t.id} className="setting">
            <div><h2 className="field-label">{t.label}</h2><p className="muted">{t.detail}</p></div>
            <Toggle checked={t.enabled} onChange={(v) => invoke("tweak_set", { id: t.id, enabled: v }).then(() => (reload(), t.restart && setDirty(true))).catch((e) => setError(String(e)))}>{t.enabled ? "Activé" : "Désactivé"}</Toggle>
          </div>
        ))}
      </div>
      {dirty && <div className="row"><span>Certains réglages s'appliquent après le redémarrage de l'Explorateur.</span><button className="btn" onClick={() => invoke("explorer_restart").then(() => setDirty(false))}>Redémarrer l'Explorateur</button></div>}
    </div>
  );
}

// ── 83 Écrans ──
interface Feature { value: number; max: number }
interface Monitor { index: number; name: string; brightness: Feature | null; contrast: Feature | null; volume: Feature | null }
export function DisplayControl() {
  const { data, error, setError } = useLoad<Monitor[]>("monitors_list");
  const [vals, setVals] = useState<Record<string, number>>({});
  const set = (m: number, code: number, v: number) => {
    setVals({ ...vals, [`${m}-${code}`]: v });
    invoke("monitor_set", { index: m, code, value: v }).catch((e) => setError(String(e)));
  };
  const slider = (m: Monitor, label: string, code: number, f: Feature | null) =>
    f && (
      <label className="field"><span className="field-label">{label} : {vals[`${m.index}-${code}`] ?? f.value}</span>
        <input type="range" min={0} max={f.max} value={vals[`${m.index}-${code}`] ?? f.value} onChange={(e) => set(m.index, code, +e.target.value)} /></label>
    );
  return (
    <div className="tool-body">
      {error && <ErrorNote>{error}</ErrorNote>}
      {data && data.every((m) => !m.brightness && !m.contrast) && <p>Aucun écran pilotable. Les écrans de portable ne sont pas concernés ; sur un écran externe, active « DDC/CI » dans son menu.</p>}
      {data?.filter((m) => m.brightness || m.contrast || m.volume).map((m) => (
        <div key={m.index} className="editor-panel">
          <h2 className="field-label" style={{ margin: 0, fontSize: 18 }}>{m.name || `Écran ${m.index + 1}`}</h2>
          {slider(m, "Luminosité", 0x10, m.brightness)}
          {slider(m, "Contraste", 0x12, m.contrast)}
          {slider(m, "Volume", 0x62, m.volume)}
        </div>
      ))}
    </div>
  );
}

// ── 84 Souris ──
interface Mouse { wheelLines: number; speed: number; accel: boolean; naturalScroll: boolean | null }
export function MouseFixes() {
  const { data, error, reload, setError } = useLoad<Mouse>("mouse_get");
  const [m, setM] = useState<Mouse | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => setM(data), [data]);
  const save = (next: Mouse) => { setM(next); invoke("mouse_set", { wheelLines: next.wheelLines, speed: next.speed, accel: next.accel }).catch((e) => setError(String(e))); };
  return (
    <div className="tool-body">
      {error && <ErrorNote>{error}</ErrorNote>}
      {m && (
        <>
          <label className="field" style={{ maxWidth: 460 }}><span className="field-label">Lignes par cran de molette : {m.wheelLines}</span><input type="range" min={1} max={15} value={m.wheelLines} onChange={(e) => save({ ...m, wheelLines: +e.target.value })} /></label>
          <label className="field" style={{ maxWidth: 460 }}><span className="field-label">Vitesse du pointeur : {m.speed}</span><input type="range" min={1} max={20} value={m.speed} onChange={(e) => save({ ...m, speed: +e.target.value })} /></label>
          <Toggle checked={m.accel} onChange={(v) => save({ ...m, accel: v })}>Accélération du pointeur (« précision améliorée »)</Toggle>
          <div className="setting">
            <div><h2 className="field-label">Défilement naturel (inversé)</h2><p className="muted">Comme sur un pavé tactile ou un Mac. Demande les droits administrateur ; débranche et rebranche la souris ensuite.</p></div>
            <Toggle checked={!!m.naturalScroll} onChange={(v) => invoke("mouse_natural_scroll", { enabled: v }).then(() => (setNote("Rebranche la souris (ou redémarre) pour appliquer."), reload())).catch((e) => setError(String(e)))}>{m.naturalScroll ? "Activé" : "Désactivé"}</Toggle>
          </div>
          {note && <span className="status-ok">{note}</span>}
        </>
      )}
    </div>
  );
}
