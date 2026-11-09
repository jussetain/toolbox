// Rendu PDF (pdf.js) : vignettes, aperçus, rastérisation.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDoc = pdfjs.PDFDocumentProxy;

export async function openPdf(bytes: Uint8Array, password?: string): Promise<PdfDoc> {
  // pdf.js transfère le tampon au worker : on lui passe une copie.
  return pdfjs.getDocument({ data: bytes.slice(), password }).promise;
}

/** Rend une page dans un canevas, à `scale` (1 = 72 ppp) ou à une largeur cible. */
export async function renderPage(doc: PdfDoc, index: number, opts: { scale?: number; width?: number; canvas?: HTMLCanvasElement }) {
  const page = await doc.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = opts.scale ?? (opts.width ? opts.width / base.width : 1);
  const viewport = page.getViewport({ scale });
  const canvas = opts.canvas ?? document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas;
}

export async function canvasBytes(canvas: HTMLCanvasElement | OffscreenCanvas, type: "image/png" | "image/jpeg", quality = 0.9): Promise<Uint8Array> {
  const blob =
    canvas instanceof HTMLCanvasElement
      ? await new Promise<Blob>((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error("export"))), type, quality))
      : await canvas.convertToBlob({ type, quality });
  return new Uint8Array(await blob.arrayBuffer());
}

/** Réencode un JPEG plus petit (pour la compression PDF). */
export async function recodeJpeg(jpeg: Uint8Array, maxDim: number, quality: number) {
  try {
    const bmp = await createImageBitmap(new Blob([jpeg as BlobPart], { type: "image/jpeg" }));
    const r = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * r));
    const h = Math.max(1, Math.round(bmp.height * r));
    const c = new OffscreenCanvas(w, h);
    c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    return { bytes: await canvasBytes(c, "image/jpeg", quality), width: w, height: h };
  } catch {
    return null;
  }
}
