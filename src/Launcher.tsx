import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./lib/api";
import { categoryById, TOOLS } from "./tools/registry";
import { searchTools } from "./tools/search";
import { ToolGlyph } from "./components/ToolGlyph";

const MAX = 6;

export default function Launcher() {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [shortcut, setShortcut] = useState("Ctrl+Shift+Space");
  const input = useRef<HTMLInputElement>(null);

  const refresh = () =>
    api.getSettings().then((s) => {
      setRecent(s.recent);
      setShortcut(s.shortcut);
    });

  useEffect(() => {
    refresh();
    const un = listen("launcher-shown", () => {
      setQuery("");
      setSel(0);
      refresh();
      input.current?.focus();
    });
    return () => void un.then((f) => f());
  }, []);

  const results = useMemo(() => searchTools(query, recent).slice(0, MAX), [query, recent]);

  useEffect(() => setSel(0), [query]);

  const open = (id: string) => api.openTool(id);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && results[sel]) {
      open(results[sel].id);
    } else if (e.key === "Escape") {
      api.hideLauncher();
    }
  };

  return (
    <div className="launcher" onKeyDown={onKey}>
      <div className="launcher-search" data-tauri-drag-region>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M20 20l-4.5-4.5" />
        </svg>
        <label htmlFor="q" className="sr-only">Rechercher un outil</label>
        <input
          id="q"
          ref={input}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="Que veux-tu faire ?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="kbd">Échap</span>
      </div>
      <ul className="launcher-results" role="listbox" aria-label="Outils">
        {results.length === 0 && <li className="launcher-empty">Aucun outil ne correspond.</li>}
        {results.map((t, i) => {
          const cat = categoryById[t.category];
          return (
            <li
              key={t.id}
              role="option"
              aria-selected={i === sel}
              className="launcher-row"
              onMouseEnter={() => setSel(i)}
              onClick={() => open(t.id)}
            >
              <ToolGlyph category={t.category} size={42} />
              <div className="launcher-text">
                <span className="launcher-name">{t.name}</span>
                <span className="launcher-desc">{t.description}</span>
              </div>
              <span className="launcher-cat" style={{ color: i === sel ? cat.color : cat.ink }}>
                {cat.name}
              </span>
              <span className="launcher-enter" aria-hidden="true">{i === sel ? "↵" : ""}</span>
            </li>
          );
        })}
      </ul>
      <div className="launcher-foot">
        <span>{TOOLS.length} outils</span>
        <span>↑↓ naviguer</span>
        <span>↵ ouvrir</span>
        <span style={{ marginLeft: "auto" }}>{shortcut.replace("Shift", "Maj").replace("Space", "Espace").replace(/\+/g, " + ")}</span>
      </div>
    </div>
  );
}
