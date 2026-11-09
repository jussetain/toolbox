import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, type Settings } from "../lib/api";
import { formatShortcut } from "../App";
import { EnginesSettings } from "../components/EnginesSettings";

const MODS = ["Control", "Alt", "Shift", "Meta"];

/** Convertit un événement clavier en accélérateur Tauri (« Ctrl+Shift+Space »). */
function toAccelerator(e: React.KeyboardEvent): string | null {
  if (MODS.includes(e.key)) return null;
  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");
  if (parts.length === 0) return null;
  parts.push(e.code.replace(/^Key|^Digit/, ""));
  return parts.join("+");
}

export default function SettingsView({ settings, onChange }: { settings: Settings; onChange: () => void }) {
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickFolder = async () => {
    const dir = await open({ directory: true, defaultPath: settings.outputRootResolved });
    if (typeof dir === "string") {
      await api.setOutputRoot(dir);
      onChange();
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Réglages</h1>
      </header>
      <div className="settings">
        <section className="setting">
          <div>
            <h2 className="field-label">Raccourci du lanceur</h2>
            <p className="muted">Ouvre la recherche d'outils depuis n'importe quelle application.</p>
          </div>
          <button
            className="btn"
            onClick={() => (setCapturing(true), setError(null))}
            onBlur={() => setCapturing(false)}
            onKeyDown={async (e) => {
              if (!capturing) return;
              e.preventDefault();
              if (e.key === "Escape") return setCapturing(false);
              const acc = toAccelerator(e);
              if (!acc) return;
              setCapturing(false);
              try {
                await api.setShortcut(acc);
                onChange();
              } catch (err) {
                setError(String(err));
              }
            }}
          >
            {capturing ? "Tape le raccourci…" : formatShortcut(settings.shortcut)}
          </button>
        </section>
        {error && <p className="error" role="alert">{error}</p>}
        <section className="setting">
          <div>
            <h2 className="field-label">Dossier des résultats</h2>
            <p className="muted selectable">{settings.outputRootResolved}\AAAA-MM-JJ</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {settings.outputRoot && (
              <button className="btn btn-ghost" onClick={async () => (await api.setOutputRoot(null), onChange())}>
                Par défaut
              </button>
            )}
            <button className="btn" onClick={pickFolder}>Changer…</button>
          </div>
        </section>
        <EnginesSettings />
      </div>
    </div>
  );
}
