//! Moteurs externes (FFmpeg, yt-dlp, Pandoc) : détection, téléchargement unique, exécution.
//!
//! Ordre de résolution : moteur installé par Toolbox, puis exécutable présent dans le PATH.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Manager};

use crate::jobs::{self, JobCtx, JobError};

pub struct Engine {
    pub id: &'static str,
    pub name: &'static str,
    /// Exécutables fournis (le premier est le principal).
    pub bins: &'static [&'static str],
    /// Fichiers de données (modèles), téléchargés tels quels.
    pub files: &'static [&'static str],
    /// URL directe, ou « github:propriétaire/dépôt:fragment » = fichier de la dernière release dont le nom contient le fragment.
    pub url: &'static str,
    /// Taille approximative affichée avant téléchargement.
    pub size_mb: u32,
    pub license: &'static str,
}

pub const ENGINES: &[Engine] = &[
    Engine {
        id: "ffmpeg",
        name: "FFmpeg",
        bins: &["ffmpeg", "ffprobe"],
        files: &[],
        url: "github:BtbN/FFmpeg-Builds:ffmpeg-n,-latest-win64-gpl-,.zip,!shared",
        size_mb: 90,
        license: "GPL",
    },
    Engine {
        id: "yt-dlp",
        name: "yt-dlp",
        bins: &["yt-dlp"],
        files: &[],
        url: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
        size_mb: 18,
        license: "Unlicense",
    },
    Engine {
        id: "pandoc",
        name: "Pandoc",
        bins: &["pandoc"],
        files: &[],
        url: "https://github.com/jgm/pandoc/releases/download/3.6.4/pandoc-3.6.4-windows-x86_64.zip",
        size_mb: 35,
        license: "GPL",
    },
    Engine { id: "whisper", name: "whisper.cpp", bins: &["whisper-cli"], files: &[], url: "github:ggml-org/whisper.cpp:whisper-bin-x64.zip", size_mb: 8, license: "MIT" },
    Engine { id: "whisper-model", name: "le modèle de reconnaissance vocale", bins: &[], files: &["ggml-small.bin"], url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin", size_mb: 466, license: "MIT" },
    Engine { id: "llama", name: "llama.cpp", bins: &["llama-server"], files: &[], url: "github:ggml-org/llama.cpp:llama-b,-bin-win-cpu-x64.zip", size_mb: 30, license: "MIT" },
    Engine { id: "llm-model", name: "le modèle de langage Llama 3.2", bins: &[], files: &["Llama-3.2-3B-Instruct-Q4_K_M.gguf"], url: "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf", size_mb: 2020, license: "Llama 3.2 Community" },
    Engine { id: "rembg-model", name: "le modèle de détourage", bins: &[], files: &["isnet-general-use.onnx"], url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx", size_mb: 171, license: "Apache-2.0" },
];

/// Chemin d'un fichier de données installé (modèle).
pub fn data_file(app: &AppHandle, engine_id: &str, file: &str) -> Option<PathBuf> {
    let p = engines_dir(app).join(engine_id).join(file);
    p.is_file().then_some(p)
}

#[tauri::command]
pub fn engine_file(app: AppHandle, id: String, file: String) -> Result<String, String> {
    data_file(&app, &id, &file).map(|p| p.display().to_string()).ok_or_else(|| "non installé".into())
}

/// Résout « github:dépôt:a,b,!c » : parcourt les releases récentes (la « latest » est parfois vide)
/// et prend le fichier dont le nom contient a et b mais pas c ; à égalité, la version la plus haute.
fn resolve_url(url: &str) -> Result<String, JobError> {
    let Some(rest) = url.strip_prefix("github:") else { return Ok(url.to_string()) };
    let (repo, spec) = rest.split_once(':').ok_or_else(|| JobError::Failed("URL de moteur invalide".into()))?;
    let mut r = ureq::get(&format!("https://api.github.com/repos/{repo}/releases?per_page=20"))
        .header("User-Agent", "Toolbox")
        .config().timeout_global(Some(Duration::from_secs(30))).build()
        .call()
        .map_err(|e| JobError::Failed(format!("GitHub injoignable ({e}).")))?;
    let text = r.body_mut().read_to_string().map_err(|e| JobError::Failed(e.to_string()))?;
    let releases: serde_json::Value = serde_json::from_str(&text).map_err(|e| JobError::Failed(e.to_string()))?;
    pick_asset(&releases, spec).ok_or_else(|| JobError::Failed(format!("Aucun fichier compatible dans les dernières versions de {repo}.")))
}

pub fn pick_asset(releases: &serde_json::Value, spec: &str) -> Option<String> {
    let (inc, exc): (Vec<&str>, Vec<&str>) = spec.split(',').partition(|p| !p.starts_with('!'));
    let exc: Vec<&str> = exc.iter().map(|e| &e[1..]).collect();
    let version = |n: &str| -> Vec<u64> { n.split(|c: char| !c.is_ascii_digit()).filter_map(|x| x.parse().ok()).collect() };
    for rel in releases.as_array()?.iter().filter(|r| r["draft"] != true) {
        let mut found: Vec<(&str, &str)> = rel["assets"].as_array().into_iter().flatten()
            .filter_map(|a| Some((a["name"].as_str()?, a["browser_download_url"].as_str()?)))
            .filter(|(n, _)| inc.iter().all(|i| n.contains(i)) && !exc.iter().any(|e| n.contains(e)))
            .collect();
        found.sort_by(|a, b| version(b.0).cmp(&version(a.0)));
        if let Some((_, u)) = found.first() { return Some(u.to_string()); }
    }
    None
}

/// Liste de tous les moteurs (pour les Réglages).
#[tauri::command]
pub fn engine_list(app: AppHandle) -> Vec<EngineStatus> {
    ENGINES.iter().filter_map(|e| engine_status(app.clone(), e.id.to_string()).ok()).collect()
}

/// Supprime un moteur installé par Toolbox.
#[tauri::command]
pub fn engine_remove(app: AppHandle, id: String) -> Result<(), String> {
    let e = engine(&id)?;
    let dir = engines_dir(&app).join(e.id);
    if id == "llama" { crate::tools::ai::shutdown_llm(); }
    if dir.exists() { std::fs::remove_dir_all(&dir).map_err(|x| format!("Suppression impossible (moteur en cours d'utilisation ?) : {x}"))?; }
    Ok(())
}

fn engine(id: &str) -> Result<&'static Engine, String> {
    ENGINES.iter().find(|e| e.id == id).ok_or_else(|| format!("moteur inconnu : {id}"))
}

fn exe(name: &str) -> String {
    if cfg!(windows) { format!("{name}.exe") } else { name.to_string() }
}

fn engines_dir(app: &AppHandle) -> PathBuf {
    app.path().app_local_data_dir().unwrap_or_else(|_| std::env::temp_dir()).join("engines")
}

fn which(bin: &str) -> Option<PathBuf> {
    let name = exe(bin);
    std::env::split_paths(&std::env::var_os("PATH")?).map(|d| d.join(&name)).find(|p| p.is_file())
}

/// Cherche un exécutable récursivement (les archives ont souvent un sous-dossier `bin/`).
fn find_in(dir: &Path, name: &str) -> Option<PathBuf> {
    walkdir::WalkDir::new(dir).max_depth(4).into_iter().filter_map(Result::ok).map(|e| e.into_path()).find(|p| p.file_name().is_some_and(|n| n == name.as_ref() as &std::ffi::OsStr))
}

/// Chemin d'un exécutable fourni par un moteur.
pub fn resolve(app: &AppHandle, engine_id: &str, bin: &str) -> Option<PathBuf> {
    find_in(&engines_dir(app).join(engine_id), &exe(bin)).or_else(|| which(bin))
}

pub fn require(app: &AppHandle, engine_id: &str, bin: &str) -> Result<PathBuf, JobError> {
    resolve(app, engine_id, bin).ok_or_else(|| JobError::Failed(format!("{} n'est pas installé.", engine(engine_id).map(|e| e.name).unwrap_or(engine_id))))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    id: &'static str,
    name: &'static str,
    installed: bool,
    from_path: bool,
    size_mb: u32,
    license: &'static str,
    /// Installé par Toolbox (donc supprimable).
    own: bool,
}

#[tauri::command]
pub fn engine_status(app: AppHandle, id: String) -> Result<EngineStatus, String> {
    let e = engine(&id)?;
    let files_ok = e.files.iter().all(|f| data_file(&app, e.id, f).is_some());
    let own = files_ok && e.bins.iter().all(|b| find_in(&engines_dir(&app).join(e.id), &exe(b)).is_some());
    let path = files_ok && !e.bins.is_empty() && e.bins.iter().all(|b| which(b).is_some());
    Ok(EngineStatus { id: e.id, name: e.name, installed: own || path, from_path: !own && path, size_mb: e.size_mb, license: e.license, own })
}

/// Télécharge et installe un moteur (tâche avec progression).
#[tauri::command]
pub fn engine_install(app: AppHandle, id: String) -> Result<u64, String> {
    let e = engine(&id)?;
    if !cfg!(windows) && !e.bins.is_empty() {
        return Err(format!("Installe {} avec le gestionnaire de paquets du système.", e.name));
    }
    let dir = engines_dir(&app).join(e.id);
    Ok(jobs::spawn(&app, "engine", move |ctx| {
        let tmp = dir.with_extension("download");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp)?;
        ctx.stages(&["Recherche de la version", "Téléchargement", "Décompression", "Installation"]);
        ctx.stage(0, if e.url.starts_with("github:") { "Recherche de la dernière version sur GitHub…".to_string() } else { format!("Connexion à {}…", e.url.split('/').nth(2).unwrap_or("")) });
        let url = resolve_url(e.url)?;
        ctx.stage(1, format!("Connexion à {}…", url.split('/').nth(2).unwrap_or("")));
        let fname = e.files.first().map(|f| f.to_string()).unwrap_or_else(|| url.rsplit('/').next().unwrap_or("download").to_string());
        let file = tmp.join(fname);
        download(ctx, &url, &file, e.name)?;
        if file.extension().is_some_and(|x| x == "zip") {
            ctx.stage(2, "Ouverture de l'archive…");
            let mut z = zip::ZipArchive::new(std::fs::File::open(&file)?).map_err(|err| err.to_string())?;
            let n = z.len();
            for i in 0..n {
                ctx.check()?;
                let mut f = z.by_index(i).map_err(|err| err.to_string())?;
                let Some(rel) = f.enclosed_name() else { continue };
                let target = tmp.join(&rel);
                if f.is_dir() {
                    std::fs::create_dir_all(&target)?;
                } else {
                    if let Some(p) = target.parent() { std::fs::create_dir_all(p)?; }
                    std::io::copy(&mut f, &mut std::fs::File::create(&target)?)?;
                }
                ctx.progress(Some((i + 1) as f64 / n as f64), format!("{} / {n} fichiers · {}", i + 1, rel.file_name().map(|x| x.to_string_lossy().into_owned()).unwrap_or_default()));
            }
            drop(z);
            std::fs::remove_file(&file)?;
        }
        ctx.stage(3, format!("Vérification de {}…", e.name));
        for f in e.files {
            if !tmp.join(f).is_file() {
                return Err(JobError::Failed(format!("{} : fichier {f} manquant.", e.name)));
            }
        }
        for b in e.bins {
            if find_in(&tmp, &exe(b)).is_none() {
                return Err(JobError::Failed(format!("{} : fichier {} absent de l'archive.", e.name, exe(b))));
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::rename(&tmp, &dir)?;
        Ok(json!({ "installed": e.id }))
    }))
}

fn download(ctx: &JobCtx, url: &str, to: &Path, name: &str) -> Result<(), JobError> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(20)))
        .timeout_recv_response(Some(Duration::from_secs(30)))
        .timeout_recv_body(None)
        .build()
        .into();
    let resp = agent.get(url).call().map_err(|e| JobError::Failed(format!("Téléchargement impossible ({e}). Vérifie la connexion.")))?;
    let total: Option<u64> = resp.headers().get("content-length").and_then(|v| v.to_str().ok()).and_then(|s| s.parse().ok());
    let mut reader = resp.into_body().into_reader();
    let mut out = std::fs::File::create(to)?;
    let mut buf = vec![0u8; 1 << 16];
    let mut done = 0u64;
    let t0 = std::time::Instant::now();
    let mb = |b: u64| b as f64 / 1_048_576.0;
    loop {
        ctx.check()?;
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        std::io::Write::write_all(&mut out, &buf[..n])?;
        done += n as u64;
        let speed = mb(done) / t0.elapsed().as_secs_f64().max(0.1);
        let label = match total {
            Some(t) => format!("{name} · {:.0} / {:.0} Mo · {speed:.1} Mo/s", mb(done), mb(t)),
            None => format!("{name} · {:.0} Mo · {speed:.1} Mo/s", mb(done)),
        };
        ctx.progress(total.map(|t| done as f64 / t as f64), label);
    }
    Ok(())
}

// ── Exécution ───────────────────────────────────────────────────────────────

pub fn command(bin: &Path) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(bin);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW : pas de console qui clignote
    }
    c
}

/// Lance un processus, transmet chaque ligne de stdout et stderr à `on_line`, tue le processus si la tâche est annulée.
/// Retourne les dernières lignes de stderr en cas d'échec.
pub fn run(ctx: &JobCtx, mut cmd: Command, mut on_line: impl FnMut(&str)) -> Result<(), JobError> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child: Child = cmd.spawn().map_err(|e| JobError::Failed(format!("lancement impossible : {e}")))?;
    let (tx, rx) = mpsc::channel::<(bool, String)>();
    for (is_err, stream) in [(false, child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>)), (true, child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>))] {
        if let Some(s) = stream {
            let tx = tx.clone();
            std::thread::spawn(move || {
                // Découpe sur \n et \r : les barres de progression réécrivent la ligne.
                let mut r = BufReader::new(s);
                let mut buf = Vec::new();
                loop {
                    buf.clear();
                    match r.read_until(b'\n', &mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {
                            for part in String::from_utf8_lossy(&buf).split('\r') {
                                let l = part.trim_end();
                                if !l.is_empty() {
                                    let _ = tx.send((is_err, l.to_string()));
                                }
                            }
                        }
                    }
                }
            });
        }
    }
    drop(tx);
    let mut tail: Vec<String> = Vec::new();
    loop {
        if ctx.is_cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(JobError::Cancelled);
        }
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok((is_err, line)) => {
                if is_err {
                    tail.push(line.clone());
                    if tail.len() > 12 {
                        tail.remove(0);
                    }
                }
                on_line(&line);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    let status = child.wait()?;
    if status.success() {
        Ok(())
    } else {
        let msg = tail.iter().rev().find(|l| l.to_lowercase().contains("error") || l.starts_with("ERROR")).cloned().unwrap_or_else(|| tail.join("\n"));
        Err(JobError::Failed(if msg.is_empty() { format!("échec (code {:?})", status.code()) } else { msg }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_highest_matching_asset() {
        let rel = serde_json::json!([
            { "assets": [] },
            { "assets": [
                { "name": "ffmpeg-n8.1-latest-win64-gpl-8.1.zip", "browser_download_url": "u81" },
                { "name": "ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip", "browser_download_url": "shared" },
                { "name": "ffmpeg-n9.0-latest-win64-gpl-9.0.zip", "browser_download_url": "u90" },
                { "name": "ffmpeg-master-latest-win64-gpl.zip", "browser_download_url": "master" }
            ] }
        ]);
        assert_eq!(pick_asset(&rel, "ffmpeg-n,-latest-win64-gpl-,.zip,!shared").as_deref(), Some("u90"));
        assert_eq!(pick_asset(&rel, "introuvable"), None);
    }
}
