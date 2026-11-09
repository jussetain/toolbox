import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatBytes, useJobs } from "../../lib/api";
import { FileDrop } from "../../components/FileDrop";
import { JobRow } from "../../components/JobRow";

type Algo = "md5" | "sha1" | "sha256" | "sha512";
type Hashes = Record<Algo, string>;
interface FileHash { path: string; name: string; size: number; hashes: Hashes }

const ALGOS: { id: Algo; label: string }[] = [
  { id: "md5", label: "MD5" },
  { id: "sha1", label: "SHA-1" },
  { id: "sha256", label: "SHA-256" },
  { id: "sha512", label: "SHA-512" },
];

export default function HashGenerator() {
  const [mode, setMode] = useState<"files" | "text">("files");
  const [files, setFiles] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [textHashes, setTextHashes] = useState<Hashes | null>(null);
  const [expected, setExpected] = useState("");
  const { jobs, running, start, cancel } = useJobs<FileHash[]>("hash-generator");

  useEffect(() => {
    if (mode === "text") invoke<Hashes>("hash_text", { text }).then(setTextHashes);
  }, [text, mode]);

  const exp = expected.trim().toLowerCase();

  const HashTable = ({ hashes }: { hashes: Hashes }) => (
    <dl className="hash-table">
      {ALGOS.map((a) => {
        const match = exp && hashes[a.id] === exp;
        return (
          <div key={a.id} className={match ? "hash-match" : undefined}>
            <dt>{a.label}{match && " ✓"}</dt>
            <dd className="selectable mono">{hashes[a.id]}</dd>
            <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(hashes[a.id])}>Copier</button>
          </div>
        );
      })}
    </dl>
  );

  return (
    <div className="tool-body">
      <div className="seg" role="group" aria-label="Source" style={{ maxWidth: 360 }}>
        <button aria-pressed={mode === "files"} onClick={() => setMode("files")}>Fichiers</button>
        <button aria-pressed={mode === "text"} onClick={() => setMode("text")}>Texte</button>
      </div>

      {mode === "files" ? (
        <>
          <FileDrop files={files} onChange={setFiles} />
          <label className="field">
            <span className="field-label">Hash attendu (facultatif)</span>
            <input className="input mono" type="text" placeholder="Colle un hash pour vérifier un fichier" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </label>
          <div className="tool-actions">
            <button
              className="btn btn-primary"
              disabled={!files.length || running}
              onClick={() => start(() => invoke<number>("hash_files", { paths: files }))}
            >
              Calculer →
            </button>
          </div>
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)}>
              {j.status === "done" &&
                j.result?.map((f) => (
                  <div key={f.path} className="hash-file">
                    <div className="hash-file-head">
                      <strong>{f.name}</strong>
                      <span className="muted">{formatBytes(f.size)}</span>
                      {exp && (
                        <span className={`stamp ${Object.values(f.hashes).includes(exp) ? "stamp-ok" : "stamp-bad"}`}>
                          {Object.values(f.hashes).includes(exp) ? "Identique" : "Différent"}
                        </span>
                      )}
                    </div>
                    <HashTable hashes={f.hashes} />
                  </div>
                ))}
            </JobRow>
          ))}
        </>
      ) : (
        <>
          <label className="field">
            <span className="field-label">Texte</span>
            <textarea className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Hash attendu (facultatif)</span>
            <input className="input mono" type="text" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </label>
          {textHashes && <div className="card hash-file"><HashTable hashes={textHashes} /></div>}
        </>
      )}
    </div>
  );
}
