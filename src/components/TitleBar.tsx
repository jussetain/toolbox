import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Barre de titre maison (fenêtre sans décorations Windows) : zone de déplacement + réduire / agrandir / fermer. */
export function TitleBar({ title }: { title: string }) {
  const win = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    win.isMaximized().then(setMaximized);
    const un = win.onResized(() => win.isMaximized().then(setMaximized));
    return () => void un.then((f) => f());
  }, []);
  return (
    <header className="titlebar" data-tauri-drag-region onDoubleClick={() => win.toggleMaximize()}>
      <span className="titlebar-mark" aria-hidden="true" data-tauri-drag-region />
      <span className="titlebar-title" data-tauri-drag-region>{title}</span>
      <div className="titlebar-buttons">
        <button className="tb-btn" aria-label="Réduire" title="Réduire" onClick={() => win.minimize()}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6.5h10" stroke="currentColor" strokeWidth="1.6" /></svg>
        </button>
        <button className="tb-btn" aria-label={maximized ? "Restaurer" : "Agrandir"} title={maximized ? "Restaurer" : "Agrandir"} onClick={() => win.toggleMaximize()}>
          {maximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1.5" y="3.5" width="7" height="7" rx="1" /><path d="M3.5 3.5V2a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-.5.5H8.5" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1.5" y="1.5" width="9" height="9" rx="1.2" /></svg>
          )}
        </button>
        <button className="tb-btn tb-close" aria-label="Fermer (Toolbox reste dans la zone de notification)" title="Fermer" onClick={() => win.close()}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </div>
    </header>
  );
}
