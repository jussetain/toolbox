import { lazy, type ComponentType, type LazyExoticComponent } from "react";

type Mod = Record<string, ComponentType>;

/** Chaque groupe d'outils est chargé à la première ouverture (le lanceur reste léger). */
const from = (load: () => Promise<Mod>, name: string) => lazy(() => load().then((m) => ({ default: m[name] })));

const text = () => import("./TextTools") as unknown as Promise<Mod>;
const dev = () => import("./DevTools") as unknown as Promise<Mod>;
const dev2 = () => import("./DevTools2") as unknown as Promise<Mod>;
const canvas = () => import("./CanvasTools") as unknown as Promise<Mod>;
const images = () => import("./ImageTools") as unknown as Promise<Mod>;
const files = () => import("./FileTools") as unknown as Promise<Mod>;
const pdf = () => import("./PdfTools") as unknown as Promise<Mod>;
const pdf2 = () => import("./PdfTools2") as unknown as Promise<Mod>;
const media = () => import("./MediaTools") as unknown as Promise<Mod>;
const rec = () => import("./Recorders") as unknown as Promise<Mod>;
const docs = () => import("./DocConvert") as unknown as Promise<Mod>;
const sys = () => import("./SystemTools") as unknown as Promise<Mod>;
const ai = () => import("./AiTools") as unknown as Promise<Mod>;
const imgai = () => import("./ImageAi") as unknown as Promise<Mod>;
const subs = () => import("./Subtitles") as unknown as Promise<Mod>;
const added = () => import("./AddedTools") as unknown as Promise<Mod>;
const monitor = () => import("./SystemMonitor") as unknown as Promise<Mod>;
const hash = () => import("./HashGenerator").then((m) => ({ HashGenerator: m.default }));

/** Outils implémentés, par identifiant du registre. Les autres affichent « Bientôt ». */
export const implementations: Record<string, LazyExoticComponent<ComponentType>> = {
  // Vidéo
  "download-video": from(media, "DownloadVideo"),
  "burn-subtitles": from(subs, "BurnSubtitles"),
  "change-speed": from(media, "ChangeSpeed"),
  "extract-frames": from(media, "ExtractFrames"),
  "record-screen": from(rec, "RecordScreen"),
  "compress-video": from(media, "CompressVideo"),
  "convert-video": from(media, "ConvertVideo"),
  "resize-video": from(media, "ResizeVideo"),
  "crop-rotate-video": from(media, "CropRotateVideo"),
  "media-info": from(media, "MediaInfo"),
  "trim-video": from(media, "TrimVideo"),
  "merge-videos": from(media, "MergeVideos"),
  "mute-video": from(media, "MuteVideo"),
  "replace-audio": from(media, "ReplaceAudio"),
  "video-to-gif": from(media, "VideoToGif"),
  // Audio
  "clean-audio": from(media, "CleanAudio"),
  "record-audio": from(rec, "RecordAudio"),
  "trim-audio": from(media, "TrimAudio"),
  "extract-audio": from(media, "ExtractAudio"),
  "convert-audio": from(media, "ConvertAudio"),
  "normalize-audio": from(media, "NormalizeAudio"),
  // Images
  screenshot: from(added, "Screenshot"),
  "crop-images": from(added, "CropImages"),
  "blur-faces": from(imgai, "BlurFaces"),
  "remove-background": from(imgai, "RemoveBackground"),
  "color-picker": from(imgai, "ColorPicker"),
  "beautify-screenshot": from(canvas, "BeautifyScreenshot"),
  "convert-images": from(images, "ConvertImages"),
  "compress-images": from(images, "CompressImages"),
  "resize-images": from(images, "ResizeImages"),
  "rotate-images": from(images, "RotateImages"),
  "remove-metadata": from(images, "RemoveMetadata"),
  "redact-image": from(canvas, "RedactImage"),
  "annotate-screenshot": from(canvas, "AnnotateScreenshot"),
  // Documents
  "scan-document": from(pdf2, "ScanDocument"),
  "redact-pdf": from(pdf2, "RedactPdf"),
  "fill-forms": from(pdf, "FillForms"),
  "pdf-to-word": from(pdf2, "PdfToWord"),
  "ocr-pdf": from(ai, "OcrPdf"),
  "sign-pdf": from(pdf2, "SignPdf"),
  "merge-pdfs": from(pdf, "MergePdfs"),
  "split-pdf": from(pdf, "SplitPdf"),
  "organize-pdf": from(pdf, "OrganizePdf"),
  "delete-pages": from(pdf, "DeletePages"),
  "extract-pages": from(pdf, "ExtractPages"),
  "images-to-pdf": from(pdf, "ImagesToPdf"),
  "stamp-pdf": from(added, "StampPdf"),
  "crop-pdf": from(pdf, "CropPdf"),
  "compress-pdf": from(pdf, "CompressPdf"),
  "add-password": from(pdf, "AddPassword"),
  "remove-password": from(pdf, "RemovePassword"),
  "pdf-to-images": from(pdf, "PdfToImages"),
  "convert-documents": from(docs, "ConvertDocuments"),
  "word-to-pdf": from(docs, "WordToPdf"),
  "powerpoint-to-pdf": from(docs, "PowerPointToPdf"),
  "excel-to-pdf": from(docs, "ExcelToPdf"),
  "webpage-to-pdf": from(docs, "WebpageToPdf"),
  "markdown-to-pdf": from(docs, "MarkdownToPdf"),
  // Texte
  transcribe: from(ai, "Transcribe"),
  summarize: from(ai, "Summarize"),
  "extract-text": from(ai, "ExtractText"),
  "capture-text": from(ai, "CaptureText"),
  translate: from(ai, "Translate"),
  "text-to-speech": from(ai, "TextToSpeech"),
  "ask-document": from(ai, "AskDocument"),
  "word-counter": from(text, "WordCounter"),
  "case-converter": from(text, "CaseConverter"),
  // Fichiers
  "qr-code": from(files, "QrCodeTool"),
  "batch-rename": from(files, "BatchRename"),
  "find-duplicates": from(files, "FindDuplicates"),
  "zip-unzip": from(files, "ZipUnzip"),
  "organize-downloads": from(files, "OrganizeDownloads"),
  // Système
  "system-monitor": from(monitor, "SystemMonitor"),
  "speed-test": from(sys, "SpeedTest"),
  "storage-explorer": from(sys, "StorageExplorer"),
  "wifi-password": from(sys, "WifiPassword"),
  "battery-health": from(sys, "BatteryHealth"),
  "keep-awake": from(sys, "KeepAwake"),
  "uninstall-app": from(sys, "UninstallApp"),
  "presentation-mode": from(sys, "PresentationMode"),
  "clean-keyboard": from(sys, "CleanKeyboard"),
  "dead-pixel-test": from(sys, "DeadPixelTest"),
  "eject-all": from(sys, "EjectAll"),
  "startup-items": from(sys, "StartupItems"),
  "unblock-file": from(sys, "UnblockFile"),
  "reset-permissions": from(sys, "ResetPermissions"),
  "hidden-settings": from(sys, "HiddenSettings"),
  "display-control": from(sys, "DisplayControl"),
  "mouse-fixes": from(sys, "MouseFixes"),
  // Développeur
  "json-formatter": from(dev, "JsonFormatter"),
  base64: from(dev, "Base64Tool"),
  "hash-generator": from(hash, "HashGenerator"),
  "password-generator": from(added, "PasswordGenerator"),
  "uuid-generator": from(dev, "UuidGenerator"),
  "jwt-decoder": from(dev, "JwtDecoder"),
  "timestamp-converter": from(dev, "TimestampConverter"),
  "diff-checker": from(dev2, "DiffChecker"),
  "regex-tester": from(dev2, "RegexTester"),
  "clean-links": from(dev2, "CleanLinks"),
  "coordinate-picker": from(dev2, "CoordinatePicker"),
  "unicode-inspector": from(dev2, "UnicodeInspector"),
  "lorem-ipsum": from(text, "LoremIpsum"),
};

export const isImplemented = (id: string) => id in implementations;
