//! Réglages persistés dans `%APPDATA%\app.toolbox.windows\settings.json`.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

pub const DEFAULT_SHORTCUT: &str = "Ctrl+Shift+Space";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub shortcut: String,
    /// `None` = Téléchargements\Toolbox.
    pub output_root: Option<String>,
    /// Derniers outils ouverts, le plus récent en premier.
    pub recent: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self { shortcut: DEFAULT_SHORTCUT.into(), output_root: None, recent: vec![] }
    }
}

pub struct SettingsState(pub Mutex<Settings>);

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

pub fn load(app: &AppHandle) -> Settings {
    path(app)
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, s: &Settings) -> Result<(), String> {
    let p = path(app).ok_or("dossier de configuration introuvable")?;
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, serde_json::to_vec_pretty(s).unwrap()).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    #[serde(flatten)]
    settings: Settings,
    /// Dossier effectif (racine), pour affichage.
    output_root_resolved: String,
}

#[tauri::command]
pub fn get_settings(state: State<SettingsState>) -> SettingsView {
    let s = state.0.lock().unwrap().clone();
    let resolved = s.output_root.clone().unwrap_or_else(|| crate::output::default_root().display().to_string());
    SettingsView { settings: s, output_root_resolved: resolved }
}

#[tauri::command]
pub fn set_output_root(app: AppHandle, state: State<SettingsState>, root: Option<String>) -> Result<(), String> {
    let mut s = state.0.lock().unwrap();
    s.output_root = root;
    save(&app, &s)
}

#[tauri::command]
pub fn set_shortcut(app: AppHandle, state: State<SettingsState>, shortcut: String) -> Result<(), String> {
    let previous = state.0.lock().unwrap().shortcut.clone();
    crate::launcher::register_shortcut(&app, &shortcut, Some(&previous))?;
    let mut s = state.0.lock().unwrap();
    s.shortcut = shortcut;
    save(&app, &s)
}

/// Note l'ouverture d'un outil (pour « Récents »).
pub fn touch_recent(app: &AppHandle, tool: &str) {
    let state = app.state::<SettingsState>();
    let mut s = state.0.lock().unwrap();
    s.recent.retain(|t| t != tool);
    s.recent.insert(0, tool.to_string());
    s.recent.truncate(8);
    let _ = save(app, &s);
}
