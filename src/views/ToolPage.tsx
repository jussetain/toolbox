import { Suspense } from "react";
import type { Route } from "../App";
import { categoryById, toolById } from "../tools/registry";
import { implementations } from "../tools/impl";

export default function ToolPage({ id, go }: { id: string; go: (r: Route) => void }) {
  const tool = toolById[id];
  const cat = categoryById[tool.category];
  const Impl = implementations[id];
  return (
    <div className="page tool-page">
      <header className="page-head">
        <a
          href="#"
          className="eyebrow crumb"
          style={{ color: cat.ink }}
          onClick={(e) => (e.preventDefault(), go({ view: "category", id: cat.id }))}
        >
          {cat.name} · {String(tool.n).padStart(2, "0")}
        </a>
        <h1>{tool.name}</h1>
        <p className="muted lead">{tool.description}</p>
      </header>
      {Impl ? (
        <Suspense fallback={<p className="muted">Chargement…</p>}>
          <Impl />
        </Suspense>
      ) : (
        <div className="card soon-card">
          <span className="soon-stamp">Bientôt</span>
          <p>Cet outil arrive dans une prochaine version de Toolbox.</p>
        </div>
      )}
    </div>
  );
}
