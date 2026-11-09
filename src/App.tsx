import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type Settings } from "./lib/api";
import { CATEGORIES, toolById, toolsIn, type CategoryId } from "./tools/registry";
import Home from "./views/Home";
import CategoryView from "./views/CategoryView";
import ToolPage from "./views/ToolPage";
import SettingsView from "./views/SettingsView";
import { TitleBar } from "./components/TitleBar";
import { invoke } from "@tauri-apps/api/core";

export type Route =
  | { view: "home" }
  | { view: "category"; id: CategoryId }
  | { view: "tool"; id: string }
  | { view: "settings" };

export default function App() {
  const [route, setRoute] = useState<Route>({ view: "home" });
  const [settings, setSettings] = useState<Settings | null>(null);

  const reload = () => api.getSettings().then(setSettings);

  // L'interface est montée : on ferme l'écran de démarrage.
  useEffect(() => void invoke("app_ready"), []);

  useEffect(() => {
    const openPending = () =>
      api.takePendingTool().then((id) => {
        if (id && toolById[id]) setRoute({ view: "tool", id });
        reload();
      });
    openPending();
    const un = listen<string>("open-tool", openPending);
    return () => void un.then((f) => f());
  }, []);

  const go = (r: Route) => {
    if (r.view === "tool") api.noteToolOpened(r.id).then(reload);
    setRoute(r);
  };

  const activeCat =
    route.view === "category" ? route.id : route.view === "tool" ? toolById[route.id]?.category : undefined;

  const title =
    route.view === "tool" ? toolById[route.id]?.name : route.view === "category" ? CATEGORIES.find((c) => c.id === route.id)?.name : route.view === "settings" ? "Réglages" : "Tous les outils";

  return (
    <div className="shell">
    <TitleBar title={title ?? "Toolbox"} />
    <div className="app">
      <nav className="sidebar" aria-label="Catégories">
        <button className="brand" onClick={() => go({ view: "home" })}>
          <span className="brand-mark" aria-hidden="true" />
          <span>Toolbox</span>
        </button>
        <a
          href="#"
          className="nav-item"
          aria-current={route.view === "home" ? "page" : undefined}
          onClick={(e) => (e.preventDefault(), go({ view: "home" }))}
        >
          Tous les outils
        </a>
        {CATEGORIES.map((c) => (
          <a
            key={c.id}
            href="#"
            className="nav-item"
            aria-current={activeCat === c.id ? "page" : undefined}
            onClick={(e) => (e.preventDefault(), go({ view: "category", id: c.id }))}
          >
            <span className="chip" style={{ background: c.color }} />
            {c.name}
            <span className="nav-count">{toolsIn(c.id).length}</span>
          </a>
        ))}
        <a
          href="#"
          className="nav-item nav-settings"
          aria-current={route.view === "settings" ? "page" : undefined}
          onClick={(e) => (e.preventDefault(), go({ view: "settings" }))}
        >
          Réglages
        </a>
        {settings && (
          <div className="nav-hint">
            {formatShortcut(settings.shortcut)} pour lancer un outil de n'importe où
          </div>
        )}
      </nav>
      <main className="content">
        {route.view === "home" && <Home recent={settings?.recent ?? []} go={go} shortcut={settings?.shortcut} />}
        {route.view === "category" && <CategoryView id={route.id} go={go} />}
        {route.view === "tool" && <ToolPage key={route.id} id={route.id} go={go} />}
        {route.view === "settings" && settings && <SettingsView settings={settings} onChange={reload} />}
      </main>
    </div>
    </div>
  );
}

export function formatShortcut(s: string) {
  return s.replace("Shift", "Maj").replace("Space", "Espace").replace(/\+/g, " + ");
}
