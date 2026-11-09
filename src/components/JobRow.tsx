import { useEffect, useRef, useState } from "react";
import type { JobState } from "../lib/api";

const clock = (s: number) => {
  s = Math.max(0, Math.round(s));
  return s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Suivi d'une tâche : frise des étapes, détail en direct, barre (mesurée ou animée), temps écoulé et restant. */
export function JobRow({ job, onCancel, children }: { job: JobState; onCancel: () => void; children?: React.ReactNode }) {
  const pct = job.progress != null ? Math.round(job.progress * 100) : null;
  const t0 = useRef(Date.now());
  const stageT0 = useRef({ stage: job.stage, at: Date.now() });
  const [now, setNow] = useState(Date.now());
  const [finishedIn, setFinishedIn] = useState<number | null>(null);

  useEffect(() => {
    if (job.status !== "running") {
      if (finishedIn === null) setFinishedIn((Date.now() - t0.current) / 1000);
      return;
    }
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [job.status]);
  if (stageT0.current.stage !== job.stage) stageT0.current = { stage: job.stage, at: Date.now() };

  const elapsed = (now - t0.current) / 1000;
  const inStage = (now - stageT0.current.at) / 1000;
  const remaining = job.progress != null && job.progress > 0.03 && inStage > 2 ? (inStage * (1 - job.progress)) / job.progress : null;
  const running = job.status === "running";

  return (
    <div className={`job job-${job.status}`}>
      {job.stages.length > 1 && (
        <ol className="stepper" aria-label="Étapes">
          {job.stages.map((s, i) => {
            const state = !running && job.status === "done" ? "done" : i < job.stage ? "done" : i === job.stage ? (running ? "current" : "failed") : "todo";
            return (
              <li key={s} className={`step step-${state}`} aria-current={state === "current" ? "step" : undefined}>
                <span className="step-dot" aria-hidden="true">{state === "done" ? "✓" : i + 1}</span>
                {s}
              </li>
            );
          })}
        </ol>
      )}
      <div className="job-head">
        <span className={`job-dot job-dot-${job.status}`} aria-hidden="true">
          {job.status === "done" && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>
          )}
        </span>
        <span className="job-label">
          {running && (job.label ?? "Démarrage…")}
          {job.status === "done" && `Terminé${finishedIn != null ? ` en ${clock(finishedIn)}` : ""}`}
          {job.status === "cancelled" && "Annulé"}
          {job.status === "error" && <span role="alert">Erreur : {job.error}</span>}
        </span>
        {running && (
          <>
            {pct != null && <span className="job-pct">{pct} %</span>}
            <button className="btn btn-ghost btn-sm" onClick={onCancel}>Annuler</button>
          </>
        )}
      </div>
      {running && (
        <>
          <div className={`progress ${pct == null ? "progress-indeterminate" : ""}`} role="progressbar" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100} aria-busy="true">
            <div style={pct != null ? { width: `${pct}%` } : undefined} />
          </div>
          <div className="job-times">
            <span>Écoulé {clock(elapsed)}</span>
            {remaining != null && <span>Reste ≈ {clock(remaining)}</span>}
          </div>
        </>
      )}
      {children}
    </div>
  );
}
