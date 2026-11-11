//! Vidéo (1–15) et audio (16–20) via FFmpeg et yt-dlp.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::engines;
use crate::jobs::{self, JobCtx, JobError};
use crate::output;
use crate::settings::SettingsState;

#[derive(Deserialize, Clone)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum MediaOp {
    #[serde(rename_all = "camelCase")]
    CompressVideo { level: String, height: Option<u32>, gpu: bool },
    ConvertVideo { format: String },
    ResizeVideo { width: Option<u32>, height: Option<u32> },
    #[serde(rename_all = "camelCase")]
    CropRotate { rotate: i32, flip_h: bool, flip_v: bool, crop: Option<[f64; 4]> },
    TrimVideo { start: f64, end: f64, precise: bool },
    MuteVideo,
    ReplaceAudio { audio: String, mix: bool, volume: f64 },
    VideoToGif { fps: u32, width: u32, start: Option<f64>, duration: Option<f64> },
    ChangeSpeed { factor: f64 },
    ExtractFrames { every: f64, format: String },
    BurnSubtitles { subtitles: String },
    ExtractAudio { format: String },
    ConvertAudio { format: String, bitrate: u32 },
    TrimAudio { start: f64, end: f64 },
    CleanAudio { strength: String },
    /// Volume perçu ramené à une cible (LUFS).
    NormalizeAudio { target: f64 },
    /// Enregistrement du navigateur (WebM) → format courant.
    ConvertRecording { format: String },
}

#[derive(Default, Debug, Clone)]
pub struct Probe {
    pub duration: f64,
    pub has_audio: bool,
    pub has_video: bool,
    pub width: u32,
    pub height: u32,
}

pub fn probe(ffprobe: &Path, input: &Path) -> Result<Probe, JobError> {
    let out = engines::command(ffprobe)
        .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams"])
        .arg(input)
        .output()?;
    if !out.status.success() {
        return Err(JobError::Failed("Fichier média illisible.".into()));
    }
    let v: Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    let streams = v["streams"].as_array().cloned().unwrap_or_default();
    let video = streams.iter().find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"] != 1);
    Ok(Probe {
        duration: v["format"]["duration"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0.0),
        has_audio: streams.iter().any(|s| s["codec_type"] == "audio"),
        has_video: video.is_some(),
        width: video.and_then(|s| s["width"].as_u64()).unwrap_or(0) as u32,
        height: video.and_then(|s| s["height"].as_u64()).unwrap_or(0) as u32,
    })
}

fn even(x: f64) -> u32 {
    ((x / 2.0).round() * 2.0).max(2.0) as u32
}

/// atempo n'accepte que 0,5–2 : on enchaîne les étages.
pub fn atempo_chain(mut f: f64) -> String {
    let mut parts = Vec::new();
    while f > 2.0 {
        parts.push("atempo=2.0".to_string());
        f /= 2.0;
    }
    while f < 0.5 {
        parts.push("atempo=0.5".to_string());
        f /= 0.5;
    }
    parts.push(format!("atempo={f:.4}"));
    parts.join(",")
}

/// Chemin dans un graphe de filtres FFmpeg (subtitles=…), avec ses deux niveaux d'échappement :
/// valeur d'option (\ ' :) puis graphe (\ ' [ ] , ;). « C:\a b\l'été.srt » → « C\\:/a b/l\\\'été.srt ».
pub fn filter_path(p: &str) -> String {
    let esc = |s: &str, special: &str| s.chars().fold(String::new(), |mut o, c| {
        if special.contains(c) { o.push('\\'); }
        o.push(c);
        o
    });
    esc(&esc(&p.replace('\\', "/"), "\\':"), "\\'[],;")
}

fn audio_codec(format: &str, bitrate: u32) -> Vec<String> {
    let br = format!("{bitrate}k");
    let v: Vec<&str> = match format {
        "mp3" => vec!["-c:a", "libmp3lame", "-b:a", &br],
        "m4a" => vec!["-c:a", "aac", "-b:a", &br],
        "wav" => vec!["-c:a", "pcm_s16le"],
        "flac" => vec!["-c:a", "flac"],
        "aiff" => vec!["-c:a", "pcm_s16be"],
        _ => vec!["-c:a", "aac", "-b:a", &br],
    };
    v.into_iter().map(String::from).collect()
}

pub fn x264(crf: u32) -> Vec<String> {
    ["-c:v", "libx264", "-preset", "medium", "-crf", &crf.to_string(), "-pix_fmt", "yuv420p"].map(String::from).to_vec()
}

fn aac() -> Vec<String> {
    ["-c:a", "aac", "-b:a", "160k"].map(String::from).to_vec()
}

fn gpu_codec(encoder: &str, q: u32) -> Vec<String> {
    let q = q.to_string();
    let v: Vec<&str> = match encoder {
        "h264_nvenc" => vec!["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", &q, "-b:v", "0"],
        "h264_qsv" => vec!["-c:v", "h264_qsv", "-global_quality", &q],
        "h264_amf" => vec!["-c:v", "h264_amf", "-rc", "cqp", "-qp_i", &q, "-qp_p", &q],
        _ => return x264(q.parse().unwrap_or(23)),
    };
    let mut out: Vec<String> = v.into_iter().map(String::from).collect();
    out.extend(["-pix_fmt", "yuv420p"].map(String::from));
    out
}

/// Arguments FFmpeg (hors entrée/sortie) et extension de sortie. Fonction pure : testée ci-dessous.
pub fn build(op: &MediaOp, p: &Probe, in_ext: &str, gpu_encoder: Option<&str>) -> Result<(Vec<String>, String, f64), String> {
    let mut a: Vec<String> = Vec::new();
    let mut vf: Vec<String> = Vec::new();
    let s = |x: &str| x.to_string();
    let mut dur = p.duration;
    let video_ext = if matches!(in_ext, "mp4" | "mov" | "m4v" | "mkv") { in_ext.to_string() } else { s("mp4") };
    let ext = match op {
        MediaOp::CompressVideo { level, height, gpu } => {
            let crf = match level.as_str() { "light" => 23, "strong" => 31, _ => 27 };
            if let Some(h) = height.filter(|h| *h < p.height) {
                vf.push(format!("scale=-2:{h}"));
            }
            match (gpu, gpu_encoder) {
                (true, Some(enc)) => a.extend(gpu_codec(enc, crf + 2)),
                _ => a.extend(x264(crf)),
            }
            a.extend(if p.has_audio { ["-c:a", "aac", "-b:a", "128k"].map(String::from).to_vec() } else { vec![s("-an")] });
            a.extend(["-movflags", "+faststart"].map(String::from));
            s("mp4")
        }
        MediaOp::ConvertVideo { format } => match format.as_str() {
            "webm" => {
                a.extend(["-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-row-mt", "1", "-c:a", "libopus", "-b:a", "128k"].map(String::from));
                s("webm")
            }
            f @ ("mov" | "m4v" | "mp4") => {
                a.extend(x264(20));
                a.extend(aac());
                a.extend(["-movflags", "+faststart"].map(String::from));
                s(f)
            }
            f => return Err(format!("format inconnu : {f}")),
        },
        MediaOp::ResizeVideo { width, height } => {
            let w = width.map(|w| even(w as f64).to_string()).unwrap_or(s("-2"));
            let h = height.map(|h| even(h as f64).to_string()).unwrap_or(s("-2"));
            if w == "-2" && h == "-2" {
                return Err(s("Indique une largeur ou une hauteur."));
            }
            vf.push(format!("scale={w}:{h}:flags=lanczos"));
            a.extend(x264(20));
            a.extend(if p.has_audio { vec![s("-c:a"), s("copy")] } else { vec![] });
            video_ext
        }
        MediaOp::CropRotate { rotate, flip_h, flip_v, crop } => {
            if let Some([x, y, w, h]) = crop {
                let (cw, ch) = (even(p.width as f64 * w), even(p.height as f64 * h));
                vf.push(format!("crop={cw}:{ch}:{}:{}", (p.width as f64 * x).round() as u32, (p.height as f64 * y).round() as u32));
            }
            match rotate.rem_euclid(360) {
                90 => vf.push(s("transpose=1")),
                180 => vf.push(s("hflip,vflip")),
                270 => vf.push(s("transpose=2")),
                _ => {}
            }
            if *flip_h { vf.push(s("hflip")); }
            if *flip_v { vf.push(s("vflip")); }
            if vf.is_empty() {
                return Err(s("Aucune modification choisie."));
            }
            a.extend(x264(20));
            a.extend(if p.has_audio { vec![s("-c:a"), s("copy")] } else { vec![] });
            video_ext
        }
        MediaOp::TrimVideo { start, end, precise } => {
            if end <= start {
                return Err(s("La fin doit être après le début."));
            }
            a.extend([s("-ss"), format!("{start:.3}"), s("-to"), format!("{end:.3}")]);
            if *precise { a.extend(x264(18)); a.extend(aac()); } else { a.extend(["-c", "copy", "-avoid_negative_ts", "make_zero"].map(String::from)); }
            dur = end - start;
            in_ext.to_string()
        }
        MediaOp::MuteVideo => {
            a.extend(["-c:v", "copy", "-an"].map(String::from));
            in_ext.to_string()
        }
        MediaOp::ReplaceAudio { mix, volume, .. } => {
            // L'entrée 1 (audio) est ajoutée par l'appelant.
            if *mix && p.has_audio {
                a.extend([s("-filter_complex"), format!("[1:a]volume={volume:.2}[n];[0:a][n]amix=inputs=2:duration=first:dropout_transition=0[a]"), s("-map"), s("0:v"), s("-map"), s("[a]")]);
            } else {
                a.extend([s("-filter_complex"), format!("[1:a]volume={volume:.2}[a]"), s("-map"), s("0:v"), s("-map"), s("[a]"), s("-shortest")]);
            }
            a.extend(["-c:v", "copy", "-c:a", "aac", "-b:a", "192k"].map(String::from));
            video_ext
        }
        MediaOp::VideoToGif { fps, width, start, duration } => {
            if let Some(st) = start { a.extend([s("-ss"), format!("{st:.3}")]); }
            if let Some(d) = duration { a.extend([s("-t"), format!("{d:.3}")]); dur = *d; }
            a.extend([s("-filter_complex"), format!("fps={fps},scale={width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5"), s("-loop"), s("0")]);
            s("gif")
        }
        MediaOp::ChangeSpeed { factor } => {
            if !(0.1..=10.0).contains(factor) {
                return Err(s("Vitesse entre 0,1× et 10×."));
            }
            if p.has_audio {
                a.extend([s("-filter_complex"), format!("[0:v]setpts=PTS/{factor}[v];[0:a]{}[a]", atempo_chain(*factor)), s("-map"), s("[v]"), s("-map"), s("[a]")]);
                a.extend(aac());
            } else {
                vf.push(format!("setpts=PTS/{factor}"));
            }
            a.extend(x264(20));
            dur = p.duration / factor;
            video_ext
        }
        MediaOp::ExtractFrames { every, format } => {
            vf.push(format!("fps=1/{every}"));
            if format == "jpg" { a.extend(["-q:v", "2"].map(String::from)); }
            format.clone()
        }
        MediaOp::BurnSubtitles { subtitles } => {
            // Un fichier ASS porte son propre style (police, taille, position…) : on le respecte.
            if subtitles.to_lowercase().ends_with(".ass") {
                vf.push(format!("subtitles={}", filter_path(subtitles)));
            } else {
                vf.push(format!("subtitles={}:force_style='FontName=Arial,FontSize=22,Outline=2'", filter_path(subtitles)));
            }
            a.extend(x264(20));
            a.extend(if p.has_audio { vec![s("-c:a"), s("copy")] } else { vec![] });
            video_ext
        }
        MediaOp::ExtractAudio { format } | MediaOp::ConvertRecording { format } if !p.has_video || matches!(op, MediaOp::ExtractAudio { .. }) || matches!(format.as_str(), "mp3" | "m4a" | "wav" | "flac") => {
            if !p.has_audio { return Err(s("Ce fichier n'a pas de piste audio.")); }
            a.push(s("-vn"));
            a.extend(audio_codec(format, 192));
            format.clone()
        }
        MediaOp::ConvertRecording { .. } => {
            a.extend(x264(23));
            a.extend(if p.has_audio { aac() } else { vec![] });
            a.extend(["-movflags", "+faststart", "-r", "30"].map(String::from));
            s("mp4")
        }
        MediaOp::ExtractAudio { .. } => unreachable!(),
        MediaOp::ConvertAudio { format, bitrate } => {
            a.push(s("-vn"));
            a.extend(audio_codec(format, *bitrate));
            format.clone()
        }
        MediaOp::TrimAudio { start, end } => {
            if end <= start { return Err(s("La fin doit être après le début.")); }
            a.extend([s("-ss"), format!("{start:.3}"), s("-to"), format!("{end:.3}"), s("-vn")]);
            let fmt = if matches!(in_ext, "mp3" | "m4a" | "wav" | "flac" | "aiff") { in_ext.to_string() } else { s("m4a") };
            a.extend(audio_codec(&fmt, 192));
            dur = end - start;
            fmt
        }
        MediaOp::CleanAudio { strength } => {
            let nr = match strength.as_str() { "light" => 12, "strong" => 30, _ => 20 };
            // loudnorm suréchantillonne à 192 kHz : on revient à 48 kHz.
            a.extend([s("-af"), format!("highpass=f=70,afftdn=nr={nr}:nf=-30:tn=1,lowpass=f=14000,loudnorm=I=-16:TP=-1.5:LRA=11"), s("-ar"), s("48000")]);
            if p.has_video {
                a.extend(["-c:v", "copy"].map(String::from));
                a.extend(aac());
                video_ext
            } else {
                let fmt = if matches!(in_ext, "mp3" | "m4a" | "wav" | "flac") { in_ext.to_string() } else { s("m4a") };
                a.extend(audio_codec(&fmt, 192));
                fmt
            }
        }
        MediaOp::NormalizeAudio { target } => {
            if !p.has_audio { return Err(s("Ce fichier n'a pas de piste audio.")); }
            if !(-30.0..=-5.0).contains(target) { return Err(s("Cible entre −30 et −5 LUFS.")); }
            a.extend([s("-af"), format!("loudnorm=I={target}:TP=-1.0:LRA=11"), s("-ar"), s("48000")]);
            if p.has_video {
                a.extend(["-c:v", "copy"].map(String::from));
                a.extend(aac());
                video_ext
            } else {
                let fmt = if matches!(in_ext, "mp3" | "m4a" | "wav" | "flac") { in_ext.to_string() } else { s("m4a") };
                a.extend(audio_codec(&fmt, 192));
                fmt
            }
        }
    };
    if !vf.is_empty() {
        a.splice(0..0, [s("-vf"), vf.join(",")]);
    }
    Ok((a, ext, dur))
}

/// Parse `out_time_us=…` de `-progress pipe:1`.
pub fn progress_seconds(line: &str) -> Option<f64> {
    let v = line.strip_prefix("out_time_us=").or_else(|| line.strip_prefix("out_time_ms="))?;
    v.trim().parse::<f64>().ok().map(|us| us / 1_000_000.0)
}

fn today(app: &AppHandle) -> Result<PathBuf, String> {
    let s = app.state::<SettingsState>().0.lock().unwrap().clone();
    output::today_dir(&s).map_err(|e| e.to_string())
}

fn stem(p: &Path) -> String {
    p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "media".into())
}

/// Lance FFmpeg avec suivi de progression ; `inputs` = entrées supplémentaires après l'entrée principale.
fn ffmpeg(ctx: &JobCtx, bin: &Path, input: &Path, extra_inputs: &[PathBuf], args: &[String], out: &Path, dur: f64, label: &str) -> Result<(), JobError> {
    let mut c = engines::command(bin);
    c.args(["-hide_banner", "-y", "-nostats", "-progress", "pipe:1", "-i"]).arg(input);
    for e in extra_inputs {
        c.arg("-i").arg(e);
    }
    c.args(args).arg(out);
    let t0 = std::time::Instant::now();
    let clock = |s: f64| format!("{}:{:02}", (s / 60.0) as u64, (s % 60.0) as u64);
    engines::run(ctx, c, |l| {
        if let Some(t) = progress_seconds(l) {
            let speed = t / t0.elapsed().as_secs_f64().max(0.1);
            let pos = if dur > 0.0 { format!("{} / {}", clock(t), clock(dur)) } else { clock(t) };
            ctx.progress((dur > 0.0).then(|| t / dur), format!("{label} · {pos} · ×{speed:.1} temps réel"));
        }
    })
}

/// Détecte un encodeur matériel H.264 réellement utilisable (essai d'une seconde).
fn detect_gpu(ffmpeg_bin: &Path) -> Option<&'static str> {
    for enc in ["h264_nvenc", "h264_qsv", "h264_amf"] {
        let ok = engines::command(ffmpeg_bin)
            .args(["-hide_banner", "-v", "error", "-f", "lavfi", "-i", "color=black:s=256x256:d=0.2", "-c:v", enc, "-f", "null", "-"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if ok {
            return Some(enc);
        }
    }
    None
}

#[tauri::command]
pub fn media_process(app: AppHandle, tool: String, paths: Vec<String>, op: MediaOp) -> Result<u64, String> {
    let dir = today(&app)?;
    let h = app.clone();
    Ok(jobs::spawn(&app, &tool, move |ctx| {
        let ff = engines::require(&h, "ffmpeg", "ffmpeg")?;
        let fp = engines::require(&h, "ffmpeg", "ffprobe")?;
        ctx.stages(&["Analyse", "Traitement"]);
        let gpu = match &op {
            MediaOp::CompressVideo { gpu: true, .. } => {
                ctx.stage(0, "Recherche d'un encodeur matériel (carte graphique)…");
                detect_gpu(&ff)
            }
            _ => None,
        };
        let mut outputs = Vec::new();
        for (i, path) in paths.iter().enumerate() {
            ctx.check()?;
            let input = PathBuf::from(path);
            let in_ext = input.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
            let label = format!("{}{}", if paths.len() > 1 { format!("{}/{} · ", i + 1, paths.len()) } else { String::new() }, input.file_name().unwrap_or_default().to_string_lossy());
            ctx.stage(0, format!("Analyse de {label}…"));
            let p = probe(&fp, &input)?;
            let (args, ext, dur) = build(&op, &p, &in_ext, gpu).map_err(JobError::Failed)?;
            ctx.stage(1, format!("{label} · démarrage…"));
            let extra: Vec<PathBuf> = match &op { MediaOp::ReplaceAudio { audio, .. } => vec![PathBuf::from(audio)], _ => vec![] };
            let out = if matches!(op, MediaOp::ExtractFrames { .. }) {
                let d = output::unique_path(&dir, &format!("{} - images", stem(&input)));
                std::fs::create_dir_all(&d)?;
                d.join(format!("{}-%04d.{ext}", stem(&input)))
            } else {
                output::unique_path(&dir, &format!("{}.{ext}", stem(&input)))
            };
            let r = ffmpeg(ctx, &ff, &input, &extra, &args, &out, dur, &label);
            // Encodeur matériel capricieux : on retente en logiciel.
            if let (Err(JobError::Failed(_)), Some(_)) = (&r, gpu) {
                let (args, _, _) = build(&op, &p, &in_ext, None).map_err(JobError::Failed)?;
                ffmpeg(ctx, &ff, &input, &extra, &args, &out, dur, &label)?;
            } else {
                r?;
            }
            let shown = if matches!(op, MediaOp::ExtractFrames { .. }) { out.parent().unwrap().to_path_buf() } else { out };
            outputs.push(json!({ "name": input.file_name().map(|s| s.to_string_lossy().into_owned()), "output": shown.display().to_string(),
                "before": std::fs::metadata(&input).map(|m| m.len()).unwrap_or(0), "after": std::fs::metadata(&shown).map(|m| m.len()).unwrap_or(0), "error": null, "note": null }));
        }
        Ok(json!({ "dir": dir.display().to_string(), "files": outputs }))
    }))
}

/// 12 Fusionner : concaténation avec normalisation (taille du premier clip, 30 i/s).
#[tauri::command]
pub fn media_merge(app: AppHandle, paths: Vec<String>) -> Result<u64, String> {
    let dir = today(&app)?;
    let h = app.clone();
    Ok(jobs::spawn(&app, "merge-videos", move |ctx| {
        let ff = engines::require(&h, "ffmpeg", "ffmpeg")?;
        let fp = engines::require(&h, "ffmpeg", "ffprobe")?;
        ctx.stages(&["Analyse des clips", "Assemblage"]);
        ctx.stage(0, format!("Analyse de {} clips…", paths.len()));
        let probes: Vec<Probe> = paths.iter().map(|p| probe(&fp, Path::new(p))).collect::<Result<_, _>>()?;
        ctx.stage(1, "Assemblage…");
        let (w, h) = (even(probes[0].width as f64), even(probes[0].height as f64));
        let audio = probes.iter().all(|p| p.has_audio);
        let mut graph = String::new();
        for i in 0..paths.len() {
            graph += &format!("[{i}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v{i}];");
            if audio { graph += &format!("[{i}:a]aformat=sample_rates=48000:channel_layouts=stereo[a{i}];"); }
        }
        for i in 0..paths.len() {
            graph += &format!("[v{i}]{}", if audio { format!("[a{i}]") } else { String::new() });
        }
        graph += &format!("concat=n={}:v=1:a={}[v]{}", paths.len(), audio as u8, if audio { "[a]" } else { "" });
        let mut args = vec!["-filter_complex".to_string(), graph, "-map".into(), "[v]".into()];
        if audio { args.extend(["-map".into(), "[a]".into()]); args.extend(aac()); }
        args.extend(x264(20));
        args.extend(["-movflags".into(), "+faststart".into()]);
        let out = output::unique_path(&dir, "fusion.mp4");
        let total: f64 = probes.iter().map(|p| p.duration).sum();
        let extra: Vec<PathBuf> = paths[1..].iter().map(PathBuf::from).collect();
        ffmpeg(ctx, &ff, Path::new(&paths[0]), &extra, &args, &out, total, "Fusion")?;
        Ok(json!({ "dir": dir.display().to_string(), "files": [{ "name": "fusion.mp4", "output": out.display().to_string(), "before": 0, "after": std::fs::metadata(&out)?.len(), "error": null, "note": if audio { Value::Null } else { json!("sans son : un des clips n'a pas de piste audio") } }] }))
    }))
}

/// 10 Infos média (ffprobe complet).
#[tauri::command]
pub fn media_info(app: AppHandle, path: String) -> Result<Value, String> {
    let fp = engines::resolve(&app, "ffmpeg", "ffprobe").ok_or("FFmpeg n'est pas installé.")?;
    let out = engines::command(&fp).args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams"]).arg(&path).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("Fichier média illisible.".into());
    }
    serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())
}

/// 1 Télécharger une vidéo (yt-dlp, fusion par FFmpeg).
#[tauri::command]
pub fn video_download(app: AppHandle, url: String, audio_only: bool) -> Result<u64, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Colle un lien qui commence par https://".into());
    }
    let dir = today(&app)?;
    let h = app.clone();
    Ok(jobs::spawn(&app, "download-video", move |ctx| {
        let yt = engines::require(&h, "yt-dlp", "yt-dlp")?;
        let ff = engines::require(&h, "ffmpeg", "ffmpeg")?;
        let mut c = engines::command(&yt);
        c.args(["--newline", "--no-playlist", "--no-mtime", "--restrict-filenames"]);
        c.arg("--ffmpeg-location").arg(ff.parent().unwrap_or(Path::new(".")));
        c.arg("-o").arg(dir.join("%(title).100B [%(id)s].%(ext)s"));
        c.args(["--print", "after_move:filepath"]);
        if audio_only {
            c.args(["-x", "--audio-format", "mp3", "--audio-quality", "0"]);
        } else {
            c.args(["-f", "bv*[vcodec^=avc1]+ba[ext=m4a]/bv*+ba/b", "--merge-output-format", "mp4"]);
        }
        c.arg(&url);
        let mut file = None;
        let mut part = 0;
        ctx.stages(&["Lecture de la page", "Téléchargement", "Assemblage"]);
        ctx.stage(0, "Connexion au site…");
        engines::run(ctx, c, |l| {
            if let Some(rest) = l.strip_prefix("[download]") {
                let rest = rest.trim();
                if let Some(pct) = rest.split('%').next().and_then(|s| s.trim().parse::<f64>().ok()) {
                    // « 45.3% of ~ 12.34MiB at 1.23MiB/s ETA 00:12 »
                    let detail = rest.splitn(2, '%').nth(1).unwrap_or("").replace("of ~", "sur").replace("of", "sur").replace(" at ", " · ").replace("ETA", "· reste");
                    ctx.progress(Some(pct / 100.0), format!("{}{}", if part > 1 { format!("Flux {part} · ") } else { String::new() }, detail.trim()));
                } else if let Some(dest) = rest.strip_prefix("Destination:") {
                    part += 1;
                    let name = Path::new(dest.trim()).file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                    ctx.stage(1, format!("{} {name}", if part > 1 { "Son :" } else { "Fichier :" }));
                }
            } else if l.starts_with('[') && !l.starts_with("[Merger]") && !l.starts_with("[ExtractAudio]") && !l.starts_with("[info]") && part == 0 {
                ctx.progress(None, l.split_once(']').map(|x| x.1.trim()).unwrap_or(l).to_string());
            } else if l.starts_with("[Merger]") || l.starts_with("[ExtractAudio]") {
                ctx.stage(2, if l.starts_with("[Merger]") { "Fusion de l'image et du son…" } else { "Conversion en MP3…" });
            } else if !l.starts_with('[') && Path::new(l).is_file() {
                file = Some(l.to_string());
            }
        })?;
        let file = file.ok_or_else(|| JobError::Failed("Téléchargement terminé mais fichier introuvable.".into()))?;
        Ok(json!({ "output": file, "size": std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0) }))
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p() -> Probe {
        Probe { duration: 100.0, has_audio: true, has_video: true, width: 1920, height: 1080 }
    }

    #[test]
    fn compress_and_resize() {
        let (a, ext, _) = build(&MediaOp::CompressVideo { level: "balanced".into(), height: Some(720), gpu: false }, &p(), "mov", None).unwrap();
        assert_eq!(ext, "mp4");
        assert_eq!(&a[..2], ["-vf", "scale=-2:720"]);
        assert!(a.windows(2).any(|w| w == ["-crf", "27"]));
        let (a, _, _) = build(&MediaOp::CompressVideo { level: "light".into(), height: Some(1080), gpu: true }, &p(), "mp4", Some("h264_nvenc")).unwrap();
        assert!(!a.contains(&"-vf".to_string()), "pas d'agrandissement");
        assert!(a.contains(&"h264_nvenc".to_string()));
    }

    #[test]
    fn speed_trim_gif() {
        assert_eq!(atempo_chain(4.0), "atempo=2.0,atempo=2.0000");
        assert_eq!(atempo_chain(0.25), "atempo=0.5,atempo=0.5000");
        let (a, _, d) = build(&MediaOp::ChangeSpeed { factor: 2.0 }, &p(), "mp4", None).unwrap();
        assert_eq!(d, 50.0);
        assert!(a.iter().any(|x| x.contains("setpts=PTS/2") && x.contains("atempo=2.0000")));
        let (a, ext, d) = build(&MediaOp::TrimVideo { start: 10.0, end: 25.5, precise: false }, &p(), "mkv", None).unwrap();
        assert_eq!((ext.as_str(), d), ("mkv", 15.5));
        assert!(a.windows(2).any(|w| w == ["-c", "copy"]));
        assert!(build(&MediaOp::TrimVideo { start: 5.0, end: 5.0, precise: false }, &p(), "mp4", None).is_err());
        let (_, ext, d) = build(&MediaOp::VideoToGif { fps: 12, width: 480, start: Some(3.0), duration: Some(4.0) }, &p(), "mp4", None).unwrap();
        assert_eq!((ext.as_str(), d), ("gif", 4.0));
    }

    #[test]
    fn crop_rotate_and_paths() {
        let (a, _, _) = build(&MediaOp::CropRotate { rotate: 90, flip_h: true, flip_v: false, crop: Some([0.1, 0.0, 0.5, 0.5]) }, &p(), "mp4", None).unwrap();
        assert_eq!(a[1], "crop=960:540:192:0,transpose=1,hflip");
        assert_eq!(filter_path(r"C:\Vidéos\l'été, 2.srt"), r"C\\:/Vidéos/l\\\'été\, 2.srt");
        assert_eq!(progress_seconds("out_time_us=2500000"), Some(2.5));
    }

    #[test]
    fn audio_ops() {
        let (a, ext, _) = build(&MediaOp::ExtractAudio { format: "mp3".into() }, &p(), "mp4", None).unwrap();
        assert_eq!(ext, "mp3");
        assert!(a.contains(&"libmp3lame".to_string()));
        let noaudio = Probe { has_audio: false, ..p() };
        assert!(build(&MediaOp::ExtractAudio { format: "mp3".into() }, &noaudio, "mp4", None).is_err());
        let (a, ext, _) = build(&MediaOp::NormalizeAudio { target: -16.0 }, &p(), "mov", None).unwrap();
        assert_eq!(ext, "mov");
        assert!(a.windows(2).any(|w| w == ["-c:v", "copy"]) && a.windows(2).any(|w| w == ["-ar", "48000"]));
        let (_, ext, _) = build(&MediaOp::NormalizeAudio { target: -16.0 }, &Probe { has_video: false, ..p() }, "ogg", None).unwrap();
        assert_eq!(ext, "m4a");
        assert!(build(&MediaOp::NormalizeAudio { target: 0.0 }, &p(), "mp4", None).is_err());
        let (a, _, _) = build(&MediaOp::BurnSubtitles { subtitles: r"C:\s\x.ASS".into() }, &p(), "mp4", None).unwrap();
        assert_eq!(a[1], r"subtitles=C\\:/s/x.ASS");
        let (_, ext, _) = build(&MediaOp::ConvertRecording { format: "mp4".into() }, &p(), "webm", None).unwrap();
        assert_eq!(ext, "mp4");
        let rec = Probe { has_video: false, ..p() };
        let (_, ext, _) = build(&MediaOp::ConvertRecording { format: "m4a".into() }, &rec, "webm", None).unwrap();
        assert_eq!(ext, "m4a");
    }

    /// Exécute réellement chaque opération avec le FFmpeg du système (ignoré s'il est absent).
    #[test]
    fn ffmpeg_runs_every_op() {
        let (Some(ff), Some(fp)) = (which_bin("ffmpeg"), which_bin("ffprobe")) else { return };
        let dir = std::env::temp_dir().join(format!("tb-media-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("src.mp4");
        let ok = std::process::Command::new(&ff)
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=25", "-f", "lavfi", "-i", "sine=f=440:d=2", "-shortest", "-c:v", "libx264", "-c:a", "aac"])
            .arg(&src).status().unwrap().success();
        assert!(ok);
        let srt = dir.join("s t.srt");
        std::fs::write(&srt, "1\n00:00:00,000 --> 00:00:01,500\nBonjour\n").unwrap();
        let ass = dir.join("l'été, [v2].ass");
        std::fs::write(&ass, "[Script Info]\nScriptType: v4.00+\nPlayResX: 320\nPlayResY: 240\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,24,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,0,5,16,16,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,{\\c&H0000D4FF}SALUT{\\c&H00FFFFFF} TOI\n").unwrap();
        let pr = probe(&fp, &src).ok().unwrap();
        assert!(pr.has_audio && pr.width == 320);
        let ops = vec![
            MediaOp::CompressVideo { level: "strong".into(), height: Some(120), gpu: false },
            MediaOp::ConvertVideo { format: "webm".into() },
            MediaOp::ResizeVideo { width: Some(160), height: None },
            MediaOp::CropRotate { rotate: 270, flip_h: false, flip_v: true, crop: Some([0.25, 0.25, 0.5, 0.5]) },
            MediaOp::TrimVideo { start: 0.5, end: 1.5, precise: true },
            MediaOp::MuteVideo,
            MediaOp::VideoToGif { fps: 10, width: 160, start: Some(0.0), duration: Some(1.0) },
            MediaOp::ChangeSpeed { factor: 3.0 },
            MediaOp::ExtractFrames { every: 1.0, format: "png".into() },
            MediaOp::BurnSubtitles { subtitles: srt.display().to_string() },
            MediaOp::ExtractAudio { format: "mp3".into() },
            MediaOp::ConvertAudio { format: "flac".into(), bitrate: 192 },
            MediaOp::CleanAudio { strength: "balanced".into() },
            MediaOp::NormalizeAudio { target: -14.0 },
            MediaOp::BurnSubtitles { subtitles: ass.display().to_string() },
            MediaOp::ReplaceAudio { audio: src.display().to_string(), mix: true, volume: 0.5 },
        ];
        for (i, op) in ops.iter().enumerate() {
            let (args, ext, _) = build(op, &pr, "mp4", None).unwrap();
            let out = if matches!(op, MediaOp::ExtractFrames { .. }) { dir.join(format!("f{i}-%03d.{ext}")) } else { dir.join(format!("o{i}.{ext}")) };
            let mut c = std::process::Command::new(&ff);
            c.args(["-v", "error", "-y", "-i"]).arg(&src);
            if let MediaOp::ReplaceAudio { audio, .. } = op { c.arg("-i").arg(audio); }
            let o = c.args(&args).arg(&out).output().unwrap();
            assert!(o.status.success(), "op {i} : {}", String::from_utf8_lossy(&o.stderr));
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    fn which_bin(n: &str) -> Option<PathBuf> {
        std::env::split_paths(&std::env::var_os("PATH")?).map(|d| d.join(n)).find(|p| p.is_file())
    }
}
