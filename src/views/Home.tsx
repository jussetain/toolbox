import { useMemo, useState } from "react";
import type { Route } from "../App";
import { formatShortcut } from "../App";
import { CATEGORIES, categoryById, toolById, toolsIn } from "../tools/registry";
import { searchTools } from "../tools/search";
import { ToolTile } from "../components/ToolTile";

export default function Home({ recent, go, shortcut }: { recent: string[]; go: (r: Route) => void; shortcut?: string }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => (q.trim() ? searchTools(q) : null), [q]);
  const recentTools = recent.map((id) => toolById[id]).filter(Boolean).slice(0, 4);

  return (
    <div className="page">
      <div className="search-bar card">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M20 20l-4.5-4.5" />
        </svg>
        <label htmlFor="home-search" className="sr-only">Rechercher un outil</label>
        <input
          id="home-search"
          autoFocus
          placeholder="Que veux-tu faire ? Compresser, signer, convertir…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && results?.[0] && go({ view: "tool", id: results[0].id })}
        />
        {shortcut && <span className="kbd">{formatShortcut(shortcut)}</span>}
      </div>

      {results ? (
        <section className="section">
          <h2 className="eyebrow">{results.length} résultat{results.length > 1 ? "s" : ""}</h2>
          <div className="tile-grid">
            {results.map((t) => (
              <ToolTile key={t.id} tool={t} onClick={() => go({ view: "tool", id: t.id })} />
            ))}
          </div>
        </section>
      ) : (
        <>
          {recentTools.length > 0 && (
            <section className="section">
              <h2 className="eyebrow">Récents</h2>
              <div className="recent-grid">
                {recentTools.map((t) => (
                  <button
                    key={t.id}
                    className="recent-card"
                    style={{ background: categoryById[t.category].color }}
                    onClick={() => go({ view: "tool", id: t.id })}
                  >
                    <span className="eyebrow" style={{ fontSize: 12 }}>{categoryById[t.category].name}</span>
                    <span className="recent-name">{t.name}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {CATEGORIES.map((c) => (
            <section key={c.id} className="section">
              <div className="section-head">
                <h2>{c.name}</h2>
                <span className="muted">{toolsIn(c.id).length} outils</span>
              </div>
              <div className="tile-grid">
                {toolsIn(c.id).map((t) => (
                  <ToolTile key={t.id} tool={t} onClick={() => go({ view: "tool", id: t.id })} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
