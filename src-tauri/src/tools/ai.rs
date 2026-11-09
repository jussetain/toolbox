//! OCR (35, 57, 58), visages (21), synthèse vocale (60), transcription (55), IA locale (56, 59, 61).

use std::io::{BufRead, BufReader};
#[allow(unused_imports)]
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::engines;
use crate::jobs::{self, JobCtx, JobError};
use crate::output;
use crate::settings::SettingsState;

#[allow(dead_code)]
const WINDOWS_ONLY: &str = "Disponible sous Windows uniquement.";

fn today(app: &AppHandle) -> Result<PathBuf, String> {
    let s = app.state::<SettingsState>().0.lock().unwrap().clone();
    output::today_dir(&s).map_err(|e| e.to_string())
}

fn threads() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 8)
}

// ── 55 Transcription (whisper.cpp) ──────────────────────────────────────────

/// Pourcentage affiché par whisper-cli avec `-pp`.
pub fn whisper_progress(line: &str) -> Option<f64> {
    let i = line.find("progress =")?;
    line[i + 10..].trim().trim_end_matches('%').trim().parse::<f64>().ok().map(|p| p / 100.0)
}

#[tauri::command]
pub fn transcribe(app: AppHandle, path: String, language: String) -> Result<u64, String> {
    let dir = today(&app)?;
    let h = app.clone();
    Ok(jobs::spawn(&app, "transcribe", move |ctx| {
        let ff = engines::require(&h, "ffmpeg", "ffmpeg")?;
        let wh = engines::require(&h, "whisper", "whisper-cli")?;
        let model = engines::data_file(&h, "whisper-model", "ggml-small.bin").ok_or_else(|| JobError::Failed("Modèle de reconnaissance vocale manquant.".into()))?;
        let input = PathBuf::from(&path);
        let stem = input.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "transcription".into());
        let wav = std::env::temp_dir().join(format!("toolbox-whisper-{}-{}.wav", std::process::id(), ctx.id()));
        ctx.stages(&["Préparation du son", "Transcription"]);
        ctx.stage(0, "Extraction de la piste audio…");
        let mut c = engines::command(&ff);
        c.args(["-hide_banner", "-y", "-i"]).arg(&input).args(["-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"]).arg(&wav);
        engines::run(ctx, c, |_| {})?;
        let base = output::unique_path(&dir, &stem);
        ctx.stage(1, "Chargement du modèle de reconnaissance vocale…");
        let mut c = engines::command(&wh);
        c.arg("-m").arg(&model).arg("-f").arg(&wav).args(["-l", if language.is_empty() { "auto" } else { &language }, "-otxt", "-osrt", "-ovtt", "-pp", "-t", &threads().to_string(), "-of"]).arg(&base);
        let r = engines::run(ctx, c, |l| {
            if let Some(p) = whisper_progress(l) { ctx.progress(Some(p), format!("Écoute et transcription · {:.0} %", p * 100.0)); }
        });
        let _ = std::fs::remove_file(&wav);
        r?;
        let p = |ext: &str| PathBuf::from(format!("{}.{ext}", base.display()));
        let text = std::fs::read_to_string(p("txt")).unwrap_or_default();
        Ok(json!({ "text": text.trim(), "txt": p("txt").display().to_string(), "srt": p("srt").display().to_string(), "vtt": p("vtt").display().to_string() }))
    }))
}

// ── IA locale (llama.cpp) ───────────────────────────────────────────────────

static SERVER: Mutex<Option<(Child, u16)>> = Mutex::new(None);

pub fn shutdown_llm() {
    if let Some((mut c, _)) = SERVER.lock().unwrap().take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()).map(|a| a.port()).unwrap_or(48765)
}

/// Démarre (une fois) le serveur llama.cpp et attend qu'il ait chargé le modèle.
fn ensure_server(ctx: &JobCtx) -> Result<u16, JobError> {
    {
        let mut g = SERVER.lock().unwrap();
        if let Some((c, port)) = g.as_mut() {
            if c.try_wait().ok().flatten().is_none() { return Ok(*port); }
        }
        *g = None;
    }
    let app = ctx.app();
    let bin = engines::require(app, "llama", "llama-server")?;
    let model = engines::data_file(app, "llm-model", "Llama-3.2-3B-Instruct-Q4_K_M.gguf").ok_or_else(|| JobError::Failed("Modèle de langage manquant.".into()))?;
    let port = free_port();
    let child = engines::command(&bin)
        .arg("-m").arg(&model)
        .args(["--host", "127.0.0.1", "--port", &port.to_string(), "-c", "16384", "-t", &threads().to_string(), "--no-webui"])
        .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
        .spawn().map_err(|e| JobError::Failed(format!("Lancement de l'IA impossible : {e}")))?;
    *SERVER.lock().unwrap() = Some((child, port));
    let t0 = Instant::now();
    loop {
        ctx.check()?;
        ctx.progress(None, "Chargement du modèle (la première fois prend quelques secondes)…");
        if ureq::get(&format!("http://127.0.0.1:{port}/health")).call().is_ok() { return Ok(port); }
        if let Some((c, _)) = SERVER.lock().unwrap().as_mut() {
            if c.try_wait().ok().flatten().is_some() { return Err(JobError::Failed("L'IA s'est arrêtée au démarrage (mémoire insuffisante ?).".into())); }
        }
        if t0.elapsed() > Duration::from_secs(240) { return Err(JobError::Failed("L'IA met trop de temps à démarrer.".into())); }
        std::thread::sleep(Duration::from_millis(500));
    }
}

#[derive(Deserialize, serde::Serialize, Clone)]
pub struct Msg { role: String, content: String }

/// Une réponse du modèle, diffusée au fil de l'eau (événement `llm-stream`).
#[tauri::command]
pub fn llm_chat(app: AppHandle, tool: String, messages: Vec<Msg>, max_tokens: Option<u32>, temperature: Option<f32>) -> u64 {
    jobs::spawn(&app, &tool, move |ctx| {
        ctx.stages(&["Démarrage de l'IA", "Lecture", "Rédaction"]);
        ctx.stage(0, "Lancement du moteur…");
        let port = ensure_server(ctx)?;
        ctx.stage(1, "Lecture du texte fourni…");
        let body = json!({ "messages": messages, "stream": true, "max_tokens": max_tokens.unwrap_or(1024), "temperature": temperature.unwrap_or(0.3), "cache_prompt": true });
        let resp = ureq::post(&format!("http://127.0.0.1:{port}/v1/chat/completions"))
            .config().timeout_global(Some(Duration::from_secs(1800))).build()
            .header("Content-Type", "application/json")
            .send(&serde_json::to_vec(&body).unwrap()[..]).map_err(|e| JobError::Failed(format!("IA : {e}")))?;
        let reader = BufReader::new(resp.into_body().into_reader());
        let mut text = String::new();
        for line in reader.lines() {
            ctx.check()?;
            let line = line?;
            let Some(data) = line.strip_prefix("data: ") else { continue };
            if data.trim() == "[DONE]" { break; }
            let v: Value = serde_json::from_str(data).unwrap_or(Value::Null);
            if let Some(d) = v["choices"][0]["delta"]["content"].as_str() {
                if text.is_empty() { ctx.stage(2, "Rédaction…"); }
                text.push_str(d);
                ctx.progress(None, format!("Rédaction · {} mots", text.split_whitespace().count()));
                let _ = ctx.app().emit("llm-stream", json!({ "id": ctx.id(), "delta": d }));
            }
        }
        Ok(json!({ "text": text.trim() }))
    })
}

// ── Windows : OCR, visages, voix, capture ───────────────────────────────────

macro_rules! win_only {
    ($(#[$m:meta])* fn $name:ident($($arg:ident : $t:ty),*) -> $ret:ty => $body:expr) => {
        $(#[$m])*
        #[tauri::command]
        pub fn $name($($arg: $t),*) -> Result<$ret, String> {
            #[cfg(windows)] { $body }
            #[cfg(not(windows))] { $(let _ = $arg;)* Err(WINDOWS_ONLY.into()) }
        }
    };
}

win_only!(/// Langues OCR installées sur ce PC.
    fn ocr_languages() -> Value => win::ocr_languages());
win_only!(/// Texte (lignes et mots positionnés) d'une image.
    fn ocr_image(path: String, language: Option<String>) -> Value => win::ocr(Path::new(&path), language.as_deref()));
win_only!(/// Rectangles des visages détectés.
    fn detect_faces(path: String) -> Value => win::faces(Path::new(&path)));
win_only!(fn tts_voices() -> Value => win::voices());

/// 60 Synthèse vocale : WAV, puis MP3/M4A via FFmpeg si présent.
#[tauri::command]
pub fn tts_synthesize(app: AppHandle, text: String, voice: Option<String>, rate: f64, format: String, name: String) -> Result<u64, String> {
    let dir = today(&app)?;
    let h = app.clone();
    Ok(jobs::spawn(&app, "text-to-speech", move |ctx| {
        #[cfg(not(windows))]
        { let _ = (&text, &voice, rate, &format, &name, &dir, &h, ctx); return Err(JobError::Failed(WINDOWS_ONLY.into())); }
        #[cfg(windows)]
        {
            ctx.stages(&["Synthèse vocale", "Conversion"]);
            ctx.stage(0, format!("Lecture de {} caractères par la voix choisie…", text.chars().count()));
            let wav = output::unique_path(&dir, &format!("{}.wav", crate::tools::fileops::sanitize_name(&name)));
            win::synthesize(&text, voice.as_deref(), rate, &wav).map_err(JobError::Failed)?;
            let out = match (format.as_str(), engines::resolve(&h, "ffmpeg", "ffmpeg")) {
                (f @ ("mp3" | "m4a"), Some(ff)) => {
                    let out = wav.with_extension(f);
                    ctx.stage(1, format!("Conversion en {}…", f.to_uppercase()));
                    let mut c = engines::command(&ff);
                    c.args(["-hide_banner", "-y", "-i"]).arg(&wav).args(if f == "mp3" { ["-c:a", "libmp3lame", "-b:a", "128k"] } else { ["-c:a", "aac", "-b:a", "128k"] }).arg(&out);
                    engines::run(ctx, c, |_| {})?;
                    let _ = std::fs::remove_file(&wav);
                    out
                }
                _ => wav,
            };
            Ok(json!({ "output": out.display().to_string(), "size": std::fs::metadata(&out)?.len() }))
        }
    }))
}

/// 58 Capturer du texte : ouvre l'outil Capture de Windows, attend l'image, la lit.
#[tauri::command]
pub fn capture_text(app: AppHandle, language: Option<String>) -> u64 {
    jobs::spawn(&app, "capture-text", move |ctx| {
        #[cfg(not(windows))]
        { let _ = (&language, ctx); Err(JobError::Failed(WINDOWS_ONLY.into())) }
        #[cfg(windows)]
        {
            let png = win::snip(ctx)?;
            ctx.stage(1, "Reconnaissance du texte…");
            let r = win::ocr(&png, language.as_deref()).map_err(JobError::Failed);
            let _ = std::fs::remove_file(&png);
            r
        }
    })
}

#[cfg(windows)]
mod win {
    use super::*;
    use windows::core::HSTRING;
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{BitmapDecoder, BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::FaceAnalysis::FaceDetector;
    use windows::Media::Ocr::OcrEngine;
    use windows::Media::SpeechSynthesis::SpeechSynthesizer;
    use windows::Storage::{FileAccessMode, StorageFile};
    use windows::Storage::Streams::DataReader;

    fn e(x: windows::core::Error) -> String { x.message().to_string() }

    fn bitmap(path: &Path) -> Result<SoftwareBitmap, String> {
        let abs = std::fs::canonicalize(path).map_err(|x| x.to_string())?;
        let s = abs.display().to_string();
        let s = s.strip_prefix(r"\\?\").unwrap_or(&s);
        let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(s)).map_err(e)?.join().map_err(e)?;
        let stream = file.OpenAsync(FileAccessMode::Read).map_err(e)?.join().map_err(e)?;
        let dec = BitmapDecoder::CreateAsync(&stream).map_err(e)?.join().map_err(e)?;
        dec.GetSoftwareBitmapAsync().map_err(e)?.join().map_err(e)
    }

    pub fn ocr_languages() -> Result<Value, String> {
        let langs = OcrEngine::AvailableRecognizerLanguages().map_err(e)?;
        Ok(json!(langs.into_iter().map(|l| json!({ "tag": l.LanguageTag().map(|t| t.to_string()).unwrap_or_default(), "name": l.NativeName().map(|t| t.to_string()).unwrap_or_default() })).collect::<Vec<_>>()))
    }

    pub fn ocr(path: &Path, lang: Option<&str>) -> Result<Value, String> {
        let bmp = bitmap(path)?;
        let (w, h) = (bmp.PixelWidth().map_err(e)?, bmp.PixelHeight().map_err(e)?);
        let max = OcrEngine::MaxImageDimension().map_err(e)? as i32;
        if w > max || h > max { return Err(format!("Image trop grande pour l'OCR ({w}×{h}, max {max} px).")); }
        let engine = match lang {
            Some(t) if !t.is_empty() => OcrEngine::TryCreateFromLanguage(&Language::CreateLanguage(&HSTRING::from(t)).map_err(e)?),
            _ => OcrEngine::TryCreateFromUserProfileLanguages(),
        }.map_err(|_| "Aucune langue OCR installée (Paramètres › Heure et langue).".to_string())?;
        let res = engine.RecognizeAsync(&bmp).map_err(e)?.join().map_err(e)?;
        let mut lines = Vec::new();
        for l in res.Lines().map_err(e)? {
            let words: Vec<Value> = l.Words().map_err(e)?.into_iter().map(|w| {
                let r = w.BoundingRect().unwrap_or_default();
                json!({ "text": w.Text().map(|t| t.to_string()).unwrap_or_default(), "x": r.X, "y": r.Y, "w": r.Width, "h": r.Height })
            }).collect();
            lines.push(json!({ "text": l.Text().map_err(e)?.to_string(), "words": words }));
        }
        Ok(json!({ "text": res.Text().map_err(e)?.to_string(), "lines": lines, "width": w, "height": h }))
    }

    pub fn faces(path: &Path) -> Result<Value, String> {
        let bmp = bitmap(path)?;
        let gray = SoftwareBitmap::Convert(&bmp, BitmapPixelFormat::Gray8).map_err(e)?;
        let det = FaceDetector::CreateAsync().map_err(e)?.join().map_err(e)?;
        let found = det.DetectFacesAsync(&gray).map_err(e)?.join().map_err(e)?;
        Ok(json!(found.into_iter().filter_map(|f| f.FaceBox().ok()).map(|b| json!({ "x": b.X, "y": b.Y, "w": b.Width, "h": b.Height })).collect::<Vec<_>>()))
    }

    pub fn voices() -> Result<Value, String> {
        let all = SpeechSynthesizer::AllVoices().map_err(e)?;
        let def = SpeechSynthesizer::DefaultVoice().ok().and_then(|v| v.Id().ok()).map(|s| s.to_string());
        Ok(json!(all.into_iter().map(|v| {
            let id = v.Id().map(|s| s.to_string()).unwrap_or_default();
            json!({ "id": id, "name": v.DisplayName().map(|s| s.to_string()).unwrap_or_default(), "language": v.Language().map(|s| s.to_string()).unwrap_or_default(), "default": def.as_deref() == Some(id.as_str()) })
        }).collect::<Vec<_>>()))
    }

    pub fn synthesize(text: &str, voice: Option<&str>, rate: f64, out: &Path) -> Result<(), String> {
        let s = SpeechSynthesizer::new().map_err(e)?;
        if let Some(id) = voice {
            if let Some(v) = SpeechSynthesizer::AllVoices().map_err(e)?.into_iter().find(|v| v.Id().map(|x| x.to_string() == id).unwrap_or(false)) {
                s.SetVoice(&v).map_err(e)?;
            }
        }
        s.Options().map_err(e)?.SetSpeakingRate(rate.clamp(0.5, 3.0)).map_err(e)?;
        let stream = s.SynthesizeTextToStreamAsync(&HSTRING::from(text)).map_err(e)?.join().map_err(e)?;
        let size = stream.Size().map_err(e)? as u32;
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).map_err(e)?).map_err(e)?;
        reader.LoadAsync(size).map_err(e)?.join().map_err(e)?;
        let mut buf = vec![0u8; size as usize];
        reader.ReadBytes(&mut buf).map_err(e)?;
        std::fs::write(out, buf).map_err(|x| x.to_string())
    }

    /// Lance la capture d'écran de Windows et attend une nouvelle image dans le presse-papiers.
    pub fn snip(ctx: &JobCtx) -> Result<PathBuf, JobError> {
        use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;
        let seq = unsafe { GetClipboardSequenceNumber() };
        crate::engines::command(Path::new("explorer.exe")).arg("ms-screenclip:").spawn()?;
        ctx.stages(&["Capture", "Lecture du texte"]);
        ctx.stage(0, "Sélectionne une zone de l'écran…");
        let t0 = Instant::now();
        loop {
            ctx.check()?;
            std::thread::sleep(Duration::from_millis(300));
            if unsafe { GetClipboardSequenceNumber() } != seq {
                std::thread::sleep(Duration::from_millis(300));
                if let Ok(img) = arboard::Clipboard::new().and_then(|mut c| c.get_image()) {
                    let buf = image::RgbaImage::from_raw(img.width as u32, img.height as u32, img.bytes.into_owned()).ok_or_else(|| JobError::Failed("image illisible".into()))?;
                    let p = std::env::temp_dir().join(format!("toolbox-snip-{}.png", ctx.id()));
                    buf.save(&p).map_err(|x| JobError::Failed(x.to_string()))?;
                    return Ok(p);
                }
            }
            if t0.elapsed() > Duration::from_secs(90) { return Err(JobError::Failed("Aucune capture reçue.".into())); }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_whisper_progress() {
        assert_eq!(whisper_progress("whisper_print_progress_callback: progress =  45%"), Some(0.45));
        assert_eq!(whisper_progress("autre ligne"), None);
    }
}
