//! Outils fichiers : 64 QR (lecture) · 65 Renommage · 66 Doublons · 67 Archives · 68 Téléchargements.
//! Plus l'E/S brute partagée par les outils à canevas (lecture d'un fichier, enregistrement d'un résultat).

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;

use crate::jobs::{self, JobError};
use crate::output;
use crate::settings::SettingsState;

fn today(app: &AppHandle) -> Result<PathBuf, String> {
    let s = app.state::<SettingsState>().0.lock().unwrap().clone();
    output::today_dir(&s).map_err(|e| e.to_string())
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Remplace les caractères interdits par Windows dans un nom de fichier.
pub fn sanitize_name(name: &str) -> String {
    let s: String = name.chars().map(|c| if r#"\/:*?"<>|"#.contains(c) || c.is_control() { '_' } else { c }).collect();
    let s = s.trim().trim_end_matches('.').to_string();
    if s.is_empty() { "fichier".into() } else { s }
}

// ── E/S brute ───────────────────────────────────────────────────────────────

/// Renvoie le contenu d'un fichier en binaire brut (ArrayBuffer côté JS).
#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<Response, String> {
    let len = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if len > 200 * 1024 * 1024 {
        return Err("Fichier trop gros (200 Mo max).".into());
    }
    std::fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

/// Enregistre un résultat produit côté interface. Corps brut, nom dans l'en-tête `x-name` (encodé URI).
#[tauri::command]
pub fn save_output(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("corps attendu en binaire".into()) };
    let name = request
        .headers()
        .get("x-name")
        .and_then(|v| v.to_str().ok())
        .map(|s| percent_decode(s))
        .unwrap_or_else(|| "resultat.bin".into());
    let dir = today(&app)?;
    let path = output::unique_path(&dir, &sanitize_name(&name));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

/// Comme `save_output`, mais dans un dossier temporaire (fichiers intermédiaires).
#[tauri::command]
pub fn save_temp(request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("corps attendu en binaire".into()) };
    let name = request.headers().get("x-name").and_then(|v| v.to_str().ok()).map(percent_decode).unwrap_or_else(|| "temp.bin".into());
    let dir = std::env::temp_dir().join("toolbox");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = output::unique_path(&dir, &sanitize_name(&name));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ── 64 QR / codes-barres ────────────────────────────────────────────────────

#[tauri::command]
pub fn qr_decode(path: String) -> Result<Vec<serde_json::Value>, String> {
    let results = rxing::helpers::detect_multiple_in_file(&path).map_err(|_| "Aucun code trouvé dans cette image.".to_string())?;
    Ok(results.iter().map(|r| json!({ "format": format!("{:?}", r.getBarcodeFormat()), "text": r.getText() })).collect())
}

// ── 65 Renommage par lot ────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct Rename { from: String, to: String }

/// Renomme en deux temps (noms temporaires) pour gérer les permutations ; refuse les collisions.
#[tauri::command]
pub fn rename_files(items: Vec<Rename>) -> Result<usize, String> {
    let mut targets = std::collections::HashSet::new();
    let sources: std::collections::HashSet<_> = items.iter().map(|i| PathBuf::from(&i.from)).collect();
    let mut plan = Vec::new();
    for it in &items {
        let from = PathBuf::from(&it.from);
        let name = sanitize_name(&it.to);
        let to = from.parent().unwrap_or(Path::new(".")).join(&name);
        if from == to {
            continue;
        }
        if !targets.insert(to.to_string_lossy().to_lowercase()) {
            return Err(format!("Deux fichiers auraient le même nom : {name}"));
        }
        if to.exists() && !sources.contains(&to) && to.to_string_lossy().to_lowercase() != from.to_string_lossy().to_lowercase() {
            return Err(format!("« {name} » existe déjà dans ce dossier."));
        }
        plan.push((from, to));
    }
    let tmp: Vec<PathBuf> = plan
        .iter()
        .enumerate()
        .map(|(i, (from, _))| from.with_file_name(format!(".toolbox-renommage-{}-{i}", std::process::id())))
        .collect();
    for ((from, _), t) in plan.iter().zip(&tmp) {
        std::fs::rename(from, t).map_err(|e| format!("{} : {e}", file_name(from)))?;
    }
    for ((_, to), t) in plan.iter().zip(&tmp) {
        std::fs::rename(t, to).map_err(|e| format!("{} : {e}", file_name(to)))?;
    }
    Ok(plan.len())
}

// ── 66 Doublons ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DupFile { path: String, name: String, modified: u64 }

fn hash_file(p: &Path, limit: Option<u64>) -> std::io::Result<[u8; 32]> {
    let mut h = blake3::Hasher::new();
    let f = File::open(p)?;
    let mut r = BufReader::with_capacity(1 << 20, f);
    match limit {
        Some(n) => { std::io::copy(&mut r.take(n), &mut h)?; }
        None => { std::io::copy(&mut r, &mut h)?; }
    }
    Ok(*h.finalize().as_bytes())
}

#[tauri::command]
pub fn find_duplicates(app: AppHandle, paths: Vec<String>, min_size: u64) -> u64 {
    jobs::spawn(&app, "find-duplicates", move |ctx| {
        ctx.stages(&["Inventaire", "Comparaison"]);
        ctx.stage(0, "Inventaire des fichiers…");
        let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
        let mut count = 0usize;
        for root in &paths {
            for e in WalkDir::new(root).into_iter().filter_map(Result::ok).filter(|e| e.file_type().is_file()) {
                ctx.check()?;
                let len = e.metadata().map(|m| m.len()).unwrap_or(0);
                if len >= min_size.max(1) {
                    by_size.entry(len).or_default().push(e.into_path());
                    count += 1;
                    if count % 500 == 0 { ctx.progress(None, format!("{count} fichiers inventoriés")); }
                }
            }
        }
        let candidates: Vec<(u64, Vec<PathBuf>)> = by_size.into_iter().filter(|(_, v)| v.len() > 1).collect();
        let total: usize = candidates.iter().map(|(_, v)| v.len()).sum();
        ctx.stage(1, format!("{total} fichiers de même taille à comparer…"));
        let mut done = 0usize;
        let mut groups = Vec::new();
        for (size, files) in candidates {
            // Empreinte rapide (64 Ko) puis complète, seulement pour les collisions.
            let mut quick: HashMap<[u8; 32], Vec<PathBuf>> = HashMap::new();
            for f in files {
                ctx.check()?;
                done += 1;
                ctx.progress(Some(done as f64 / total.max(1) as f64), file_name(&f));
                if let Ok(h) = hash_file(&f, Some(65536)) {
                    quick.entry(h).or_default().push(f);
                }
            }
            for (_, same) in quick.into_iter().filter(|(_, v)| v.len() > 1) {
                let mut full: HashMap<[u8; 32], Vec<PathBuf>> = HashMap::new();
                for f in same {
                    ctx.check()?;
                    let h = if size <= 65536 { hash_file(&f, Some(65536)) } else { hash_file(&f, None) };
                    if let Ok(h) = h {
                        full.entry(h).or_default().push(f);
                    }
                }
                for (_, dup) in full.into_iter().filter(|(_, v)| v.len() > 1) {
                    let mut list: Vec<DupFile> = dup
                        .iter()
                        .map(|p| DupFile {
                            path: p.display().to_string(),
                            name: file_name(p),
                            modified: std::fs::metadata(p).and_then(|m| m.modified()).ok()
                                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0),
                        })
                        .collect();
                    list.sort_by_key(|f| f.modified);
                    groups.push(json!({ "size": size, "files": list }));
                }
            }
        }
        groups.sort_by_key(|g| std::cmp::Reverse(g["size"].as_u64().unwrap_or(0) * (g["files"].as_array().map_or(0, |a| a.len()) as u64 - 1)));
        Ok(json!({ "scanned": count, "groups": groups }))
    })
}

#[tauri::command]
pub fn trash_files(paths: Vec<String>) -> Result<usize, String> {
    trash::delete_all(&paths).map_err(|e| e.to_string())?;
    Ok(paths.len())
}

// ── 67 Archives ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn zip_create(app: AppHandle, paths: Vec<String>, name: String, password: Option<String>) -> Result<u64, String> {
    let dir = today(&app)?;
    Ok(jobs::spawn(&app, "zip-unzip", move |ctx| {
        let mut entries: Vec<(PathBuf, String)> = Vec::new();
        for p in &paths {
            let root = PathBuf::from(p);
            let base = root.parent().map(Path::to_path_buf).unwrap_or_default();
            for e in WalkDir::new(&root).into_iter().filter_map(Result::ok) {
                let rel = e.path().strip_prefix(&base).unwrap_or(e.path()).to_string_lossy().replace('\\', "/");
                entries.push((e.into_path(), rel));
            }
        }
        let total: u64 = entries.iter().filter_map(|(p, _)| std::fs::metadata(p).ok()).filter(|m| m.is_file()).map(|m| m.len()).sum();
        let out = output::unique_path(&dir, &format!("{}.zip", sanitize_name(name.trim_end_matches(".zip"))));
        let mut zip = zip::ZipWriter::new(File::create(&out)?);
        let mut done = 0u64;
        let mut buf = vec![0u8; 1 << 20];
        for (path, rel) in entries {
            ctx.check()?;
            let mut opts = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated)
                .large_file(true);
            if let Some(pw) = password.as_deref().filter(|s| !s.is_empty()) {
                opts = opts.with_aes_encryption(zip::AesMode::Aes256, pw);
            }
            if path.is_dir() {
                zip.add_directory(rel, opts).map_err(|e| e.to_string())?;
                continue;
            }
            zip.start_file(rel.clone(), opts).map_err(|e| e.to_string())?;
            let mut f = File::open(&path)?;
            loop {
                ctx.check()?;
                let n = f.read(&mut buf)?;
                if n == 0 { break; }
                zip.write_all(&buf[..n])?;
                done += n as u64;
                ctx.progress(Some(done as f64 / total.max(1) as f64), rel.clone());
            }
        }
        zip.finish().map_err(|e| e.to_string())?;
        Ok(json!({ "output": out.display().to_string(), "size": std::fs::metadata(&out)?.len() }))
    }))
}

#[tauri::command]
pub fn archive_extract(app: AppHandle, path: String, password: Option<String>) -> Result<u64, String> {
    let dir = today(&app)?;
    Ok(jobs::spawn(&app, "zip-unzip", move |ctx| {
        let src = PathBuf::from(&path);
        let name = file_name(&src);
        let lower = name.to_lowercase();
        let ext_len = [".tar.gz", ".tgz", ".zip", ".7z", ".tar", ".rar"].iter().find(|e| lower.ends_with(*e)).map_or(0, |e| e.len());
        let stem = name[..name.len() - ext_len].to_string();
        let dest = output::unique_path(&dir, &sanitize_name(&stem));
        std::fs::create_dir_all(&dest)?;
        ctx.progress(None, "Extraction…");
        let pw = password.filter(|s| !s.is_empty());
        if lower.ends_with(".zip") {
            let mut z = zip::ZipArchive::new(File::open(&src)?).map_err(|e| e.to_string())?;
            let n = z.len();
            for i in 0..n {
                ctx.check()?;
                let mut f = match &pw {
                    Some(p) => z.by_index_decrypt(i, p.as_bytes()),
                    None => z.by_index(i),
                }
                .map_err(|e| match e {
                    zip::result::ZipError::UnsupportedArchive(m) if m.contains("assword") => "Mot de passe requis.".to_string(),
                    zip::result::ZipError::InvalidPassword => "Mot de passe incorrect.".to_string(),
                    e => e.to_string(),
                })?;
                // `enclosed_name` refuse les chemins qui sortiraient du dossier (zip slip).
                let Some(rel) = f.enclosed_name() else { continue };
                let target = dest.join(rel);
                if f.is_dir() {
                    std::fs::create_dir_all(&target)?;
                } else {
                    if let Some(p) = target.parent() { std::fs::create_dir_all(p)?; }
                    std::io::copy(&mut f, &mut File::create(&target)?)?;
                }
                ctx.progress(Some((i + 1) as f64 / n as f64), file_name(&target));
            }
        } else if lower.ends_with(".7z") {
            let res = match &pw {
                Some(p) => sevenz_rust2::decompress_file_with_password(&src, &dest, p.as_str().into()),
                None => sevenz_rust2::decompress_file(&src, &dest),
            };
            res.map_err(|e| {
                let m = e.to_string();
                if m.to_lowercase().contains("password") { "Mot de passe requis ou incorrect.".to_string() } else { m }
            })?;
        } else if lower.ends_with(".tar") || lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
            let f = File::open(&src)?;
            let reader: Box<dyn Read> = if lower.ends_with(".tar") { Box::new(f) } else { Box::new(flate2::read::GzDecoder::new(f)) };
            // `unpack` refuse aussi les chemins absolus ou en « .. ».
            tar::Archive::new(reader).unpack(&dest)?;
        } else if lower.ends_with(".rar") {
            return Err(JobError::Failed("Les archives RAR arrivent dans une prochaine version.".into()));
        } else {
            return Err(JobError::Failed("Format d'archive non reconnu (ZIP, 7z, TAR, TAR.GZ).".into()));
        }
        Ok(json!({ "output": dest.display().to_string() }))
    }))
}

// ── 68 Ranger les téléchargements ───────────────────────────────────────────

const IMAGE_EXT: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "heic", "avif", "bmp", "svg", "tif", "tiff"];

/// Site d'origine d'un fichier téléchargé, lu dans le flux NTFS `Zone.Identifier` (Windows).
pub fn download_source(path: &Path) -> Option<String> {
    let ads = format!("{}:Zone.Identifier", path.display());
    let text = std::fs::read_to_string(ads).ok()?;
    parse_zone_identifier(&text)
}

pub fn parse_zone_identifier(text: &str) -> Option<String> {
    let get = |k: &str| text.lines().find_map(|l| l.strip_prefix(k)).map(str::trim).filter(|s| !s.is_empty() && *s != "about:internet");
    let url = get("ReferrerUrl=").or_else(|| get("HostUrl="))?;
    let host = url.split("://").nth(1)?.split(['/', '?', '#', ':']).next()?.to_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
    (!host.is_empty()).then_some(host)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem { path: String, name: String, source: Option<String> }

#[tauri::command]
pub fn downloads_scan(dir: Option<String>) -> Result<serde_json::Value, String> {
    let dir = dir.map(PathBuf::from).or_else(dirs::download_dir).ok_or("Dossier Téléchargements introuvable")?;
    let mut items = Vec::new();
    for e in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.filter_map(Result::ok) {
        let p = e.path();
        let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        if p.is_file() && IMAGE_EXT.contains(&ext.as_str()) {
            items.push(DownloadItem { name: file_name(&p), source: download_source(&p), path: p.display().to_string() });
        }
    }
    items.sort_by(|a, b| a.source.cmp(&b.source).then(a.name.cmp(&b.name)));
    Ok(json!({ "dir": dir.display().to_string(), "items": items }))
}

#[derive(Deserialize)]
pub struct Move { path: String, folder: String }

/// Déplace chaque image dans un sous-dossier (nom du site) du dossier scanné.
#[tauri::command]
pub fn downloads_organize(dir: String, moves: Vec<Move>) -> Result<usize, String> {
    let root = PathBuf::from(dir);
    let mut n = 0;
    for m in moves {
        let src = PathBuf::from(&m.path);
        let target_dir = root.join(sanitize_name(&m.folder));
        std::fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
        let dest = output::unique_path(&target_dir, &file_name(&src));
        std::fs::rename(&src, &dest).map_err(|e| format!("{} : {e}", file_name(&src)))?;
        n += 1;
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zone_identifier() {
        let z = "[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://www.pinterest.fr/pin/123/\r\nHostUrl=https://i.pinimg.com/originals/a.jpg\r\n";
        assert_eq!(parse_zone_identifier(z).as_deref(), Some("pinterest.fr"));
        assert_eq!(parse_zone_identifier("[ZoneTransfer]\nZoneId=3\nHostUrl=https://cdn.exemple.com:443/x.png").as_deref(), Some("cdn.exemple.com"));
        assert_eq!(parse_zone_identifier("[ZoneTransfer]\nZoneId=3\nHostUrl=about:internet"), None);
    }

    #[test]
    fn sanitize() {
        assert_eq!(sanitize_name("a:b/c?.txt"), "a_b_c_.txt");
        assert_eq!(sanitize_name("  ..."), "fichier");
        assert_eq!(percent_decode("caf%C3%A9.png"), "café.png");
    }

    #[test]
    fn rename_swap() {
        let d = std::env::temp_dir().join(format!("tb-rename-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("a.txt"), "A").unwrap();
        std::fs::write(d.join("b.txt"), "B").unwrap();
        let s = |n: &str| d.join(n).display().to_string();
        rename_files(vec![Rename { from: s("a.txt"), to: "b.txt".into() }, Rename { from: s("b.txt"), to: "a.txt".into() }]).unwrap();
        assert_eq!(std::fs::read_to_string(d.join("a.txt")).unwrap(), "B");
        assert!(rename_files(vec![Rename { from: s("a.txt"), to: "x.txt".into() }, Rename { from: s("b.txt"), to: "x.txt".into() }]).is_err());
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn zip_slip_is_blocked_by_enclosed_name() {
        // Vérifie notre hypothèse sur `enclosed_name` avec une archive malveillante construite à la main.
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut z = zip::ZipWriter::new(&mut buf);
            z.start_file("../../evil.txt", zip::write::SimpleFileOptions::default()).unwrap();
            z.write_all(b"x").unwrap();
            z.finish().unwrap();
        }
        let mut a = zip::ZipArchive::new(std::io::Cursor::new(buf.into_inner())).unwrap();
        assert!(a.by_index(0).unwrap().enclosed_name().is_none());
    }
}
