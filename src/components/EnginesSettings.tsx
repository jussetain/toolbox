import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useJobs } from "../lib/api";
import { JobRow } from "./JobRow";
import { ErrorNote } from "./ui";

interface Engine { id: string; name: string; installed: boolean; fromPath: boolean; sizeMb: number; license: string; own: boolean }

const USES: Record<string, string> = {
  ffmpeg: "Vidéo, audio, enregistrements d'écran et de voix",
  "yt-dlp": "Télécharger une vidéo",
  pandoc: "Convertir des documents",
  whisper: "Transcrire, sous-titres automatiques",
  "whisper-model": "Transcrire (modèle de reconnaissance vocale)",
  llama: "Résumer, Traduire, Interroger un document",
  "llm-model": "Résumer, Traduire, Interroger (modèle Llama 3.2, Built with Llama)",
  "rembg-model": "Supprimer l'arrière-plan",
};

const size = (mb: number) => (mb >= 1000 ? `${(mb / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Go` : `${mb} Mo`);

/** Réglages › Moteurs : choisir ce qui est téléchargé, ou le supprimer. */
export function EnginesSettings() {
  const [list, setList] = useState<Engine[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const { jobs, running, start, cancel } = useJobs("engine");
  const reload = () => invoke<Engine[]>("engine_list").then(setList).catch((e) => setErr(String(e)));
  useEffect(() => void reload(), []);
  useEffect(() => { if (jobs.some((j) => j.status !== "running")) reload(); }, [jobs]);

  const missing = list.filter((e) => !e.installed);
  const chosen = missing.filter((e) => selected.has(e.id));
  const toggle = (id: string) => { const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id); setSelected(s); };

  const install = async () => {
    setErr(null);
    for (const e of chosen) {
      try { await start(() => invoke<number>("engine_install", { id: e.id })); } catch (x) { setErr(String(x)); }
    }
    setSelected(new Set());
  };
  const remove = async (id: string) => { try { await invoke("engine_remove", { id }); reload(); } catch (x) { setErr(String(x)); } };

  return (
    <section className="setting" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <div>
        <h2 className="field-label">Moteurs</h2>
        <p className="muted">Certains outils s'appuient sur des moteurs libres, téléchargés une seule fois depuis leur page officielle. Choisis ceux à installer maintenant.</p>
      </div>
      <ul className="list-mono">
        {list.map((e) => (
          <li key={e.id}>
            {e.installed ? (
              <span style={{ fontFamily: "var(--font)" }}><strong>{e.name}</strong> <span className="status-ok">✓ {e.fromPath ? "déjà présent sur le PC" : "installé"}</span><br /><small className="muted">{USES[e.id]}</small></span>
            ) : (
              <label className="toggle" style={{ flex: 1, fontFamily: "var(--font)" }}>
                <input type="checkbox" checked={selected.has(e.id)} disabled={running} onChange={() => toggle(e.id)} />
                <span><strong>{e.name}</strong> <span className="muted">· {size(e.sizeMb)} · {e.license}</span><br /><small className="muted">{USES[e.id]}</small></span>
              </label>
            )}
            {e.own && <button className="btn btn-sm btn-ghost" disabled={running} onClick={() => remove(e.id)}>Supprimer</button>}
          </li>
        ))}
      </ul>
      <div className="row">
        {missing.length > 0 && <button className="btn btn-sm" disabled={running} onClick={() => setSelected(selected.size === missing.length ? new Set() : new Set(missing.map((e) => e.id)))}>{selected.size === missing.length ? "Tout désélectionner" : "Tout sélectionner"}</button>}
        <span style={{ marginLeft: "auto" }} />
        <button className="btn btn-primary" disabled={!chosen.length || running} onClick={install}>
          Installer {chosen.length ? `(${size(chosen.reduce((s, e) => s + e.sizeMb, 0))})` : ""} →
        </button>
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      {jobs.filter((j) => j.status !== "done").map((j) => <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)} />)}
    </section>
  );
}
