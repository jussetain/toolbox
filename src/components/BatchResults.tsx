import { api, formatBytes } from "../lib/api";

export interface BatchFile { name: string; output: string | null; before: number; after: number; error: string | null; note: string | null }
export interface BatchResult { dir: string; files: BatchFile[] }

/** Résultat d'un traitement par lot : tailles avant/après, gain, accès au fichier. */
export function BatchResults({ result, showSizes = true }: { result: BatchResult; showSizes?: boolean }) {
  const ok = result.files.filter((f) => !f.error);
  const before = ok.reduce((s, f) => s + f.before, 0);
  const after = ok.reduce((s, f) => s + f.after, 0);
  const gain = before ? Math.round((1 - after / before) * 100) : 0;
  return (
    <div className="batch">
      <div className="row">
        <strong>{ok.length} fichier{ok.length > 1 ? "s" : ""} enregistré{ok.length > 1 ? "s" : ""}</strong>
        {showSizes && ok.length > 0 && (
          <span>{formatBytes(before)} → {formatBytes(after)}</span>
        )}
        {showSizes && gain > 0 && <span className="stamp">−{gain} %</span>}
        <span style={{ marginLeft: "auto" }} />
        <button className="btn btn-sm" onClick={() => api.reveal(ok[0]?.output ?? result.dir)}>Ouvrir le dossier</button>
      </div>
      <ul className="list-mono">
        {result.files.map((f, i) => (
          <li key={i}>
            <span style={{ fontFamily: "var(--font)", fontSize: 15 }}>
              <strong>{f.name}</strong>
              {f.error ? (
                <span className="status-bad"> — {f.error}</span>
              ) : (
                showSizes && (
                  <span className="muted"> — {formatBytes(f.before)} → {formatBytes(f.after)}{f.note ? ` (${f.note})` : ""}</span>
                )
              )}
            </span>
            {f.output && <button className="btn btn-sm btn-ghost" onClick={() => api.reveal(f.output!)}>Afficher</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
