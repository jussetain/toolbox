import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

export interface Settings {
  shortcut: string;
  outputRoot: string | null;
  outputRootResolved: string;
  recent: string[];
}

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  setShortcut: (shortcut: string) => invoke<void>("set_shortcut", { shortcut }),
  setOutputRoot: (root: string | null) => invoke<void>("set_output_root", { root }),
  outputDir: () => invoke<string>("output_dir"),
  reveal: (path: string) => invoke<void>("reveal", { path }),
  openTool: (id: string) => invoke<void>("open_tool", { id }),
  noteToolOpened: (id: string) => invoke<void>("note_tool_opened", { id }),
  hideLauncher: () => invoke<void>("hide_launcher"),
  takePendingTool: () => invoke<string | null>("take_pending_tool"),
  cancelJob: (id: number) => invoke<void>("cancel_job", { id }),
};

export type JobStatus = "running" | "done" | "error" | "cancelled";

export interface JobState<R = unknown> {
  id: number;
  tool: string;
  status: JobStatus;
  progress: number | null;
  label: string | null;
  result: R | null;
  error: string | null;
  /** Étapes nommées (frise) et index de l'étape en cours. */
  stages: string[];
  stage: number;
}

/**
 * Suit les tâches lancées par un outil. `start` prend une fonction qui
 * invoque une commande Rust renvoyant un identifiant de tâche.
 */
export function useJobs<R = unknown>(tool: string) {
  const [jobs, setJobs] = useState<JobState<R>[]>([]);

  useEffect(() => {
    const un = listen<JobState<R>>("job", ({ payload }) => {
      if (payload.tool !== tool) return;
      setJobs((prev) => {
        const i = prev.findIndex((j) => j.id === payload.id);
        if (i < 0) return [payload, ...prev];
        const next = prev.slice();
        // Les événements « running » ne portent pas de résultat : on garde le libellé précédent si absent.
        next[i] = { ...prev[i], ...payload, label: payload.label ?? (payload.stage !== prev[i].stage ? null : prev[i].label) };
        return next;
      });
    });
    return () => void un.then((f) => f());
  }, [tool]);

  return {
    jobs,
    running: jobs.some((j) => j.status === "running"),
    start: (run: () => Promise<number>) => run(),
    cancel: (id: number) => api.cancelJob(id),
    clear: () => setJobs((prev) => prev.filter((j) => j.status === "running")),
  };
}

export function formatBytes(n: number): string {
  const units = ["o", "Ko", "Mo", "Go", "To"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: i === 0 ? 0 : 1 })} ${units[i]}`;
}
