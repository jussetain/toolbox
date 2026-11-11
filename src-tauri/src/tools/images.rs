//! Outils images par lot (24 Convertir · 25 Compresser · 26 Redimensionner · 27 Pivoter · 28 Métadonnées).

use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::codecs::webp::WebPEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Rgba, RgbaImage};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Manager};

use crate::jobs;
use crate::output;
use crate::settings::SettingsState;

#[derive(Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Fmt { Jpeg, Png, Webp, Tiff, Bmp, Gif }

impl Fmt {
    fn ext(self) -> &'static str {
        match self { Fmt::Jpeg => "jpg", Fmt::Png => "png", Fmt::Webp => "webp", Fmt::Tiff => "tiff", Fmt::Bmp => "bmp", Fmt::Gif => "gif" }
    }
    fn from_image(f: ImageFormat) -> Option<Fmt> {
        Some(match f {
            ImageFormat::Jpeg => Fmt::Jpeg, ImageFormat::Png => Fmt::Png, ImageFormat::WebP => Fmt::Webp,
            ImageFormat::Tiff => Fmt::Tiff, ImageFormat::Bmp => Fmt::Bmp, ImageFormat::Gif => Fmt::Gif,
            _ => return None,
        })
    }
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum ResizeMode { Percent, Longest, Fit, Exact }

#[derive(Deserialize, Clone)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum ImageOp {
    Convert { format: Fmt, quality: u8 },
    Compress { quality: u8 },
    #[serde(rename_all = "camelCase")]
    Resize { mode: ResizeMode, percent: Option<u32>, width: Option<u32>, height: Option<u32>, no_upscale: bool },
    #[serde(rename_all = "camelCase")]
    Rotate { degrees: i32, flip_h: bool, flip_v: bool },
    StripMetadata,
    /// Zone relative [x, y, l, h] (0–1) et/ou format imposé (largeur / hauteur).
    Crop { rect: Option<[f64; 4]>, ratio: Option<f64> },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileResult {
    name: String,
    output: Option<String>,
    before: u64,
    after: u64,
    error: Option<String>,
    note: Option<String>,
}

/// Ouvre une image en appliquant l'orientation EXIF.
pub fn open_oriented(path: &Path) -> Result<(DynamicImage, Option<ImageFormat>, bool), String> {
    let reader = ImageReader::open(path).map_err(|e| e.to_string())?.with_guessed_format().map_err(|e| e.to_string())?;
    let format = reader.format();
    let mut dec = reader.into_decoder().map_err(|e| format!("format non pris en charge ({e})"))?;
    let orientation = dec.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut img = DynamicImage::from_decoder(dec).map_err(|e| e.to_string())?;
    let rotated = orientation != image::metadata::Orientation::NoTransforms;
    img.apply_orientation(orientation);
    Ok((img, format, rotated))
}

/// Aplatit la transparence sur fond blanc (pour le JPEG).
fn flatten_white(img: &DynamicImage) -> DynamicImage {
    if !img.color().has_alpha() {
        return img.clone();
    }
    let rgba = img.to_rgba8();
    let mut bg = RgbaImage::from_pixel(rgba.width(), rgba.height(), Rgba([255, 255, 255, 255]));
    image::imageops::overlay(&mut bg, &rgba, 0, 0);
    DynamicImage::ImageRgba8(bg)
}

pub fn encode(img: &DynamicImage, fmt: Fmt, quality: u8) -> Result<Vec<u8>, String> {
    let mut buf = Cursor::new(Vec::new());
    let e = |e: image::ImageError| e.to_string();
    match fmt {
        Fmt::Jpeg => {
            let rgb = flatten_white(img).to_rgb8();
            JpegEncoder::new_with_quality(&mut buf, quality.clamp(1, 100)).encode_image(&rgb).map_err(e)?;
        }
        Fmt::Png => {
            img.write_with_encoder(PngEncoder::new(&mut buf)).map_err(e)?;
            return optimize_png(&buf.into_inner());
        }
        Fmt::Webp => {
            let rgba = img.to_rgba8();
            WebPEncoder::new_lossless(&mut buf).encode(&rgba, rgba.width(), rgba.height(), image::ExtendedColorType::Rgba8).map_err(e)?;
        }
        Fmt::Tiff => img.write_to(&mut buf, ImageFormat::Tiff).map_err(e)?,
        Fmt::Bmp => DynamicImage::ImageRgb8(img.to_rgb8()).write_to(&mut buf, ImageFormat::Bmp).map_err(e)?,
        Fmt::Gif => img.write_to(&mut buf, ImageFormat::Gif).map_err(e)?,
    }
    Ok(buf.into_inner())
}

fn optimize_png(data: &[u8]) -> Result<Vec<u8>, String> {
    let opts = oxipng::Options::from_preset(2);
    oxipng::optimize_from_memory(data, &opts).map_err(|e| e.to_string())
}

/// Retire EXIF/XMP/IPTC/commentaires d'un JPEG sans réencoder (garde JFIF, ICC et Adobe).
pub fn strip_jpeg(data: &[u8]) -> Option<Vec<u8>> {
    if data.len() < 4 || data[0] != 0xFF || data[1] != 0xD8 {
        return None;
    }
    let mut out = vec![0xFF, 0xD8];
    let mut i = 2;
    while i + 4 <= data.len() {
        if data[i] != 0xFF {
            return None;
        }
        let marker = data[i + 1];
        if marker == 0xFF {
            i += 1;
            continue;
        }
        if marker == 0xDA {
            out.extend_from_slice(&data[i..]);
            return Some(out);
        }
        if (0xD0..=0xD7).contains(&marker) || marker == 0x01 {
            out.extend_from_slice(&data[i..i + 2]);
            i += 2;
            continue;
        }
        let len = u16::from_be_bytes([data[i + 2], data[i + 3]]) as usize;
        let end = i + 2 + len;
        if len < 2 || end > data.len() {
            return None;
        }
        let keep = match marker {
            0xE0 | 0xE2 | 0xEE => true,      // JFIF, ICC, Adobe
            0xE1 | 0xE3..=0xED | 0xEF | 0xFE => false, // EXIF/XMP, autres APPn, commentaire
            _ => true,
        };
        if keep {
            out.extend_from_slice(&data[i..end]);
        }
        i = end;
    }
    None
}

/// Retire les blocs texte, EXIF et date d'un PNG sans réencoder.
pub fn strip_png(data: &[u8]) -> Option<Vec<u8>> {
    const SIG: &[u8] = b"\x89PNG\r\n\x1a\n";
    if !data.starts_with(SIG) {
        return None;
    }
    let mut out = SIG.to_vec();
    let mut i = 8;
    while i + 12 <= data.len() {
        let len = u32::from_be_bytes(data[i..i + 4].try_into().ok()?) as usize;
        let end = i + 12 + len;
        if end > data.len() {
            return None;
        }
        let kind = &data[i + 4..i + 8];
        if !matches!(kind, b"tEXt" | b"zTXt" | b"iTXt" | b"eXIf" | b"tIME") {
            out.extend_from_slice(&data[i..end]);
        }
        i = end;
    }
    Some(out)
}

fn resize(img: DynamicImage, mode: ResizeMode, percent: Option<u32>, w: Option<u32>, h: Option<u32>, no_upscale: bool) -> DynamicImage {
    let (iw, ih) = (img.width(), img.height());
    let (tw, th) = match mode {
        ResizeMode::Percent => {
            let p = percent.unwrap_or(50).max(1) as f64 / 100.0;
            (((iw as f64) * p).round() as u32, ((ih as f64) * p).round() as u32)
        }
        ResizeMode::Longest => {
            let l = w.unwrap_or(1920).max(1) as f64;
            let r = l / iw.max(ih) as f64;
            (((iw as f64) * r).round() as u32, ((ih as f64) * r).round() as u32)
        }
        ResizeMode::Fit => {
            let (bw, bh) = (w.unwrap_or(iw).max(1) as f64, h.unwrap_or(ih).max(1) as f64);
            let r = (bw / iw as f64).min(bh / ih as f64);
            (((iw as f64) * r).round() as u32, ((ih as f64) * r).round() as u32)
        }
        ResizeMode::Exact => (w.unwrap_or(iw).max(1), h.unwrap_or(ih).max(1)),
    };
    let (tw, th) = (tw.max(1), th.max(1));
    if no_upscale && (tw > iw || th > ih) {
        return img;
    }
    if matches!(mode, ResizeMode::Exact) {
        img.resize_exact(tw, th, FilterType::Lanczos3)
    } else {
        img.resize(tw, th, FilterType::Lanczos3)
    }
}

/// Zone à garder (pixels) : la zone tracée, ramenée au format s'il y en a un, ou le plus grand cadre centré au format.
pub fn crop_box(iw: u32, ih: u32, rect: Option<[f64; 4]>, ratio: Option<f64>) -> Result<(u32, u32, u32, u32), String> {
    let (iwf, ihf) = (iw as f64, ih as f64);
    let (mut x, mut y, mut w, mut h) = match rect {
        Some([rx, ry, rw, rh]) => (rx.clamp(0.0, 1.0) * iwf, ry.clamp(0.0, 1.0) * ihf, rw.clamp(0.0, 1.0) * iwf, rh.clamp(0.0, 1.0) * ihf),
        None if ratio.is_some() => (0.0, 0.0, iwf, ihf),
        None => return Err("Trace une zone ou choisis un format.".into()),
    };
    if let Some(r) = ratio.filter(|r| *r > 0.0) {
        // Plus grand cadre au bon format, centré dans la zone.
        let (nw, nh) = if w / h > r { (h * r, h) } else { (w, w / r) };
        x += (w - nw) / 2.0;
        y += (h - nh) / 2.0;
        w = nw;
        h = nh;
    }
    let (x, y) = (x.round().min(iwf - 1.0) as u32, y.round().min(ihf - 1.0) as u32);
    let (w, h) = ((w.round() as u32).clamp(1, iw - x), (h.round() as u32).clamp(1, ih - y));
    Ok((x, y, w, h))
}

fn process_one(path: &Path, op: &ImageOp, dir: &Path) -> Result<(PathBuf, Option<String>), String> {
    let original = std::fs::read(path).map_err(|e| e.to_string())?;
    let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("image").to_string();
    let in_ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    let mut note = None;

    let (bytes, ext): (Vec<u8>, String) = match op {
        ImageOp::StripMetadata => {
            let (_, fmt, rotated) = open_oriented(path)?;
            let lossless = match fmt {
                Some(ImageFormat::Jpeg) if !rotated => strip_jpeg(&original),
                Some(ImageFormat::Png) => strip_png(&original),
                _ => None,
            };
            match lossless {
                Some(b) => (b, in_ext.clone()),
                None => {
                    // Réencodage : l'orientation est appliquée aux pixels, les métadonnées disparaissent.
                    let (img, fmt, _) = open_oriented(path)?;
                    let f = fmt.and_then(Fmt::from_image).unwrap_or(Fmt::Png);
                    note = Some("réencodée".into());
                    (encode(&img, f, 95)?, f.ext().into())
                }
            }
        }
        ImageOp::Compress { quality } => {
            let (img, fmt, _) = open_oriented(path)?;
            match fmt {
                Some(ImageFormat::Png) => (optimize_png(&original)?, "png".into()),
                Some(ImageFormat::Jpeg) => (encode(&img, Fmt::Jpeg, *quality)?, in_ext.clone()),
                Some(f) => {
                    let f = Fmt::from_image(f).unwrap_or(Fmt::Png);
                    (encode(&img, f, *quality)?, f.ext().into())
                }
                None => return Err("format inconnu".into()),
            }
        }
        ImageOp::Convert { format, quality } => {
            let (img, _, _) = open_oriented(path)?;
            (encode(&img, *format, *quality)?, format.ext().into())
        }
        ImageOp::Resize { mode, percent, width, height, no_upscale } => {
            let (img, fmt, _) = open_oriented(path)?;
            let f = fmt.and_then(Fmt::from_image).unwrap_or(Fmt::Png);
            let out = resize(img, *mode, *percent, *width, *height, *no_upscale);
            (encode(&out, f, 90)?, if f == Fmt::Jpeg && !in_ext.is_empty() { in_ext.clone() } else { f.ext().into() })
        }
        ImageOp::Rotate { degrees, flip_h, flip_v } => {
            let (mut img, fmt, _) = open_oriented(path)?;
            img = match degrees.rem_euclid(360) {
                90 => img.rotate90(),
                180 => img.rotate180(),
                270 => img.rotate270(),
                _ => img,
            };
            if *flip_h { img = img.fliph(); }
            if *flip_v { img = img.flipv(); }
            let f = fmt.and_then(Fmt::from_image).unwrap_or(Fmt::Png);
            (encode(&img, f, 92)?, if f == Fmt::Jpeg && !in_ext.is_empty() { in_ext.clone() } else { f.ext().into() })
        }
        ImageOp::Crop { rect, ratio } => {
            let (img, fmt, _) = open_oriented(path)?;
            let (x, y, w, h) = crop_box(img.width(), img.height(), *rect, *ratio)?;
            let f = fmt.and_then(Fmt::from_image).unwrap_or(Fmt::Png);
            (encode(&img.crop_imm(x, y, w, h), f, 92)?, if f == Fmt::Jpeg && !in_ext.is_empty() { in_ext.clone() } else { f.ext().into() })
        }
    };

    // Compression : ne jamais livrer un fichier plus gros que l'original.
    let bytes = if matches!(op, ImageOp::Compress { .. }) && bytes.len() >= original.len() {
        note = Some("déjà optimisée".into());
        original
    } else {
        bytes
    };
    let out = output::unique_path(dir, &format!("{name}.{ext}"));
    std::fs::write(&out, bytes).map_err(|e| e.to_string())?;
    Ok((out, note))
}

#[tauri::command]
pub fn images_process(app: AppHandle, paths: Vec<String>, op: ImageOp) -> Result<u64, String> {
    let settings = app.state::<SettingsState>().0.lock().unwrap().clone();
    let dir = output::today_dir(&settings).map_err(|e| e.to_string())?;
    Ok(jobs::spawn(&app, "images", move |ctx| {
        let done = AtomicUsize::new(0);
        let total = paths.len();
        let results: Vec<FileResult> = paths
            .par_iter()
            .map(|p| {
                let path = Path::new(p);
                let name = path.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                let before = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
                let r = if ctx.is_cancelled() { Err("annulé".into()) } else { process_one(path, &op, &dir) };
                let n = done.fetch_add(1, Ordering::Relaxed) + 1;
                ctx.progress(Some(n as f64 / total.max(1) as f64), format!("{n} / {total} · {name}"));
                match r {
                    Ok((out, note)) => FileResult {
                        after: std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0),
                        output: Some(out.display().to_string()),
                        name, before, error: None, note,
                    },
                    Err(e) => FileResult { name, output: None, before, after: 0, error: Some(e), note: None },
                }
            })
            .collect();
        ctx.check()?;
        Ok(json!({ "dir": dir.display().to_string(), "files": results }))
    }))
}

/// Dimensions et format, pour l'aperçu avant traitement.
#[tauri::command]
pub fn image_info(path: String) -> Result<serde_json::Value, String> {
    let reader = ImageReader::open(&path).map_err(|e| e.to_string())?.with_guessed_format().map_err(|e| e.to_string())?;
    let fmt = reader.format().map(|f| format!("{f:?}").to_uppercase());
    let (w, h) = reader.into_dimensions().map_err(|e| e.to_string())?;
    Ok(json!({ "width": w, "height": h, "format": fmt }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_jpeg() -> Vec<u8> {
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(8, 8, image::Rgb([200, 10, 10])));
        let jpg = encode(&img, Fmt::Jpeg, 90).unwrap();
        // Insère un faux segment EXIF (APP1) et un commentaire après SOI.
        let mut out = vec![0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x08, b'E', b'x', b'i', b'f', 0, 0, 0xFF, 0xFE, 0x00, 0x04, b'h', b'i'];
        out.extend_from_slice(&jpg[2..]);
        out
    }

    #[test]
    fn strips_jpeg_segments() {
        let src = sample_jpeg();
        let out = strip_jpeg(&src).unwrap();
        assert!(out.len() < src.len());
        assert!(!out.windows(4).any(|w| w == b"Exif"));
        image::load_from_memory(&out).expect("JPEG toujours lisible");
    }

    #[test]
    fn strips_png_text() {
        let img = DynamicImage::ImageRgb8(image::RgbImage::new(4, 4));
        let mut png = Vec::new();
        img.write_to(&mut Cursor::new(&mut png), ImageFormat::Png).unwrap();
        // Ajoute un bloc tEXt juste après IHDR (8 + 25 octets).
        let text = b"tEXtAuthor\0moi";
        let mut chunk = (text.len() as u32 - 4).to_be_bytes().to_vec();
        chunk.extend_from_slice(text);
        chunk.extend_from_slice(&[0, 0, 0, 0]);
        let mut with = png[..33].to_vec();
        with.extend_from_slice(&chunk);
        with.extend_from_slice(&png[33..]);
        assert_eq!(strip_png(&with).unwrap(), png);
    }

    #[test]
    fn crop_boxes() {
        assert_eq!(crop_box(400, 200, None, Some(1.0)).unwrap(), (100, 0, 200, 200));
        assert_eq!(crop_box(400, 200, Some([0.5, 0.5, 0.5, 0.5]), None).unwrap(), (200, 100, 200, 100));
        assert_eq!(crop_box(400, 200, Some([0.0, 0.0, 1.0, 1.0]), Some(16.0 / 9.0)).unwrap(), (22, 0, 356, 200));
        assert_eq!(crop_box(100, 100, Some([0.9, 0.9, 0.5, 0.5]), None).unwrap(), (90, 90, 10, 10));
        assert!(crop_box(100, 100, None, None).is_err());
    }

    #[test]
    fn resize_modes() {
        let img = DynamicImage::ImageRgb8(image::RgbImage::new(400, 200));
        assert_eq!(resize(img.clone(), ResizeMode::Percent, Some(50), None, None, false).width(), 200);
        let l = resize(img.clone(), ResizeMode::Longest, None, Some(100), None, false);
        assert_eq!((l.width(), l.height()), (100, 50));
        assert_eq!(resize(img.clone(), ResizeMode::Longest, None, Some(1000), None, true).width(), 400);
        let e = resize(img, ResizeMode::Exact, None, Some(10), Some(10), false);
        assert_eq!((e.width(), e.height()), (10, 10));
    }
}
