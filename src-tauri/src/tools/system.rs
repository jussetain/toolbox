//! Outils Système (69–84). Les fonctions propres à Windows vivent dans `win` ;
//! ailleurs elles renvoient une erreur claire (pour le développement sous Linux).

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use walkdir::WalkDir;

use crate::jobs::{self, JobCtx, JobError};

const WINDOWS_ONLY: &str = "Disponible sous Windows uniquement.";

// ── 69 Test de débit ────────────────────────────────────────────────────────

const CF: &str = "https://speed.cloudflare.com";

fn median(mut v: Vec<f64>) -> f64 {
    if v.is_empty() { return 0.0; }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[v.len() / 2]
}

fn ping(agent: &ureq::Agent) -> Option<f64> {
    let t = Instant::now();
    let mut r = agent.get(&format!("{CF}/__down?bytes=0")).call().ok()?;
    let _ = r.body_mut().read_to_vec();
    Some(t.elapsed().as_secs_f64() * 1000.0)
}

#[tauri::command]
pub fn speed_test(app: AppHandle) -> u64 {
    jobs::spawn(&app, "speed-test", move |ctx| {
        let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(15))).build().into();
        ctx.stages(&["Latence", "Débit descendant", "Débit montant"]);
        ctx.stage(0, "Mesure du temps de réponse…");
        let mut idle = Vec::new();
        for _ in 0..8 {
            ctx.check()?;
            if let Some(ms) = ping(&agent) { idle.push(ms); }
        }
        if idle.is_empty() {
            return Err(JobError::Failed("Pas de connexion à Internet (ou le service de mesure est injoignable).".into()));
        }
        let idle_ms = median(idle);

        // Débit descendant + latence sous charge.
        ctx.stage(1, format!("Latence {idle_ms:.0} ms · téléchargement en cours…"));
        let (down, loaded) = load_phase(ctx, &agent, true, 0.0, 1.0)?;
        ctx.stage(2, format!("Descendant {down:.0} Mbit/s · envoi en cours…"));
        let (up, _) = load_phase(ctx, &agent, false, 0.0, 1.0)?;
        let loaded_ms = median(loaded).max(idle_ms);
        Ok(json!({ "downloadMbps": down, "uploadMbps": up, "idleMs": idle_ms, "loadedMs": loaded_ms, "rpm": (60000.0 / loaded_ms).round() }))
    })
}

/// 4 flux parallèles pendant 8 s ; renvoie (Mbit/s, latences sous charge).
fn load_phase(ctx: &JobCtx, agent: &ureq::Agent, download: bool, p0: f64, p1: f64) -> Result<(f64, Vec<f64>), JobError> {
    let bytes = Arc::new(AtomicU64::new(0));
    let stop = Arc::new(AtomicBool::new(false));
    let dur = Duration::from_secs(8);
    let mut handles = Vec::new();
    for _ in 0..4 {
        let (bytes, stop, agent) = (bytes.clone(), stop.clone(), agent.clone());
        handles.push(std::thread::spawn(move || {
            let payload = vec![0u8; 4 << 20];
            while !stop.load(Ordering::Relaxed) {
                if download {
                    let Ok(r) = agent.get(&format!("{CF}/__down?bytes=50000000")).call() else { break };
                    let mut rd = r.into_body().into_reader();
                    let mut buf = vec![0u8; 1 << 16];
                    while !stop.load(Ordering::Relaxed) {
                        match rd.read(&mut buf) {
                            Ok(0) | Err(_) => break,
                            Ok(n) => { bytes.fetch_add(n as u64, Ordering::Relaxed); }
                        }
                    }
                } else if agent.post(&format!("{CF}/__up")).send(&payload[..]).is_ok() {
                    bytes.fetch_add(payload.len() as u64, Ordering::Relaxed);
                } else {
                    break;
                }
            }
        }));
    }
    let t0 = Instant::now();
    let mut lat = Vec::new();
    let mut last_ping = Instant::now();
    while t0.elapsed() < dur {
        if ctx.is_cancelled() {
            stop.store(true, Ordering::Relaxed);
            return Err(JobError::Cancelled);
        }
        std::thread::sleep(Duration::from_millis(200));
        if download && last_ping.elapsed() > Duration::from_millis(600) {
            if let Some(ms) = ping(agent) { lat.push(ms); }
            last_ping = Instant::now();
        }
        let mbps = bytes.load(Ordering::Relaxed) as f64 * 8.0 / 1e6 / t0.elapsed().as_secs_f64();
        let frac = t0.elapsed().as_secs_f64() / dur.as_secs_f64();
        ctx.progress(Some(p0 + (p1 - p0) * frac.min(1.0)), format!("{} · {mbps:.0} Mbit/s", if download { "Descendant" } else { "Montant" }));
    }
    stop.store(true, Ordering::Relaxed);
    let mbps = bytes.load(Ordering::Relaxed) as f64 * 8.0 / 1e6 / t0.elapsed().as_secs_f64();
    for h in handles { let _ = h.join(); }
    Ok(((mbps * 10.0).round() / 10.0, lat))
}

// ── 70 Explorateur de stockage ──────────────────────────────────────────────

#[derive(Serialize)]
struct Entry { name: String, path: String, size: u64, files: u64, dir: bool }

#[tauri::command]
pub fn storage_scan(app: AppHandle, path: String) -> u64 {
    jobs::spawn(&app, "storage-explorer", move |ctx| {
        let root = PathBuf::from(&path);
        let mut entries: HashMap<PathBuf, Entry> = HashMap::new();
        let mut largest: Vec<(u64, PathBuf)> = Vec::new();
        let mut count = 0u64;
        for child in std::fs::read_dir(&root)?.filter_map(Result::ok) {
            let p = child.path();
            let dir = child.file_type().map(|t| t.is_dir()).unwrap_or(false);
            entries.insert(p.clone(), Entry { name: child.file_name().to_string_lossy().into_owned(), path: p.display().to_string(), size: 0, files: 0, dir });
        }
        for e in WalkDir::new(&root).min_depth(1).into_iter().filter_map(Result::ok) {
            ctx.check()?;
            if !e.file_type().is_file() { continue; }
            let len = e.metadata().map(|m| m.len()).unwrap_or(0);
            count += 1;
            if count % 2000 == 0 { ctx.progress(None, format!("{count} fichiers analysés")); }
            let top = e.path().strip_prefix(&root).ok().and_then(|r| r.components().next()).map(|c| root.join(c));
            if let Some(ent) = top.and_then(|t| entries.get_mut(&t)) {
                ent.size += len;
                ent.files += 1;
            }
            if len > 50 << 20 {
                largest.push((len, e.into_path()));
            }
        }
        let mut list: Vec<Entry> = entries.into_values().collect();
        list.sort_by(|a, b| b.size.cmp(&a.size));
        largest.sort_by(|a, b| b.0.cmp(&a.0));
        largest.truncate(30);
        let total: u64 = list.iter().map(|e| e.size).sum();
        Ok(json!({ "path": path, "total": total, "files": count, "entries": list,
            "largest": largest.iter().map(|(s, p)| json!({ "size": s, "path": p.display().to_string() })).collect::<Vec<_>>(),
            "disk": disk_space(&root) }))
    })
}

fn dir_size(p: &Path) -> (u64, u64) {
    WalkDir::new(p).into_iter().filter_map(Result::ok).filter(|e| e.file_type().is_file()).fold((0, 0), |(s, n), e| (s + e.metadata().map(|m| m.len()).unwrap_or(0), n + 1))
}

/// Espaces récupérables sans risque.
#[tauri::command]
pub fn storage_hogs() -> Value {
    let temp = std::env::temp_dir();
    let (ts, tn) = dir_size(&temp);
    let mut out = vec![json!({ "id": "temp", "label": "Fichiers temporaires", "detail": temp.display().to_string(), "size": ts, "count": tn })];
    if let Some(dl) = dirs::download_dir() {
        let installers: Vec<_> = std::fs::read_dir(&dl).into_iter().flatten().filter_map(Result::ok)
            .filter(|e| e.path().extension().is_some_and(|x| matches!(x.to_string_lossy().to_lowercase().as_str(), "exe" | "msi" | "msix" | "iso")))
            .filter_map(|e| e.metadata().ok().map(|m| m.len())).collect();
        out.push(json!({ "id": "installers", "label": "Installeurs dans Téléchargements", "detail": "fichiers .exe, .msi, .iso (mis à la corbeille)", "size": installers.iter().sum::<u64>(), "count": installers.len() }));
    }
    #[cfg(windows)]
    if let Some((size, count)) = win::recycle_bin() {
        out.push(json!({ "id": "recycle", "label": "Corbeille", "detail": "vidage définitif", "size": size, "count": count }));
    }
    json!(out)
}

#[tauri::command]
pub fn storage_clean(id: String) -> Result<u64, String> {
    match id.as_str() {
        "temp" => {
            let cutoff = std::time::SystemTime::now() - Duration::from_secs(24 * 3600);
            let mut freed = 0;
            for e in std::fs::read_dir(std::env::temp_dir()).map_err(|e| e.to_string())?.filter_map(Result::ok) {
                let p = e.path();
                // Seulement ce qui n'a pas bougé depuis 24 h : les apps ouvertes gardent leurs fichiers.
                if e.metadata().and_then(|m| m.modified()).map(|t| t > cutoff).unwrap_or(true) { continue; }
                let (s, _) = dir_size(&p);
                let ok = if p.is_dir() { std::fs::remove_dir_all(&p).is_ok() } else { std::fs::remove_file(&p).is_ok() };
                if ok { freed += s; }
            }
            Ok(freed)
        }
        "installers" => {
            let dl = dirs::download_dir().ok_or("Téléchargements introuvable")?;
            let files: Vec<PathBuf> = std::fs::read_dir(&dl).map_err(|e| e.to_string())?.filter_map(Result::ok).map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|x| matches!(x.to_string_lossy().to_lowercase().as_str(), "exe" | "msi" | "msix" | "iso"))).collect();
            let size = files.iter().filter_map(|p| p.metadata().ok()).map(|m| m.len()).sum();
            trash::delete_all(&files).map_err(|e| e.to_string())?;
            Ok(size)
        }
        #[cfg(windows)]
        "recycle" => win::empty_recycle_bin(),
        _ => Err("inconnu".into()),
    }
}

fn disk_space(p: &Path) -> Value {
    #[cfg(windows)]
    if let Some((free, total)) = win::disk_free(p) {
        return json!({ "free": free, "total": total });
    }
    let _ = p;
    Value::Null
}

// ── 73 Empêcher la veille ───────────────────────────────────────────────────

struct Awake { stop: Arc<AtomicBool>, until: Option<u64> }
static AWAKE: Mutex<Option<Awake>> = Mutex::new(None);

#[tauri::command]
pub fn keep_awake_start(minutes: Option<u64>, display: bool) -> Result<(), String> {
    keep_awake_stop();
    #[cfg(not(windows))]
    let _ = display;
    if !cfg!(windows) { return Err(WINDOWS_ONLY.into()); }
    let stop = Arc::new(AtomicBool::new(false));
    let until = minutes.map(|m| chrono::Utc::now().timestamp() as u64 + m * 60);
    let s = stop.clone();
    std::thread::spawn(move || {
        #[cfg(windows)]
        win::hold_awake(display, true);
        while !s.load(Ordering::Relaxed) && until.is_none_or(|u| (chrono::Utc::now().timestamp() as u64) < u) {
            std::thread::sleep(Duration::from_secs(1));
        }
        #[cfg(windows)]
        win::hold_awake(display, false);
        let mut g = AWAKE.lock().unwrap();
        if g.as_ref().is_some_and(|a| Arc::ptr_eq(&a.stop, &s)) { *g = None; }
    });
    *AWAKE.lock().unwrap() = Some(Awake { stop, until });
    Ok(())
}

#[tauri::command]
pub fn keep_awake_stop() {
    if let Some(a) = AWAKE.lock().unwrap().take() { a.stop.store(true, Ordering::Relaxed); }
}

#[tauri::command]
pub fn keep_awake_status() -> Value {
    match AWAKE.lock().unwrap().as_ref() {
        Some(a) => json!({ "active": true, "until": a.until }),
        None => json!({ "active": false }),
    }
}

// ── Commandes Windows (avec repli) ──────────────────────────────────────────

macro_rules! win_cmd {
    ($(#[$m:meta])* fn $name:ident($($arg:ident : $t:ty),*) -> $ret:ty => $body:expr) => {
        $(#[$m])*
        #[tauri::command]
        pub fn $name($($arg: $t),*) -> Result<$ret, String> {
            #[cfg(windows)] { $body }
            #[cfg(not(windows))] { $(let _ = $arg;)* Err(WINDOWS_ONLY.into()) }
        }
    };
}

win_cmd!(/// 71 Profils Wi-Fi enregistrés et leur clé.
    fn wifi_profiles() -> Value => win::wifi_profiles());
win_cmd!(/// 72 Santé de la batterie.
    fn battery_info() -> Value => win::battery_info());
win_cmd!(/// 74 Applications installées.
    fn apps_list() -> Value => win::apps_list());
win_cmd!(fn app_uninstall(command: String) -> () => win::run_uninstaller(&command));
win_cmd!(/// 75 Mode présentation.
    fn presentation_mode(on: bool) -> () => win::presentation_mode(on));
win_cmd!(/// 76 Verrouille le clavier pendant `seconds`.
    fn keyboard_lock(seconds: u64) -> () => win::keyboard_lock(seconds));
win_cmd!(fn keyboard_unlock() -> () => { win::keyboard_unlock(); Ok(()) });
win_cmd!(/// 78 Lecteurs amovibles et images disque.
    fn drives_list() -> Value => win::drives_list());
win_cmd!(fn drives_eject(letters: Vec<String>) -> Value => win::drives_eject(&letters));
win_cmd!(/// 79 Démarrage.
    fn startup_list() -> Value => win::startup_list());
win_cmd!(fn startup_set(source: String, name: String, enabled: bool) -> () => win::startup_set(&source, &name, enabled));
win_cmd!(/// 81 Accès caméra / micro / position par app.
    fn privacy_list() -> Value => win::privacy_list());
win_cmd!(fn privacy_reset(key: String) -> () => win::privacy_reset(&key));
win_cmd!(/// 82 Réglages cachés.
    fn tweaks_list() -> Value => win::tweaks_list());
win_cmd!(fn tweak_set(id: String, enabled: bool) -> () => win::tweak_set(&id, enabled));
win_cmd!(fn explorer_restart() -> () => win::explorer_restart());
win_cmd!(/// 83 Écrans externes (DDC/CI).
    fn monitors_list() -> Value => win::monitors_list());
win_cmd!(fn monitor_set(index: usize, code: u8, value: u32) -> () => win::monitor_set(index, code, value));
win_cmd!(/// 84 Souris.
    fn mouse_get() -> Value => win::mouse_get());
win_cmd!(fn mouse_set(wheel_lines: u32, speed: u32, accel: bool) -> () => win::mouse_set(wheel_lines, speed, accel));
win_cmd!(fn mouse_natural_scroll(enabled: bool) -> () => win::mouse_natural_scroll(enabled));

// ── 80 Débloquer un fichier téléchargé ──────────────────────────────────────

/// Origine (flux Zone.Identifier) et signature d'un fichier.
#[tauri::command]
pub fn file_trust(path: String) -> Result<Value, String> {
    let ads = std::fs::read_to_string(format!("{path}:Zone.Identifier")).ok();
    let zone = ads.as_ref().map(|t| {
        let get = |k: &str| t.lines().find_map(|l| l.strip_prefix(k)).map(|s| s.trim().to_string());
        json!({ "zoneId": get("ZoneId="), "hostUrl": get("HostUrl="), "referrerUrl": get("ReferrerUrl=") })
    });
    #[cfg(windows)]
    let signature = win::authenticode(&path).unwrap_or(Value::Null);
    #[cfg(not(windows))]
    let signature = Value::Null;
    Ok(json!({ "blocked": zone.is_some(), "zone": zone, "signature": signature }))
}

#[tauri::command]
pub fn file_unblock(path: String) -> Result<(), String> {
    std::fs::remove_file(format!("{path}:Zone.Identifier")).map_err(|e| format!("Impossible de débloquer : {e}"))
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::*;
    use winreg::enums::*;
    use winreg::RegKey;

    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(Some(0)).collect()
    }
    fn from_wide(p: &[u16]) -> String {
        let n = p.iter().position(|&c| c == 0).unwrap_or(p.len());
        String::from_utf16_lossy(&p[..n])
    }
    fn ps(script: &str, envs: &[(&str, &str)]) -> Result<String, String> {
        let mut c = crate::engines::command(Path::new("powershell"));
        c.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]);
        for (k, v) in envs { c.env(k, v); }
        let o = c.output().map_err(|e| e.to_string())?;
        if o.status.success() { Ok(String::from_utf8_lossy(&o.stdout).into_owned()) } else { Err(String::from_utf8_lossy(&o.stderr).trim().to_string()) }
    }

    // Stockage
    pub fn recycle_bin() -> Option<(u64, u64)> {
        use windows::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};
        let mut info = SHQUERYRBINFO { cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32, ..Default::default() };
        unsafe { SHQueryRecycleBinW(PCWSTR::null(), &mut info).ok()? };
        Some((info.i64Size as u64, info.i64NumItems as u64))
    }
    pub fn empty_recycle_bin() -> Result<u64, String> {
        use windows::Win32::UI::Shell::{SHEmptyRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND};
        let size = recycle_bin().map(|r| r.0).unwrap_or(0);
        unsafe { SHEmptyRecycleBinW(None, PCWSTR::null(), SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND) }.map_err(|e| e.to_string())?;
        Ok(size)
    }
    pub fn disk_free(p: &Path) -> Option<(u64, u64)> {
        use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let w = wide(&p.display().to_string());
        let (mut free, mut total) = (0u64, 0u64);
        unsafe { GetDiskFreeSpaceExW(PCWSTR(w.as_ptr()), Some(&mut free), Some(&mut total), None).ok()? };
        Some((free, total))
    }

    // Veille
    pub fn hold_awake(display: bool, on: bool) {
        use windows::Win32::System::Power::*;
        let flags = if on { ES_CONTINUOUS | ES_SYSTEM_REQUIRED | if display { ES_DISPLAY_REQUIRED } else { EXECUTION_STATE(0) } } else { ES_CONTINUOUS };
        unsafe { SetThreadExecutionState(flags) };
    }

    // Wi-Fi
    pub fn wifi_profiles() -> Result<Value, String> {
        use windows::Win32::NetworkManagement::WiFi::*;
        let mut out = Vec::new();
        unsafe {
            let mut ver = 0u32;
            let mut h = HANDLE::default();
            if WlanOpenHandle(2, None, &mut ver, &mut h) != 0 { return Err("Service Wi-Fi indisponible.".into()); }
            let mut ifs: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
            if WlanEnumInterfaces(h, None, &mut ifs) == 0 && !ifs.is_null() {
                let list = std::slice::from_raw_parts((*ifs).InterfaceInfo.as_ptr(), (*ifs).dwNumberOfItems as usize);
                for itf in list {
                    let mut profiles: *mut WLAN_PROFILE_INFO_LIST = std::ptr::null_mut();
                    if WlanGetProfileList(h, &itf.InterfaceGuid, None, &mut profiles) != 0 || profiles.is_null() { continue; }
                    let ps = std::slice::from_raw_parts((*profiles).ProfileInfo.as_ptr(), (*profiles).dwNumberOfItems as usize);
                    for p in ps {
                        let mut xml = PWSTR::null();
                        let mut flags = WLAN_PROFILE_GET_PLAINTEXT_KEY;
                        if WlanGetProfile(h, &itf.InterfaceGuid, PCWSTR(p.strProfileName.as_ptr()), None, &mut xml, Some(&mut flags), None) == 0 {
                            let x = xml.to_string().unwrap_or_default();
                            WlanFreeMemory(xml.0 as _);
                            let tag = |t: &str| x.split(&format!("<{t}>")).nth(1).and_then(|s| s.split(&format!("</{t}>")).next()).map(|s| s.to_string());
                            out.push(json!({ "ssid": tag("name").unwrap_or_else(|| from_wide(&p.strProfileName)), "password": tag("keyMaterial"), "auth": tag("authentication") }));
                        }
                    }
                    WlanFreeMemory(profiles as _);
                }
                WlanFreeMemory(ifs as _);
            }
            WlanCloseHandle(h, None);
        }
        Ok(json!(out))
    }

    // Batterie
    pub fn battery_info() -> Result<Value, String> {
        use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
        let mut st = SYSTEM_POWER_STATUS::default();
        unsafe { GetSystemPowerStatus(&mut st) }.map_err(|e| e.to_string())?;
        if st.BatteryFlag == 128 { return Ok(json!({ "present": false })); }
        let xml_path = std::env::temp_dir().join("toolbox-battery.xml");
        let _ = crate::engines::command(Path::new("powercfg")).args(["/batteryreport", "/xml", "/output"]).arg(&xml_path).output();
        let xml = std::fs::read(&xml_path).ok().map(|b| {
            // Le rapport est en UTF-16 avec BOM ou UTF-8 selon les versions.
            if b.starts_with(&[0xFF, 0xFE]) { String::from_utf16_lossy(&b[2..].chunks(2).map(|c| u16::from_le_bytes([c[0], *c.get(1).unwrap_or(&0)])).collect::<Vec<_>>()) } else { String::from_utf8_lossy(&b).into_owned() }
        }).unwrap_or_default();
        let _ = std::fs::remove_file(&xml_path);
        let tag = |t: &str| xml.split(&format!("<{t}>")).nth(1).and_then(|s| s.split('<').next()).and_then(|s| s.trim().parse::<f64>().ok());
        let (design, full, cycles) = (tag("DesignCapacity"), tag("FullChargeCapacity"), tag("CycleCount"));
        let name = xml.split("<Id>").nth(1).and_then(|s| s.split('<').next()).map(str::to_string);
        Ok(json!({ "present": true, "percent": if st.BatteryLifePercent <= 100 { Some(st.BatteryLifePercent) } else { None },
            "ac": st.ACLineStatus == 1, "designMwh": design, "fullMwh": full, "cycles": cycles,
            "healthPct": design.zip(full).map(|(d, f)| (f / d * 100.0).round()), "name": name,
            "secondsLeft": if st.BatteryLifeTime != u32::MAX { Some(st.BatteryLifeTime) } else { None } }))
    }

    // Applications
    pub fn apps_list() -> Result<Value, String> {
        let mut seen = std::collections::HashSet::new();
        let mut apps = Vec::new();
        let roots = [
            (HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
            (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
            (HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
        ];
        for (hive, path) in roots {
            let Ok(k) = RegKey::predef(hive).open_subkey(path) else { continue };
            for sub in k.enum_keys().filter_map(Result::ok) {
                let Ok(a) = k.open_subkey(&sub) else { continue };
                let name: String = a.get_value("DisplayName").unwrap_or_default();
                let uninstall: String = a.get_value("QuietUninstallString").or_else(|_| a.get_value("UninstallString")).unwrap_or_default();
                let system: u32 = a.get_value("SystemComponent").unwrap_or(0);
                if name.is_empty() || uninstall.is_empty() || system == 1 || !seen.insert(name.to_lowercase()) { continue; }
                let size_kb: u32 = a.get_value("EstimatedSize").unwrap_or(0);
                apps.push(json!({ "name": name, "publisher": a.get_value::<String, _>("Publisher").ok(), "version": a.get_value::<String, _>("DisplayVersion").ok(),
                    "location": a.get_value::<String, _>("InstallLocation").ok().filter(|s| !s.is_empty()), "size": size_kb as u64 * 1024,
                    "uninstall": uninstall, "installDate": a.get_value::<String, _>("InstallDate").ok() }));
            }
        }
        apps.sort_by_key(|a| a["name"].as_str().unwrap_or("").to_lowercase());
        Ok(json!(apps))
    }
    pub fn run_uninstaller(command: &str) -> Result<(), String> {
        // La commande vient du registre ; on la confie à cmd tel quel, comme le fait Windows.
        crate::engines::command(Path::new("cmd")).args(["/C", command]).spawn().map(|_| ()).map_err(|e| e.to_string())
    }

    // Mode présentation
    static SAVED: Mutex<Option<(bool, u32, u32)>> = Mutex::new(None);
    fn desktop_icons_visible() -> bool {
        RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced").and_then(|k| k.get_value::<u32, _>("HideIcons")).unwrap_or(0) == 0
    }
    fn toggle_desktop_icons() {
        use windows::Win32::UI::WindowsAndMessaging::*;
        unsafe {
            let progman = FindWindowW(windows::core::w!("Progman"), PCWSTR::null()).unwrap_or_default();
            let mut view = FindWindowExW(Some(progman), None, windows::core::w!("SHELLDLL_DefView"), PCWSTR::null()).unwrap_or_default();
            if view.is_invalid() {
                // Avec un fond d'écran animé, la vue est sous un WorkerW.
                let mut w = HWND::default();
                loop {
                    w = FindWindowExW(None, Some(w), windows::core::w!("WorkerW"), PCWSTR::null()).unwrap_or_default();
                    if w.is_invalid() { break; }
                    view = FindWindowExW(Some(w), None, windows::core::w!("SHELLDLL_DefView"), PCWSTR::null()).unwrap_or_default();
                    if !view.is_invalid() { break; }
                }
            }
            if !view.is_invalid() { let _ = SendMessageW(view, WM_COMMAND, Some(WPARAM(0x7402)), Some(LPARAM(0))); }
        }
    }
    fn taskbar_autohide(on: Option<bool>) -> u32 {
        use windows::Win32::UI::Shell::*;
        let mut abd = APPBARDATA { cbSize: std::mem::size_of::<APPBARDATA>() as u32, ..Default::default() };
        let state = unsafe { SHAppBarMessage(ABM_GETSTATE, &mut abd) } as u32;
        if let Some(on) = on {
            abd.lParam = LPARAM(if on { ABS_AUTOHIDE as isize } else { 0 });
            unsafe { SHAppBarMessage(ABM_SETSTATE, &mut abd) };
        }
        state
    }
    fn toasts(enabled: Option<bool>) -> u32 {
        let (k, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(r"Software\Microsoft\Windows\CurrentVersion\PushNotifications").unwrap();
        let cur: u32 = k.get_value("ToastEnabled").unwrap_or(1);
        if let Some(e) = enabled { let _ = k.set_value("ToastEnabled", &(e as u32)); }
        cur
    }
    pub fn presentation_mode(on: bool) -> Result<(), String> {
        let mut saved = SAVED.lock().unwrap();
        if on {
            if saved.is_some() { return Ok(()); }
            let icons = desktop_icons_visible();
            if icons { toggle_desktop_icons(); }
            let tb = taskbar_autohide(Some(true));
            let toast = toasts(Some(false));
            *saved = Some((icons, tb, toast));
            drop(saved);
            super::keep_awake_start(None, true)?;
        } else if let Some((icons, tb, toast)) = saved.take() {
            if icons && !desktop_icons_visible() { toggle_desktop_icons(); }
            taskbar_autohide(Some(tb & 1 != 0));
            toasts(Some(toast != 0));
            super::keep_awake_stop();
        }
        Ok(())
    }

    // Clavier
    static HOOK_THREAD: Mutex<Option<u32>> = Mutex::new(None);
    unsafe extern "system" fn swallow(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
        use windows::Win32::UI::WindowsAndMessaging::{CallNextHookEx, HC_ACTION};
        if code == HC_ACTION as i32 { return LRESULT(1); }
        unsafe { CallNextHookEx(None, code, w, l) }
    }
    pub fn keyboard_lock(seconds: u64) -> Result<(), String> {
        use windows::Win32::System::LibraryLoader::GetModuleHandleW;
        use windows::Win32::System::Threading::GetCurrentThreadId;
        use windows::Win32::UI::WindowsAndMessaging::*;
        keyboard_unlock();
        std::thread::spawn(move || unsafe {
            let module = GetModuleHandleW(PCWSTR::null()).ok();
            let Ok(hook) = SetWindowsHookExW(WH_KEYBOARD_LL, Some(swallow), module.map(|m| HINSTANCE(m.0)), 0) else { return };
            let tid = GetCurrentThreadId();
            *HOOK_THREAD.lock().unwrap() = Some(tid);
            let timer = SetTimer(None, 0, (seconds * 1000) as u32, None);
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                if msg.message == WM_TIMER || msg.message == WM_QUIT { break; }
                DispatchMessageW(&msg);
            }
            let _ = KillTimer(None, timer);
            let _ = UnhookWindowsHookEx(hook);
            let mut g = HOOK_THREAD.lock().unwrap();
            if *g == Some(tid) { *g = None; }
        });
        Ok(())
    }
    pub fn keyboard_unlock() {
        use windows::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_QUIT};
        if let Some(tid) = HOOK_THREAD.lock().unwrap().take() {
            unsafe { let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0)); }
        }
    }

    // Lecteurs
    pub fn drives_list() -> Result<Value, String> {
        use windows::Win32::Storage::FileSystem::*;
        let mask = unsafe { GetLogicalDrives() };
        let sys = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()).to_uppercase();
        let mut out = Vec::new();
        for i in 0..26 {
            if mask & (1 << i) == 0 { continue; }
            let letter = format!("{}:", (b'A' + i as u8) as char);
            if letter == sys { continue; }
            let root = wide(&format!("{letter}\\"));
            let kind = unsafe { GetDriveTypeW(PCWSTR(root.as_ptr())) };
            let kind = match kind { 2 => "removable", 3 => "fixed", 5 => "cdrom", 4 => "network", _ => continue };
            if kind == "network" { continue; }
            let mut label = [0u16; 128];
            let _ = unsafe { GetVolumeInformationW(PCWSTR(root.as_ptr()), Some(&mut label), None, None, None, None) };
            let size = disk_free(Path::new(&format!("{letter}\\")));
            out.push(json!({ "letter": letter, "kind": kind, "label": from_wide(&label), "free": size.map(|s| s.0), "total": size.map(|s| s.1) }));
        }
        Ok(json!(out))
    }
    pub fn drives_eject(letters: &[String]) -> Result<Value, String> {
        let mut res = Vec::new();
        for l in letters {
            let r = ps("$d=(New-Object -ComObject Shell.Application).Namespace(17).ParseName($env:TB_DRIVE); if($d){$d.InvokeVerb('Eject')} else {throw 'introuvable'}", &[("TB_DRIVE", l)]);
            res.push(json!({ "letter": l, "ok": r.is_ok(), "error": r.err() }));
        }
        Ok(json!(res))
    }

    // Démarrage
    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved";
    fn approved(hive: winreg::HKEY, sub: &str, name: &str) -> bool {
        RegKey::predef(hive).open_subkey(format!(r"{APPROVED}\{sub}")).and_then(|k| k.get_raw_value(name)).map(|v| v.bytes.first().is_none_or(|b| b & 1 == 0)).unwrap_or(true)
    }
    pub fn startup_list() -> Result<Value, String> {
        let mut out = Vec::new();
        for (hive, label, editable) in [(HKEY_CURRENT_USER, "user", true), (HKEY_LOCAL_MACHINE, "machine", false)] {
            if let Ok(k) = RegKey::predef(hive).open_subkey(RUN) {
                for (name, v) in k.enum_values().filter_map(Result::ok) {
                    out.push(json!({ "source": format!("run-{label}"), "name": name, "command": v.to_string(), "enabled": approved(hive, "Run", &name), "editable": editable }));
                }
            }
        }
        if let Some(dir) = dirs::config_dir().map(|d| d.join(r"Microsoft\Windows\Start Menu\Programs\Startup")) {
            for e in std::fs::read_dir(dir).into_iter().flatten().filter_map(Result::ok) {
                let name = e.file_name().to_string_lossy().into_owned();
                if name.eq_ignore_ascii_case("desktop.ini") { continue; }
                out.push(json!({ "source": "folder-user", "name": name, "command": e.path().display().to_string(), "enabled": approved(HKEY_CURRENT_USER, "StartupFolder", &name), "editable": true }));
            }
        }
        Ok(json!(out))
    }
    pub fn startup_set(source: &str, name: &str, enabled: bool) -> Result<(), String> {
        let sub = match source { "run-user" => "Run", "folder-user" => "StartupFolder", _ => return Err("Cet élément concerne tous les utilisateurs : modifie-le depuis le Gestionnaire des tâches (droits administrateur).".into()) };
        let (k, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(format!(r"{APPROVED}\{sub}")).map_err(|e| e.to_string())?;
        let mut bytes = vec![if enabled { 2u8 } else { 3u8 }, 0, 0, 0];
        let ft = (chrono::Utc::now().timestamp() as u64 + 11_644_473_600) * 10_000_000;
        bytes.extend_from_slice(&ft.to_le_bytes());
        k.set_raw_value(name, &winreg::RegValue { bytes: bytes.into(), vtype: REG_BINARY }).map_err(|e| e.to_string())
    }

    // Confidentialité
    const CONSENT: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore";
    pub fn privacy_list() -> Result<Value, String> {
        let mut out = Vec::new();
        let store = RegKey::predef(HKEY_CURRENT_USER).open_subkey(CONSENT).map_err(|e| e.to_string())?;
        for cap in ["webcam", "microphone", "location", "screenshot"] {
            let Ok(c) = store.open_subkey(cap) else { continue };
            let mut add = |k: &RegKey, name: String, key: String, packaged: bool| {
                let value: String = k.get_value("Value").unwrap_or_default();
                let last: u64 = k.get_value("LastUsedTimeStop").or_else(|_| k.get_value("LastUsedTimeStart")).unwrap_or(0);
                let last = (last > 0).then(|| (last / 10_000_000).saturating_sub(11_644_473_600));
                out.push(json!({ "capability": cap, "app": name, "key": key, "value": value, "lastUsed": last, "packaged": packaged }));
            };
            if let Ok(np) = c.open_subkey("NonPackaged") {
                for sub in np.enum_keys().filter_map(Result::ok) {
                    if let Ok(k) = np.open_subkey(&sub) { add(&k, sub.replace('#', "\\"), format!(r"{cap}\NonPackaged\{sub}"), false); }
                }
            }
            for sub in c.enum_keys().filter_map(Result::ok).filter(|s| s != "NonPackaged") {
                if let Ok(k) = c.open_subkey(&sub) { add(&k, sub.split('_').next().unwrap_or(&sub).to_string(), format!(r"{cap}\{sub}"), true); }
            }
        }
        Ok(json!(out))
    }
    pub fn privacy_reset(key: &str) -> Result<(), String> {
        if key.contains("..") { return Err("clé invalide".into()); }
        let store = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(CONSENT, KEY_ALL_ACCESS).map_err(|e| e.to_string())?;
        if key.contains(r"\NonPackaged\") {
            store.delete_subkey_all(key).map_err(|e| e.to_string())
        } else {
            // Applis du Store : revenir à « demander ».
            store.open_subkey_with_flags(key, KEY_SET_VALUE).and_then(|k| k.set_value("Value", &"Prompt")).map_err(|e| e.to_string())
        }
    }

    // Réglages cachés
    struct Tweak { id: &'static str, label: &'static str, detail: &'static str, path: &'static str, name: &'static str, on: u32, off: Option<u32>, restart: bool }
    const ADV: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced";
    const TWEAKS: &[Tweak] = &[
        Tweak { id: "ext", label: "Afficher les extensions de fichiers", detail: "« photo.jpg » plutôt que « photo »", path: ADV, name: "HideFileExt", on: 0, off: Some(1), restart: true },
        Tweak { id: "hidden", label: "Afficher les fichiers cachés", detail: "Dans l'Explorateur", path: ADV, name: "Hidden", on: 1, off: Some(2), restart: true },
        Tweak { id: "seconds", label: "Secondes dans l'horloge", detail: "Barre des tâches", path: ADV, name: "ShowSecondsInSystemClock", on: 1, off: Some(0), restart: true },
        Tweak { id: "thispc", label: "Ouvrir l'Explorateur sur « Ce PC »", detail: "Au lieu de « Accueil »", path: ADV, name: "LaunchTo", on: 1, off: Some(2), restart: false },
        Tweak { id: "endtask", label: "« Fin de tâche » dans la barre des tâches", detail: "Clic droit sur une app ouverte", path: r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced\TaskbarDeveloperSettings", name: "TaskbarEndTask", on: 1, off: Some(0), restart: true },
        Tweak { id: "bing", label: "Pas de résultats web dans la recherche", detail: "Recherche du menu Démarrer locale seulement", path: r"Software\Policies\Microsoft\Windows\Explorer", name: "DisableSearchBoxSuggestions", on: 1, off: None, restart: true },
        Tweak { id: "compact", label: "Explorateur compact", detail: "Lignes plus serrées", path: ADV, name: "UseCompactMode", on: 1, off: Some(0), restart: true },
        Tweak { id: "classicmenu", label: "Ancien menu contextuel (Windows 11)", detail: "Toutes les options sans « Afficher plus d'options »", path: r"Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\InprocServer32", name: "", on: 0, off: None, restart: true },
    ];
    fn tweak_state(t: &Tweak) -> bool {
        let k = RegKey::predef(HKEY_CURRENT_USER).open_subkey(t.path);
        if t.id == "classicmenu" { return k.is_ok(); }
        k.and_then(|k| k.get_value::<u32, _>(t.name)).map(|v| v == t.on).unwrap_or(false)
    }
    pub fn tweaks_list() -> Result<Value, String> {
        Ok(json!(TWEAKS.iter().map(|t| json!({ "id": t.id, "label": t.label, "detail": t.detail, "enabled": tweak_state(t), "restart": t.restart })).collect::<Vec<_>>()))
    }
    pub fn tweak_set(id: &str, enabled: bool) -> Result<(), String> {
        let t = TWEAKS.iter().find(|t| t.id == id).ok_or("réglage inconnu")?;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if t.id == "classicmenu" {
            return if enabled {
                hkcu.create_subkey(t.path).and_then(|(k, _)| k.set_value("", &"")).map_err(|e| e.to_string())
            } else {
                hkcu.delete_subkey_all(r"Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}").or_else(|e| if e.kind() == std::io::ErrorKind::NotFound { Ok(()) } else { Err(e) }).map_err(|e| e.to_string())
            };
        }
        let (k, _) = hkcu.create_subkey(t.path).map_err(|e| e.to_string())?;
        match (enabled, t.off) {
            (true, _) => k.set_value(t.name, &t.on),
            (false, Some(off)) => k.set_value(t.name, &off),
            (false, None) => k.delete_value(t.name).or(Ok(())),
        }.map_err(|e| e.to_string())
    }
    pub fn explorer_restart() -> Result<(), String> {
        ps("Stop-Process -Name explorer -Force; Start-Sleep -Milliseconds 800; if(-not (Get-Process explorer -ErrorAction SilentlyContinue)){ Start-Process explorer }", &[]).map(|_| ())
    }

    // Écrans DDC/CI
    use windows::Win32::Devices::Display::*;
    use windows::Win32::Graphics::Gdi::*;
    fn physical_monitors() -> Vec<PHYSICAL_MONITOR> {
        unsafe extern "system" fn cb(m: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> windows::core::BOOL {
            let v = unsafe { &mut *(data.0 as *mut Vec<HMONITOR>) };
            v.push(m);
            true.into()
        }
        let mut handles: Vec<HMONITOR> = Vec::new();
        unsafe { let _ = EnumDisplayMonitors(None, None, Some(cb), LPARAM(&mut handles as *mut _ as isize)); }
        let mut out = Vec::new();
        for h in handles {
            let mut n = 0u32;
            if unsafe { GetNumberOfPhysicalMonitorsFromHMONITOR(h, &mut n) }.is_err() || n == 0 { continue; }
            let mut arr = vec![PHYSICAL_MONITOR::default(); n as usize];
            if unsafe { GetPhysicalMonitorsFromHMONITOR(h, &mut arr) }.is_ok() { out.extend(arr); }
        }
        out
    }
    fn vcp(h: HANDLE, code: u8) -> Option<(u32, u32)> {
        let (mut cur, mut max) = (0u32, 0u32);
        (unsafe { GetVCPFeatureAndVCPFeatureReply(h, code, None, &mut cur, Some(&mut max)) } != 0).then_some((cur, max))
    }
    pub fn monitors_list() -> Result<Value, String> {
        let mons = physical_monitors();
        let out: Vec<Value> = mons.iter().enumerate().map(|(i, m)| {
            let f = |c: u8| vcp(m.hPhysicalMonitor, c).map(|(c, x)| json!({ "value": c, "max": x }));
            let desc = m.szPhysicalMonitorDescription;
            json!({ "index": i, "name": from_wide(&desc), "brightness": f(0x10), "contrast": f(0x12), "volume": f(0x62) })
        }).collect();
        unsafe { let _ = DestroyPhysicalMonitors(&mons); }
        Ok(json!(out))
    }
    pub fn monitor_set(index: usize, code: u8, value: u32) -> Result<(), String> {
        if ![0x10, 0x12, 0x62].contains(&code) { return Err("réglage non autorisé".into()); }
        let mons = physical_monitors();
        let r = mons.get(index).map(|m| unsafe { SetVCPFeature(m.hPhysicalMonitor, code, value) } != 0);
        unsafe { let _ = DestroyPhysicalMonitors(&mons); }
        match r { Some(true) => Ok(()), Some(false) => Err("L'écran a refusé le réglage (DDC/CI désactivé dans son menu ?).".into()), None => Err("Écran introuvable.".into()) }
    }

    // Souris
    pub fn mouse_get() -> Result<Value, String> {
        use windows::Win32::UI::WindowsAndMessaging::*;
        let (mut lines, mut speed) = (0u32, 0u32);
        let mut acc = [0i32; 3];
        unsafe {
            SystemParametersInfoW(SPI_GETWHEELSCROLLLINES, 0, Some(&mut lines as *mut _ as _), SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0)).map_err(|e| e.to_string())?;
            SystemParametersInfoW(SPI_GETMOUSESPEED, 0, Some(&mut speed as *mut _ as _), SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0)).map_err(|e| e.to_string())?;
            SystemParametersInfoW(SPI_GETMOUSE, 0, Some(acc.as_mut_ptr() as _), SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0)).map_err(|e| e.to_string())?;
        }
        let natural = ps("$v=@(Get-PnpDevice -Class Mouse -PresentOnly -Status OK | % { (Get-ItemProperty \"HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\$($_.InstanceId)\\Device Parameters\" -ErrorAction SilentlyContinue).FlipFlopWheel }); if($v -contains 1){'1'}else{'0'}", &[]).map(|s| s.trim() == "1").ok();
        Ok(json!({ "wheelLines": lines, "speed": speed, "accel": acc[2] != 0, "naturalScroll": natural }))
    }
    pub fn mouse_set(wheel_lines: u32, speed: u32, accel: bool) -> Result<(), String> {
        use windows::Win32::UI::WindowsAndMessaging::*;
        let f = SPIF_UPDATEINIFILE | SPIF_SENDCHANGE;
        let mut acc = if accel { [6i32, 10, 1] } else { [0i32, 0, 0] };
        unsafe {
            SystemParametersInfoW(SPI_SETWHEELSCROLLLINES, wheel_lines.clamp(1, 100), None, f).map_err(|e| e.to_string())?;
            SystemParametersInfoW(SPI_SETMOUSESPEED, 0, Some(speed.clamp(1, 20) as usize as _), f).map_err(|e| e.to_string())?;
            SystemParametersInfoW(SPI_SETMOUSE, 0, Some(acc.as_mut_ptr() as _), f).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    pub fn mouse_natural_scroll(enabled: bool) -> Result<(), String> {
        let v = enabled as u8;
        let inner = format!("Get-PnpDevice -Class Mouse -PresentOnly | % {{ Set-ItemProperty \\\"HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\$($_.InstanceId)\\Device Parameters\\\" -Name FlipFlopWheel -Value {v} -Type DWord -ErrorAction SilentlyContinue }}");
        ps(&format!("Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile','-Command',\"{inner}\""), &[]).map(|_| ())
            .map_err(|e| if e.contains("canceled") || e.contains("annul") { "Autorisation administrateur refusée.".into() } else { e })
    }

    // Signature
    pub fn authenticode(path: &str) -> Option<Value> {
        let out = ps("$s=Get-AuthenticodeSignature -LiteralPath $env:TB_IN; [pscustomobject]@{status=[string]$s.Status; signer=$s.SignerCertificate.Subject} | ConvertTo-Json -Compress", &[("TB_IN", path)]).ok()?;
        let v: Value = serde_json::from_str(out.trim()).ok()?;
        let signer = v["signer"].as_str().and_then(|s| s.split(',').find_map(|p| p.trim().strip_prefix("CN=").map(|x| x.trim_matches('"').to_string())));
        Some(json!({ "status": v["status"], "signer": signer }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn median_works() {
        assert_eq!(median(vec![3.0, 1.0, 2.0]), 2.0);
        assert_eq!(median(vec![]), 0.0);
    }

    #[test]
    fn trust_reads_zone_identifier_shape() {
        // Sous Linux, un fichier sans flux ADS n'est pas bloqué.
        let p = std::env::temp_dir().join(format!("tb-trust-{}", std::process::id()));
        std::fs::write(&p, b"x").unwrap();
        let v = file_trust(p.display().to_string()).unwrap();
        assert_eq!(v["blocked"], false);
        std::fs::remove_file(p).unwrap();
    }
}
