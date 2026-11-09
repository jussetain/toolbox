//! Dossier de sortie : `<racine>\AAAA-MM-JJ`, racine = Téléchargements\Toolbox par défaut.
//! Les originaux ne sont jamais écrasés : chaque fichier produit reçoit un nom unique.

use std::path::{Path, PathBuf};

use crate::settings::Settings;

pub fn default_root() -> PathBuf {
    dirs::download_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(std::env::temp_dir)
        .join("Toolbox")
}

/// Crée (si besoin) et retourne le dossier du jour.
pub fn today_dir(settings: &Settings) -> std::io::Result<PathBuf> {
    let root = settings.output_root.clone().map(PathBuf::from).unwrap_or_else(default_root);
    let dir = root.join(chrono::Local::now().format("%Y-%m-%d").to_string());
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// `dir/name` si libre, sinon `dir/stem (2).ext`, `(3)`…
pub fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let p = Path::new(name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("fichier");
    let ext = p.extension().and_then(|s| s.to_str());
    (2..)
        .map(|i| match ext {
            Some(e) => dir.join(format!("{stem} ({i}).{e}")),
            None => dir.join(format!("{stem} ({i})")),
        })
        .find(|p| !p.exists())
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unique_path_adds_suffix() {
        let dir = std::env::temp_dir().join(format!("toolbox-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = unique_path(&dir, "video.mp4");
        assert_eq!(a, dir.join("video.mp4"));
        std::fs::write(&a, b"x").unwrap();
        assert_eq!(unique_path(&dir, "video.mp4"), dir.join("video (2).mp4"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
