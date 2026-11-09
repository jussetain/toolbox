import type { Route } from "../App";
import { categoryById, toolsIn, type CategoryId } from "../tools/registry";
import { ToolGlyph } from "../components/ToolGlyph";
import { isImplemented } from "../tools/impl";

export default function CategoryView({ id, go }: { id: CategoryId; go: (r: Route) => void }) {
  const cat = categoryById[id];
  const tools = toolsIn(id);
  return (
    <div className="page">
      <header className="page-head">
        <span className="eyebrow" style={{ color: cat.ink }}>{tools.length} outils</span>
        <h1>{cat.name}</h1>
      </header>
      <div className="cat-list">
        {tools.map((t) => (
          <button key={t.id} className="cat-row" onClick={() => go({ view: "tool", id: t.id })}>
            <ToolGlyph category={id} size={40} />
            <span className="cat-row-text">
              <span className="cat-row-name">{t.name}</span>
              <span className="muted">{t.description}</span>
            </span>
            {!isImplemented(t.id) && <span className="tile-soon">bientôt</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
