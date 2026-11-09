import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useJobs } from "../lib/api";
import { JobRow } from "./JobRow";
import { ErrorNote } from "./ui";

interface Status { id: string; name: string; installed: boolean; fromPath: boolean; sizeMb: number; license: string }

/** Affiche l'outil si ses moteurs sont présents ; sinon propose de les télécharger une fois. */
export function EngineGate({ engines, children }: { engines: string[]; children: React.ReactNode }) {
  const [status, setStatus] = useState<Status[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { jobs, running, start, cancel } = useJobs("engine");

  const refresh = () => Promise.all(engines.map((id) => invoke<Status>("engine_status", { id }))).then(setStatus);
  useEffect(() => void refresh(), [engines.join()]);
  useEffect(() => {
    if (jobs.some((j) => j.status === "done")) refresh();
  }, [jobs]);

  if (!status) return null;
  const missing = status.filter((s) => !s.installed);
  if (!missing.length) return <>{children}</>;

  const install = async () => {
    setErr(null);
    for (const m of missing) {
      try {
        await start(() => invoke<number>("engine_install", { id: m.id }));
      } catch (e) {
        setErr(String(e));
      }
    }
  };

  return (
    <div className="card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
      <span className="stamp" style={{ alignSelf: "flex-start" }}>Une seule fois</span>
      <p style={{ margin: 0, fontSize: 17 }}>
        Cet outil utilise {missing.map((m) => <strong key={m.id}>{m.name}</strong>).reduce((a, b) => <>{a} et {b}</>)}, un moteur libre qui travaille sur ton PC.
        Toolbox le télécharge depuis sa page officielle (≈ {missing.reduce((s, m) => s + m.sizeMb, 0)} Mo), puis tout reste en local.
      </p>
      <div>
        <button className="btn btn-primary" disabled={running} onClick={install}>Installer →</button>
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      {jobs.filter((j) => j.status !== "done").map((j) => <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)} />)}
    </div>
  );
}
