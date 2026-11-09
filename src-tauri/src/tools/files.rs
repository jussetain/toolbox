//! Accès fichiers partagés par les outils texte (Base64 86, Comparateur 91).

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use tauri::State;

use crate::output;
use crate::settings::SettingsState;

const MAX_TEXT: u64 = 20 * 1024 * 1024;
const MAX_BASE64: u64 = 50 * 1024 * 1024;

fn check_size(path: &str, max: u64) -> Result<(), String> {
    let len = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    if len > max {
        return Err(format!("Fichier trop gros ({} Mo max).", max / 1024 / 1024));
    }
    Ok(())
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    check_size(&path, MAX_TEXT)?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|_| "Ce fichier n'est pas du texte UTF-8.".into())
}

#[tauri::command]
pub fn base64_encode_file(path: String, url_safe: bool) -> Result<String, String> {
    check_size(&path, MAX_BASE64)?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(if url_safe { URL_SAFE_NO_PAD.encode(bytes) } else { STANDARD.encode(bytes) })
}

/// Décode du Base64 (standard ou URL, avec ou sans padding) vers un fichier du dossier de sortie.
#[tauri::command]
pub fn base64_decode_to_file(state: State<SettingsState>, data: String, file_name: String) -> Result<String, String> {
    let bytes = decode_lenient(&data)?;
    let settings = state.0.lock().unwrap().clone();
    let dir = output::today_dir(&settings).map_err(|e| e.to_string())?;
    let safe: String = file_name
        .chars()
        .map(|c| if r#"\/:*?"<>|"#.contains(c) || c.is_control() { '_' } else { c })
        .collect();
    let path = output::unique_path(&dir, if safe.trim().is_empty() { "decode.bin" } else { safe.trim() });
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

fn decode_lenient(data: &str) -> Result<Vec<u8>, String> {
    let mut s: String = data
        .chars()
        .filter(|c| !c.is_whitespace())
        .map(|c| match c {
            '-' => '+',
            '_' => '/',
            c => c,
        })
        .collect();
    // Retire un éventuel préfixe data:…;base64,
    if let Some(i) = s.find(";base64,") {
        s = s[i + 8..].to_string();
    }
    let s = s.trim_end_matches('=');
    let padded = format!("{s}{}", "=".repeat((4 - s.len() % 4) % 4));
    STANDARD.decode(padded).map_err(|_| "Ce n'est pas du Base64 valide.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lenient_decode() {
        assert_eq!(decode_lenient("aGVsbG8").unwrap(), b"hello");
        assert_eq!(decode_lenient("data:text/plain;base64,aGVs\nbG8=").unwrap(), b"hello");
        assert_eq!(decode_lenient("Pz8-").unwrap(), b"??>");
        assert!(decode_lenient("a$b").is_err());
    }
}
