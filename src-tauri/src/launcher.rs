//! Lanceur : fenêtre flottante ouverte par raccourci global, et icône de zone de notification.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const LAUNCHER: &str = "launcher";
pub const MAIN: &str = "main";
pub const SPLASH: &str = "splash";

/// Moment où le splash a été réellement affiché, et si l'interface principale est prête.
static SPLASH_STATE: std::sync::Mutex<(Option<std::time::Instant>, bool, bool)> = std::sync::Mutex::new((None, false, false));
const SPLASH_MIN: std::time::Duration = std::time::Duration::from_millis(1400);

/// Écran de démarrage : petite fenêtre sans bordure, fermée par `app_ready`.
pub fn create_splash(app: &AppHandle) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, SPLASH, WebviewUrl::App("splash.html".into()))
        .title("Toolbox")
        .inner_size(560.0, 340.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .center()
        .build()?;
    Ok(())
}

/// Le splash signale qu'il est peint (appelé depuis splash.html).
#[tauri::command]
pub fn splash_shown(app: AppHandle) {
    SPLASH_STATE.lock().unwrap().0.get_or_insert_with(std::time::Instant::now);
    finish_startup(&app);
}

/// Appelé par l'interface principale quand elle est prête.
#[tauri::command]
pub fn app_ready(app: AppHandle) {
    SPLASH_STATE.lock().unwrap().1 = true;
    finish_startup(&app);
    // Filet de sécurité : si le splash ne s'est jamais signalé, on ouvre quand même.
    let h = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        SPLASH_STATE.lock().unwrap().0.get_or_insert_with(|| std::time::Instant::now() - SPLASH_MIN);
        finish_startup(&h);
    });
}

/// Ferme le splash et montre l'app quand l'interface est prête ET que le splash a été vu assez longtemps.
fn finish_startup(app: &AppHandle) {
    let (shown, ready, done) = *SPLASH_STATE.lock().unwrap();
    let (Some(shown), true, false) = (shown, ready, done) else { return };
    let wait = SPLASH_MIN.saturating_sub(shown.elapsed());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(wait);
        {
            let mut st = SPLASH_STATE.lock().unwrap();
            if st.2 { return; }
            st.2 = true;
        }
        show_main(&app);
        if let Some(s) = app.get_webview_window(SPLASH) {
            let _ = s.close();
        }
    });
}

pub fn create_launcher_window(app: &AppHandle) -> tauri::Result<()> {
    let win = WebviewWindowBuilder::new(app, LAUNCHER, WebviewUrl::App("index.html".into()))
        .title("Toolbox — Lanceur")
        .inner_size(700.0, 600.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .center()
        .visible(false)
        .build()?;
    let handle = app.clone();
    win.on_window_event(move |e| {
        // TOOLBOX_KEEP_LAUNCHER (build debug) : garde le lanceur ouvert, pour les captures sans gestionnaire de fenêtres.
        if cfg!(debug_assertions) && std::env::var_os("TOOLBOX_KEEP_LAUNCHER").is_some() {
            return;
        }
        if let tauri::WindowEvent::Focused(false) = e {
            hide_launcher_inner(&handle);
        }
    });
    Ok(())
}

pub fn toggle_launcher(app: &AppHandle) {
    let Some(win) = app.get_webview_window(LAUNCHER) else { return };
    if win.is_visible().unwrap_or(false) {
        let _ = win.hide();
    } else {
        let _ = win.center();
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.emit_to(LAUNCHER, "launcher-shown", ());
    }
}

fn hide_launcher_inner(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(LAUNCHER) {
        let _ = win.hide();
    }
}

pub fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// Enregistre le raccourci global (et retire l'ancien s'il est fourni).
pub fn register_shortcut(app: &AppHandle, accel: &str, previous: Option<&str>) -> Result<(), String> {
    let gs = app.global_shortcut();
    let new: Shortcut = accel.parse().map_err(|e| format!("raccourci invalide : {e}"))?;
    if let Some(prev) = previous.and_then(|p| p.parse::<Shortcut>().ok()) {
        let _ = gs.unregister(prev);
    }
    gs.on_shortcut(new, |app, _sc, ev| {
        if ev.state == ShortcutState::Pressed {
            toggle_launcher(app);
        }
    })
    .map_err(|e| format!("raccourci indisponible (déjà pris par une autre app ?) : {e}"))
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Ouvrir Toolbox", true, None::<&str>)?;
    let launch = MenuItem::with_id(app, "launcher", "Lanceur", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &launch, &quit])?;
    TrayIconBuilder::with_id("tray")
        .icon(app.default_window_icon().cloned().expect("icône manquante"))
        .tooltip("Toolbox")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => show_main(app),
            "launcher" => toggle_launcher(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[tauri::command]
pub fn hide_launcher(app: AppHandle) {
    hide_launcher_inner(&app);
}

/// Outil demandé avant que l'interface principale soit prête à l'écouter.
#[derive(Default)]
pub struct PendingTool(pub std::sync::Mutex<Option<String>>);

/// Appelé par le lanceur : ouvre l'outil dans la fenêtre principale.
#[tauri::command]
pub fn open_tool(app: AppHandle, id: String) {
    hide_launcher_inner(&app);
    crate::settings::touch_recent(&app, &id);
    *app.state::<PendingTool>().0.lock().unwrap() = Some(id.clone());
    show_main(&app);
    let _ = app.emit_to(MAIN, "open-tool", id);
}

/// L'interface principale récupère l'outil en attente (au démarrage ou sur `open-tool`).
#[tauri::command]
pub fn take_pending_tool(pending: tauri::State<PendingTool>) -> Option<String> {
    pending.0.lock().unwrap().take()
}
