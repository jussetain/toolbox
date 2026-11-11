//! Capture d'écran : zone ou fenêtre (outil Capture de Windows) ou écran entier (tous les moniteurs).

use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, Manager};

use crate::jobs::{self, JobError};
use crate::output;
use crate::settings::SettingsState;

/// Nom du fichier de sortie : « Capture 2026-11-11 à 14.05.33.png ».
pub fn file_name(now: chrono::DateTime<chrono::Local>) -> String {
    format!("Capture {}.png", now.format("%Y-%m-%d à %H.%M.%S"))
}

#[tauri::command]
pub fn screen_capture(app: AppHandle, mode: String, delay: u64, copy: bool) -> Result<u64, String> {
    let s = app.state::<SettingsState>().0.lock().unwrap().clone();
    let dir = output::today_dir(&s).map_err(|e| e.to_string())?;
    let h = app.clone();
    Ok(jobs::spawn(&app, "screenshot", move |ctx| {
        ctx.stages(&["Préparation", "Capture"]);
        for left in (1..=delay.min(30)).rev() {
            ctx.check()?;
            ctx.progress(None, format!("Capture dans {left} s…"));
            std::thread::sleep(Duration::from_secs(1));
        }
        // La fenêtre de Toolbox ne doit pas apparaître sur la capture.
        let main = h.get_webview_window("main");
        if let Some(w) = &main { let _ = w.hide(); }
        std::thread::sleep(Duration::from_millis(350));
        ctx.stage(1, if mode == "screen" { "Capture de l'écran…" } else { "Sélectionne une zone ou une fenêtre…" });
        let r = grab(ctx, &mode);
        if let Some(w) = &main { let _ = w.show(); let _ = w.set_focus(); }
        let img = r?;
        let out = output::unique_path(&dir, &file_name(chrono::Local::now()));
        img.save(&out).map_err(|e| JobError::Failed(e.to_string()))?;
        #[cfg(windows)]
        if copy && mode == "screen" {
            let _ = arboard::Clipboard::new().and_then(|mut c| c.set_image(arboard::ImageData { width: img.width() as usize, height: img.height() as usize, bytes: img.as_raw().into() }));
        }
        let _ = copy;
        Ok(json!({ "output": out.display().to_string(), "width": img.width(), "height": img.height() }))
    }))
}

#[cfg(not(windows))]
fn grab(_ctx: &jobs::JobCtx, _mode: &str) -> Result<image::RgbaImage, JobError> {
    Err(JobError::Failed("Disponible sous Windows uniquement.".into()))
}

#[cfg(windows)]
fn grab(ctx: &jobs::JobCtx, mode: &str) -> Result<image::RgbaImage, JobError> {
    if mode == "screen" {
        return win::virtual_screen().map_err(JobError::Failed);
    }
    let p: std::path::PathBuf = crate::tools::ai::snip(ctx)?;
    let img = image::open(&p).map_err(|e| JobError::Failed(e.to_string()))?.to_rgba8();
    let _ = std::fs::remove_file(&p);
    Ok(img)
}

#[cfg(windows)]
mod win {
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN};

    /// Tous les écrans d'un coup (bureau virtuel), en pixels physiques.
    pub fn virtual_screen() -> Result<image::RgbaImage, String> {
        unsafe {
            let (x, y) = (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN));
            let (w, h) = (GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN));
            if w <= 0 || h <= 0 { return Err("Écran introuvable.".into()); }
            let screen = GetDC(None);
            let mem = CreateCompatibleDC(Some(screen));
            let bmp = CreateCompatibleBitmap(screen, w, h);
            let old = SelectObject(mem, bmp.into());
            let ok = BitBlt(mem, 0, 0, w, h, Some(screen), x, y, SRCCOPY | CAPTUREBLT);
            let mut info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: w, biHeight: -h, biPlanes: 1, biBitCount: 32, biCompression: BI_RGB.0, ..Default::default() },
                ..Default::default()
            };
            let mut buf = vec![0u8; (w * h * 4) as usize];
            let lines = GetDIBits(mem, bmp, 0, h as u32, Some(buf.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
            SelectObject(mem, old);
            let _ = DeleteObject(bmp.into());
            let _ = DeleteDC(mem);
            ReleaseDC(None, screen);
            ok.map_err(|e| e.message().to_string())?;
            if lines == 0 { return Err("Lecture de l'écran impossible.".into()); }
            for px in buf.chunks_exact_mut(4) {
                px.swap(0, 2);
                px[3] = 255;
            }
            image::RgbaImage::from_raw(w as u32, h as u32, buf).ok_or_else(|| "image invalide".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    #[test]
    fn names_by_date() {
        let t = chrono::Local.with_ymd_and_hms(2026, 11, 11, 14, 5, 3).unwrap();
        assert_eq!(super::file_name(t), "Capture 2026-11-11 à 14.05.03.png");
    }
}
