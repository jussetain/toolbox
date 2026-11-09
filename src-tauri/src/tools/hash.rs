//! Outil 87 — Générateur de hash (fichiers, avec progression ; texte, synchrone).

use std::fs::File;
use std::io::Read;

use md5::Md5;
use serde::Serialize;
use serde_json::json;
use sha1::Sha1;
use sha2::{Digest, Sha256, Sha512};
use tauri::AppHandle;

use crate::jobs::{self, JobError};

#[derive(Serialize, Default)]
pub struct Hashes {
    md5: String,
    sha1: String,
    sha256: String,
    sha512: String,
}

struct Hasher {
    md5: Md5,
    sha1: Sha1,
    sha256: Sha256,
    sha512: Sha512,
}

impl Hasher {
    fn new() -> Self {
        Self { md5: Md5::new(), sha1: Sha1::new(), sha256: Sha256::new(), sha512: Sha512::new() }
    }
    fn update(&mut self, b: &[u8]) {
        self.md5.update(b);
        self.sha1.update(b);
        self.sha256.update(b);
        self.sha512.update(b);
    }
    fn finish(self) -> Hashes {
        Hashes {
            md5: hex::encode(self.md5.finalize()),
            sha1: hex::encode(self.sha1.finalize()),
            sha256: hex::encode(self.sha256.finalize()),
            sha512: hex::encode(self.sha512.finalize()),
        }
    }
}

#[tauri::command]
pub fn hash_text(text: String) -> Hashes {
    let mut h = Hasher::new();
    h.update(text.as_bytes());
    h.finish()
}

#[tauri::command]
pub fn hash_files(app: AppHandle, paths: Vec<String>) -> u64 {
    jobs::spawn(&app, "hash-generator", move |ctx| {
        let total: u64 = paths.iter().filter_map(|p| std::fs::metadata(p).ok()).map(|m| m.len()).sum();
        let mut done = 0u64;
        let mut out = Vec::new();
        let mut buf = vec![0u8; 1 << 20];
        for path in &paths {
            let name = std::path::Path::new(path).file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            let mut f = File::open(path).map_err(|e| JobError::Failed(format!("{name} : {e}")))?;
            let mut h = Hasher::new();
            loop {
                ctx.check()?;
                let n = f.read(&mut buf)?;
                if n == 0 {
                    break;
                }
                h.update(&buf[..n]);
                done += n as u64;
                ctx.progress(Some(if total == 0 { 1.0 } else { done as f64 / total as f64 }), &name);
            }
            out.push(json!({ "path": path, "name": name, "size": std::fs::metadata(path)?.len(), "hashes": h.finish() }));
        }
        Ok(json!(out))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_vectors() {
        let h = hash_text("abc".into());
        assert_eq!(h.md5, "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(h.sha1, "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(h.sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}
