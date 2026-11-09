import { categoryById, type CategoryId } from "../tools/registry";

const paths: Record<CategoryId, React.ReactNode> = {
  video: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M10 9l5 3-5 3z" />
    </>
  ),
  audio: <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />,
  images: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 17l5-5 4 4 3-3 6 6" />
    </>
  ),
  docs: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
    </>
  ),
  text: <path d="M5 6h14M12 6v13M8 19h8" />,
  files: <path d="M3 7h7l2 2h9v10H3z" />,
  system: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M9 20h6M12 16v4" />
    </>
  ),
  dev: <path d="M8 8l-4 4 4 4M16 8l4 4-4 4" />,
};

/** Pastille de catégorie avec pictogramme (style tampon). */
export function ToolGlyph({ category, size = 42 }: { category: CategoryId; size?: number }) {
  return (
    <span className="glyph" style={{ width: size, height: size, background: categoryById[category].color }} aria-hidden="true">
      <svg width={size * 0.52} height={size * 0.52} viewBox="0 0 24 24" fill="none" stroke="#1F1B16" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {paths[category]}
      </svg>
    </span>
  );
}
