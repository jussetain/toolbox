mod engines;
mod jobs;
mod launcher;
mod output;
mod settings;
mod tools;

use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};

use settings::{SettingsState, DEFAULT_SHORTCUT};

/// Dossier de sortie du jour (créé si besoin).
#[tauri::command]
fn output_dir(state: State<SettingsState>) -> Result<String, String> {
    let s = state.0.lock().unwrap().clone();
    output::today_dir(&s).map(|p| p.display().to_string()).map_err(|e| e.to_string())
}

/// Montre un fichier ou un dossier dans l'Explorateur.
#[tauri::command]
fn reveal(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn note_tool_opened(app: AppHandle, id: String) {
    settings::touch_recent(&app, &id);
}

fn handle_args(app: &AppHandle, args: &[String]) {
    if args.iter().any(|a| a == "--launcher") {
        launcher::toggle_launcher(app);
    } else if let Some(id) = args.iter().position(|a| a == "--tool").and_then(|i| args.get(i + 1)) {
        launcher::open_tool(app.clone(), id.clone());
    } else {
        launcher::show_main(app);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Relancer l'exe réutilise l'instance en cours : `--launcher` ouvre le lanceur,
        // `--tool <id>` ouvre un outil, sinon la fenêtre principale.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| handle_args(app, &args)))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(jobs::Jobs::default())
        .manage(launcher::PendingTool::default())
        .manage(tools::monitor::MonitorState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let s = settings::load(&handle);
            let accel = s.shortcut.clone();
            app.manage(SettingsState(Mutex::new(s)));

            launcher::create_splash(&handle)?;
            launcher::create_launcher_window(&handle)?;
            launcher::create_tray(&handle)?;
            if let Err(e) = launcher::register_shortcut(&handle, &accel, None) {
                eprintln!("{e}");
                if accel != DEFAULT_SHORTCUT {
                    let _ = launcher::register_shortcut(&handle, DEFAULT_SHORTCUT, None);
                }
            }

            // Fermer la fenêtre principale la masque : l'app reste dans la zone de notification.
            if let Some(main) = app.get_webview_window(launcher::MAIN) {
                let m = main.clone();
                main.on_window_event(move |e| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                        api.prevent_close();
                        let _ = m.hide();
                    }
                });
            }

            let args: Vec<String> = std::env::args().collect();
            if args.len() > 1 {
                let h = handle.clone();
                // Laisse le temps à l'interface de s'abonner aux événements.
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    handle_args(&h, &args);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            output_dir,
            reveal,
            note_tool_opened,
            jobs::cancel_job,
            launcher::hide_launcher,
            launcher::open_tool,
            launcher::app_ready,
            launcher::splash_shown,
            launcher::take_pending_tool,
            settings::get_settings,
            settings::set_output_root,
            settings::set_shortcut,
            tools::hash::hash_text,
            tools::hash::hash_files,
            tools::files::read_text_file,
            tools::files::base64_encode_file,
            tools::files::base64_decode_to_file,
            engines::engine_status,
            engines::engine_install,
            engines::engine_file,
            engines::engine_list,
            engines::engine_remove,
            tools::media::media_process,
            tools::media::media_merge,
            tools::media::media_info,
            tools::media::video_download,
            tools::convert::documents_convert,
            tools::convert::office_to_pdf,
            tools::convert::html_to_pdf,
            tools::system::speed_test,
            tools::system::storage_scan,
            tools::system::storage_hogs,
            tools::system::storage_clean,
            tools::system::keep_awake_start,
            tools::system::keep_awake_stop,
            tools::system::keep_awake_status,
            tools::system::wifi_profiles,
            tools::system::battery_info,
            tools::system::apps_list,
            tools::system::app_uninstall,
            tools::system::presentation_mode,
            tools::system::keyboard_lock,
            tools::system::keyboard_unlock,
            tools::system::drives_list,
            tools::system::drives_eject,
            tools::system::startup_list,
            tools::system::startup_set,
            tools::system::privacy_list,
            tools::system::privacy_reset,
            tools::system::tweaks_list,
            tools::system::tweak_set,
            tools::system::explorer_restart,
            tools::system::monitors_list,
            tools::system::monitor_set,
            tools::system::mouse_get,
            tools::system::mouse_set,
            tools::system::mouse_natural_scroll,
            tools::system::file_trust,
            tools::system::file_unblock,
            tools::ai::transcribe,
            tools::ai::llm_chat,
            tools::ai::ocr_languages,
            tools::ai::ocr_image,
            tools::ai::detect_faces,
            tools::ai::tts_voices,
            tools::ai::tts_synthesize,
            tools::ai::capture_text,
            tools::images::images_process,
            tools::capture::screen_capture,
            tools::monitor::system_snapshot,
            tools::monitor::process_kill,
            tools::images::image_info,
            tools::fileops::read_file_bytes,
            tools::fileops::save_output,
            tools::fileops::save_temp,
            tools::fileops::qr_decode,
            tools::fileops::rename_files,
            tools::fileops::find_duplicates,
            tools::fileops::trash_files,
            tools::fileops::zip_create,
            tools::fileops::archive_extract,
            tools::fileops::downloads_scan,
            tools::fileops::downloads_organize,
        ])
        .build(tauri::generate_context!())
        .expect("erreur au lancement de Toolbox")
        .run(|_, event| {
            if let tauri::RunEvent::Exit = event {
                tools::ai::shutdown_llm();
            }
        });
}
