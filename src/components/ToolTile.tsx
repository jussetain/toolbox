import { categoryById, type Tool } from "../tools/registry";
import { isImplemented } from "../tools/impl";

export function ToolTile({ tool, onClick }: { tool: Tool; onClick: () => void }) {
  const ready = isImplemented(tool.id);
  return (
    <button className="tile" onClick={onClick} title={tool.description}>
      <span className="tile-dot" style={{ background: categoryById[tool.category].color }} />
      <span className="tile-name">{tool.name}</span>
      {!ready && <span className="tile-soon">bientôt</span>}
    </button>
  );
}
