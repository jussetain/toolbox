//! Conversions de documents : 49 (Pandoc) · 50–52 Office → PDF · 53 Page web → PDF · 54 Markdown → PDF.

use std::path::{Path, PathBuf};

use serde_json::json;
use tauri::{AppHandle, Manager};

use crate::engines;
use crate::jobs::{self, JobError};
use crate::output;
use crate::settings::SettingsState;

fn today(app: &AppHandle) -> Result<PathBuf, String> {
    let s = app.state::<SettingsState>().0.lock().unwrap().clone();
    output::today_dir(&s).map_err(|e| e.to_string())
}

fn stem(p: &Path) -> String {
    p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "document".into())
}

// ── 49 Pandoc ───────────────────────────────────────────────────────────────

pub fn pandoc_target(to: &str) -> Option<(&'static str, &'static str)> {
    Some(match to {
        "docx" => ("docx", "docx"),
        "odt" => ("odt", "odt"),
        "rtf" => ("rtf", "rtf"),
        "html" => ("html", "html"),
        "md" => ("gfm", "md"),
        "txt" => ("plain", "txt"),
        _ => return None,
    })
}

#[tauri::command]
pub fn documents_convert(app: AppHandle, paths: Vec<String>, to: String) -> Result<u64, String> {
    let (fmt, ext) = pandoc_target(&to).ok_or("format inconnu")?;
    let dir = today(&app)?;
    let h = app.clone();
    Ok(jobs::spawn(&app, "convert-documents", move |ctx| {
        let pandoc = engines::require(&h, "pandoc", "pandoc")?;
        let mut files = Vec::new();
        for (i, p) in paths.iter().enumerate() {
            let input = PathBuf::from(p);
            let out = output::unique_path(&dir, &format!("{}.{ext}", stem(&input)));
            ctx.progress(Some(i as f64 / paths.len() as f64), input.file_name().unwrap_or_default().to_string_lossy());
            let mut c = engines::command(&pandoc);
            c.arg(&input).args(["-t", fmt, "-o"]).arg(&out);
            if fmt == "html" {
                c.args(["--standalone", "--embed-resources"]);
            }
            // Les images extraites d'un .docx vont à côté du résultat.
            c.arg(format!("--extract-media={}", dir.join(format!("{} - médias", stem(&input))).display()));
            let r = engines::run(ctx, c, |_| {});
            files.push(match r {
                Ok(()) => json!({ "name": input.file_name().map(|s| s.to_string_lossy().into_owned()), "output": out.display().to_string(), "before": 0, "after": 0, "error": null, "note": null }),
                Err(JobError::Cancelled) => return Err(JobError::Cancelled),
                Err(JobError::Failed(e)) => json!({ "name": input.file_name().map(|s| s.to_string_lossy().into_owned()), "output": null, "before": 0, "after": 0, "error": e, "note": null }),
            });
        }
        Ok(json!({ "dir": dir.display().to_string(), "files": files }))
    }))
}

// ── 50–52 Office → PDF ──────────────────────────────────────────────────────

/// Script PowerShell d'export PDF via Office (COM). Les chemins passent par l'environnement : pas d'échappement.
pub fn office_script(kind: &str) -> Option<&'static str> {
    Some(match kind {
        "word" => "$ErrorActionPreference='Stop'; $a=New-Object -ComObject Word.Application; $a.Visible=$false; $a.DisplayAlerts=0; try { $d=$a.Documents.Open($env:TB_IN,$false,$true); $d.ExportAsFixedFormat($env:TB_OUT,17); $d.Close(0) } finally { $a.Quit() }",
        "powerpoint" => "$ErrorActionPreference='Stop'; $a=New-Object -ComObject PowerPoint.Application; try { $p=$a.Presentations.Open($env:TB_IN,-1,0,0); $p.SaveAs($env:TB_OUT,32); $p.Close() } finally { $a.Quit() }",
        "excel" => "$ErrorActionPreference='Stop'; $a=New-Object -ComObject Excel.Application; $a.Visible=$false; $a.DisplayAlerts=$false; try { $w=$a.Workbooks.Open($env:TB_IN,0,$true); $w.ExportAsFixedFormat(0,$env:TB_OUT); $w.Close($false) } finally { $a.Quit() }",
        _ => return None,
    })
}

fn find_soffice() -> Option<PathBuf> {
    let mut c: Vec<PathBuf> = ["ProgramFiles", "ProgramFiles(x86)"]
        .iter()
        .filter_map(|v| std::env::var_os(v))
        .map(|d| PathBuf::from(d).join("LibreOffice").join("program").join("soffice.exe"))
        .collect();
    c.push(PathBuf::from("/usr/bin/soffice"));
    c.into_iter().find(|p| p.is_file())
}

#[tauri::command]
pub fn office_to_pdf(app: AppHandle, tool: String, kind: String, paths: Vec<String>) -> Result<u64, String> {
    let script = office_script(&kind).ok_or("type inconnu")?;
    let dir = today(&app)?;
    Ok(jobs::spawn(&app, &tool, move |ctx| {
        let mut files = Vec::new();
        for (i, p) in paths.iter().enumerate() {
            let input = PathBuf::from(p);
            let name = input.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            ctx.progress(Some(i as f64 / paths.len() as f64), format!("{name} (Office travaille en arrière-plan…)"));
            let out = output::unique_path(&dir, &format!("{}.pdf", stem(&input)));
            let abs = std::fs::canonicalize(&input).unwrap_or(input.clone());
            let mut err = None;
            // 1. Microsoft Office
            if cfg!(windows) {
                let mut c = engines::command(Path::new("powershell"));
                c.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]).env("TB_IN", &abs).env("TB_OUT", &out);
                if let Err(e) = engines::run(ctx, c, |_| {}) {
                    if matches!(e, JobError::Cancelled) { return Err(e); }
                    err = Some(e);
                }
            }
            // 2. LibreOffice
            if !out.is_file() {
                if let Some(so) = find_soffice() {
                    let tmp = std::env::temp_dir().join(format!("toolbox-lo-{}", std::process::id()));
                    std::fs::create_dir_all(&tmp)?;
                    let mut c = engines::command(&so);
                    c.args(["--headless", "--convert-to", "pdf", "--outdir"]).arg(&tmp).arg(&abs);
                    engines::run(ctx, c, |_| {})?;
                    let produced = tmp.join(format!("{}.pdf", stem(&input)));
                    if produced.is_file() {
                        std::fs::rename(&produced, &out).or_else(|_| std::fs::copy(&produced, &out).map(|_| ()))?;
                    }
                    let _ = std::fs::remove_dir_all(&tmp);
                } else if err.is_none() || !cfg!(windows) {
                    err = Some(JobError::Failed("Il faut Microsoft Office ou LibreOffice (gratuit) pour convertir ce fichier.".into()));
                }
            }
            files.push(if out.is_file() {
                json!({ "name": name, "output": out.display().to_string(), "before": std::fs::metadata(&input).map(|m| m.len()).unwrap_or(0), "after": std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0), "error": null, "note": null })
            } else {
                let msg = match err { Some(JobError::Failed(m)) if m.contains("80040154") || m.contains("ComObject") => "Office n'est pas installé, et LibreOffice non plus.".to_string(), Some(JobError::Failed(m)) => m, _ => "Conversion impossible.".into() };
                json!({ "name": name, "output": null, "before": 0, "after": 0, "error": msg, "note": null })
            });
        }
        Ok(json!({ "dir": dir.display().to_string(), "files": files }))
    }))
}

// ── 53/54 Navigateur headless → PDF ─────────────────────────────────────────

fn find_browser() -> Option<PathBuf> {
    let mut c: Vec<PathBuf> = Vec::new();
    for v in ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"] {
        if let Some(d) = std::env::var_os(v) {
            let d = PathBuf::from(d);
            c.push(d.join(r"Microsoft\Edge\Application\msedge.exe"));
            c.push(d.join(r"Google\Chrome\Application\chrome.exe"));
        }
    }
    for p in ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/snap/bin/chromium"] {
        c.push(PathBuf::from(p));
    }
    c.into_iter().find(|p| p.is_file())
}

pub fn browser_args(out: &Path, target: &str, profile: &Path) -> Vec<String> {
    vec![
        "--headless=new".into(),
        "--disable-gpu".into(),
        "--no-first-run".into(),
        "--no-pdf-header-footer".into(),
        "--run-all-compositor-stages-before-draw".into(),
        "--virtual-time-budget=15000".into(),
        format!("--user-data-dir={}", profile.display()),
        format!("--print-to-pdf={}", out.display()),
        target.into(),
    ]
}

/// Imprime une page web (URL) ou un fichier HTML local en PDF.
#[tauri::command]
pub fn html_to_pdf(app: AppHandle, tool: String, target: String, name: String) -> Result<u64, String> {
    let dir = today(&app)?;
    Ok(jobs::spawn(&app, &tool, move |ctx| {
        let browser = find_browser().ok_or_else(|| JobError::Failed("Microsoft Edge est introuvable.".into()))?;
        let out = output::unique_path(&dir, &format!("{}.pdf", crate::tools::fileops::sanitize_name(&name)));
        let profile = std::env::temp_dir().join(format!("toolbox-edge-{}", std::process::id()));
        let t = if Path::new(&target).is_file() { format!("file:///{}", target.replace('\\', "/").trim_start_matches('/')) } else { target.clone() };
        ctx.progress(None, "Mise en page…");
        let mut c = engines::command(&browser);
        c.args(browser_args(&out, &t, &profile));
        let r = engines::run(ctx, c, |_| {});
        let _ = std::fs::remove_dir_all(&profile);
        if !out.is_file() {
            r?;
            return Err(JobError::Failed("Le navigateur n'a pas produit de PDF.".into()));
        }
        Ok(json!({ "output": out.display().to_string(), "size": std::fs::metadata(&out)?.len() }))
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_and_scripts() {
        assert_eq!(pandoc_target("md"), Some(("gfm", "md")));
        assert!(pandoc_target("exe").is_none());
        for k in ["word", "powerpoint", "excel"] {
            let s = office_script(k).unwrap();
            assert!(s.contains("$env:TB_IN") && s.contains("$env:TB_OUT") && s.contains("Quit()"));
        }
        let a = browser_args(Path::new("/tmp/o.pdf"), "https://exemple.fr", Path::new("/tmp/p"));
        assert_eq!(a.last().unwrap(), "https://exemple.fr");
        assert!(a.contains(&"--print-to-pdf=/tmp/o.pdf".to_string()));
    }
}
