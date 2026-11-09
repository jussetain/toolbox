import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";

export interface FileDropProps {
  files: string[];
  onChange: (files: string[]) => void;
  multiple?: boolean;
  /** Extensions acceptées, sans le point. Vide = tout. */
  accept?: string[];
  label?: string;
}

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** Zone de dépôt : glisser-déposer depuis l'Explorateur ou sélection par dialogue. */
export function FileDrop({ files, onChange, multiple = true, accept = [], label = "Glisse tes fichiers ici" }: FileDropProps) {
  const [over, setOver] = useState(false);

  const keep = (paths: string[]) =>
    accept.length ? paths.filter((p) => accept.includes(p.split(".").pop()?.toLowerCase() ?? "")) : paths;

  const add = (paths: string[]) => {
    const ok = keep(paths);
    if (!ok.length) return;
    onChange(multiple ? [...files, ...ok.filter((p) => !files.includes(p))] : ok.slice(0, 1));
  };

  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "over" || e.payload.type === "enter") setOver(true);
      else if (e.payload.type === "leave") setOver(false);
      else if (e.payload.type === "drop") {
        setOver(false);
        add(e.payload.paths);
      }
    });
    return () => void un.then((f) => f());
  });

  const browse = async () => {
    const picked = await open({
      multiple,
      filters: accept.length ? [{ name: "Fichiers acceptés", extensions: accept }] : undefined,
    });
    if (picked) add(Array.isArray(picked) ? picked : [picked]);
  };

  return (
    <div className={`drop ${over ? "drop-over" : ""} ${files.length ? "drop-filled" : ""}`}>
      {files.length === 0 ? (
        <button className="drop-empty" onClick={browse}>
          <span className="drop-title">{label}</span>
          <span className="muted">ou clique pour choisir{accept.length ? ` (${accept.join(", ")})` : ""}</span>
        </button>
      ) : (
        <ul className="drop-list">
          {files.map((f) => (
            <li key={f}>
              <span className="drop-file" title={f}>{basename(f)}</span>
              <button className="btn btn-ghost btn-sm" aria-label={`Retirer ${basename(f)}`} onClick={() => onChange(files.filter((x) => x !== f))}>
                Retirer
              </button>
            </li>
          ))}
          <li>
            <button className="btn btn-sm" onClick={browse}>+ Ajouter</button>
            {files.length > 1 && (
              <button className="btn btn-ghost btn-sm" onClick={() => onChange([])}>Tout retirer</button>
            )}
          </li>
        </ul>
      )}
    </div>
  );
}
