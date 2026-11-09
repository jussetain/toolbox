import { invoke } from "@tauri-apps/api/core";

/** Lit un fichier local en binaire. */
export const readFileBytes = (path: string) => invoke<ArrayBuffer>("read_file_bytes", { path });

/** Enregistre des octets dans le dossier de sortie du jour ; renvoie le chemin final. */
export const saveOutput = (name: string, bytes: Uint8Array | ArrayBuffer) =>
  invoke<string>("save_output", bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes, {
    headers: { "x-name": encodeURIComponent(name) },
  });

export const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;
export const stem = (p: string) => basename(p).replace(/\.[^.]+$/, "");

export async function loadImage(path: string): Promise<ImageBitmap> {
  const bytes = await readFileBytes(path);
  try {
    return await createImageBitmap(new Blob([bytes]));
  } catch {
    throw new Error("Format d'image non pris en charge ici (HEIC : convertis-la d'abord).");
  }
}

export async function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error("export impossible"))), "image/png"));
}

export async function copyPngToClipboard(blob: Blob) {
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

/** Récupère une image collée (Ctrl+V), par exemple une capture d'écran. */
export async function imageFromPaste(e: ClipboardEvent): Promise<ImageBitmap | null> {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
  const file = item?.getAsFile();
  return file ? createImageBitmap(file) : null;
}

/** Enregistre des octets dans un dossier temporaire (fichier intermédiaire). */
export const saveTemp = (name: string, bytes: Uint8Array) =>
  invoke<string>("save_temp", bytes, { headers: { "x-name": encodeURIComponent(name) } });
