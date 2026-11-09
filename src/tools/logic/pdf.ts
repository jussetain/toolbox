// Opérations PDF pures (pdf-lib) : testables hors navigateur.
import { degrees, PDFDocument, PDFName, PDFRawStream, PDFNumber, type PDFPage } from "@cantoo/pdf-lib";

export type Bytes = Uint8Array;
export interface NamedBytes { name: string; bytes: Bytes }

export const isPdf = (b: Bytes) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
const isPng = (b: Bytes) => b[0] === 0x89 && b[1] === 0x50;
const isJpeg = (b: Bytes) => b[0] === 0xff && b[1] === 0xd8;

export async function load(bytes: Bytes, password?: string) {
  try {
    return await PDFDocument.load(bytes, { password, ignoreEncryption: false, updateMetadata: false });
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (/encrypt|password/i.test(msg)) throw new Error(password ? "Mot de passe incorrect." : "Ce PDF est protégé par un mot de passe.");
    throw new Error("Ce fichier n'est pas un PDF lisible.");
  }
}

export async function pageCount(bytes: Bytes, password?: string) {
  return (await load(bytes, password)).getPageCount();
}

/**
 * Plages de pages « 1-3, 5, 8- » → indices (base 0), dans l'ordre donné, sans doublon.
 * `max` = nombre de pages. Lève une erreur lisible si la syntaxe est fausse.
 */
export function parseRanges(input: string, max: number): number[] {
  const out: number[] = [];
  for (const raw of input.split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
    const m = raw.match(/^(\d*)\s*[-–]\s*(\d*)$/) ?? raw.match(/^(\d+)$/);
    if (!m) throw new Error(`Plage incomprise : « ${raw} »`);
    const a = m[1] ? +m[1] : 1;
    const b = m.length > 2 ? (m[2] ? +m[2] : max) : a;
    if (a < 1 || b > max || a > b) throw new Error(`Pages hors limites : « ${raw} » (le document a ${max} pages)`);
    for (let i = a; i <= b; i++) if (!out.includes(i - 1)) out.push(i - 1);
  }
  return out;
}

/** Copie des pages (dans l'ordre donné, rotation supplémentaire facultative) vers un nouveau PDF. */
export async function selectPages(bytes: Bytes, pages: { index: number; rotate?: number }[], password?: string): Promise<Bytes> {
  const src = await load(bytes, password);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pages.map((p) => p.index));
  copied.forEach((page, i) => {
    const r = pages[i].rotate ?? 0;
    if (r) page.setRotation(degrees((page.getRotation().angle + r + 360) % 360));
    out.addPage(page);
  });
  return out.save({ useObjectStreams: true });
}

async function addImagePage(doc: PDFDocument, img: Bytes, size: "fit" | "a4" | "letter" = "fit", marginPt = 0) {
  const embedded = isPng(img) ? await doc.embedPng(img) : isJpeg(img) ? await doc.embedJpg(img) : null;
  if (!embedded) throw new Error("Image non prise en charge (JPEG ou PNG)");
  const { width, height } = embedded;
  let pw = width, ph = height;
  if (size !== "fit") {
    [pw, ph] = size === "a4" ? [595.28, 841.89] : [612, 792];
    if (width > height) [pw, ph] = [ph, pw];
  }
  const page = doc.addPage([pw, ph]);
  const scale = Math.min((pw - 2 * marginPt) / width, (ph - 2 * marginPt) / height, size === "fit" ? 1 : Infinity);
  const w = width * scale, h = height * scale;
  page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
}

/** Assemble PDF et images (JPEG/PNG) dans l'ordre. */
export async function merge(inputs: NamedBytes[], passwords: Record<string, string> = {}): Promise<Bytes> {
  const out = await PDFDocument.create();
  for (const f of inputs) {
    if (isPdf(f.bytes)) {
      const src = await load(f.bytes, passwords[f.name]);
      for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
    } else {
      await addImagePage(out, f.bytes, "a4", 0);
    }
  }
  return out.save({ useObjectStreams: true });
}

export async function imagesToPdf(images: Bytes[], size: "fit" | "a4" | "letter", marginPt: number): Promise<Bytes> {
  const out = await PDFDocument.create();
  for (const img of images) await addImagePage(out, img, size, marginPt);
  return out.save({ useObjectStreams: true });
}

/** Découpe : une page par fichier, ou une plage par fichier (« 1-3; 4-6 »). */
export async function split(bytes: Bytes, groups: number[][] | "each", password?: string): Promise<{ label: string; bytes: Bytes }[]> {
  const n = await pageCount(bytes, password);
  const sets = groups === "each" ? Array.from({ length: n }, (_, i) => [i]) : groups;
  const res = [];
  for (const g of sets) {
    const label = g.length === 1 ? `p${g[0] + 1}` : `p${g[0] + 1}-${g[g.length - 1] + 1}`;
    res.push({ label, bytes: await selectPages(bytes, g.map((index) => ({ index })), password) });
  }
  return res;
}

/** Rogne chaque page d'un pourcentage par bord (0–45). */
export async function crop(bytes: Bytes, m: { top: number; right: number; bottom: number; left: number }, password?: string): Promise<Bytes> {
  const doc = await load(bytes, password);
  for (const page of doc.getPages()) {
    const box = page.getCropBox();
    const x = box.x + (box.width * m.left) / 100;
    const y = box.y + (box.height * m.bottom) / 100;
    const w = box.width * (1 - (m.left + m.right) / 100);
    const h = box.height * (1 - (m.top + m.bottom) / 100);
    if (w <= 1 || h <= 1) throw new Error("Les marges retirent toute la page.");
    page.setCropBox(x, y, w, h);
    page.setMediaBox(x, y, w, h);
  }
  return doc.save({ useObjectStreams: true });
}

export interface Permissions { printing: boolean; copying: boolean; modifying: boolean }

export async function protect(bytes: Bytes, userPassword: string, ownerPassword: string, perms: Permissions): Promise<Bytes> {
  const doc = await load(bytes);
  doc.encrypt({
    userPassword,
    ownerPassword: ownerPassword || userPassword,
    permissions: {
      printing: perms.printing ? "highResolution" : false,
      copying: perms.copying,
      modifying: perms.modifying,
      annotating: perms.modifying,
      fillingForms: true,
      contentAccessibility: true,
      documentAssembly: perms.modifying,
    },
  });
  return doc.save();
}

export async function unlock(bytes: Bytes, password: string): Promise<Bytes> {
  const doc = await load(bytes, password);
  // Une copie page à page produit un document sans dictionnaire de chiffrement.
  const out = await PDFDocument.create();
  for (const p of await out.copyPages(doc, doc.getPageIndices())) out.addPage(p);
  return out.save({ useObjectStreams: true });
}

// ── Formulaires (34) ────────────────────────────────────────────────────────

export type FieldInfo =
  | { name: string; type: "text"; value: string; multiline: boolean }
  | { name: string; type: "checkbox"; value: boolean }
  | { name: string; type: "choice"; value: string; options: string[] }
  | { name: string; type: "radio"; value: string; options: string[] }
  | { name: string; type: "other" };

export async function listFields(bytes: Bytes, password?: string): Promise<FieldInfo[]> {
  const form = (await load(bytes, password)).getForm();
  return form.getFields().map((f): FieldInfo => {
    const name = f.getName();
    const kind = f.constructor.name;
    try {
      if (kind === "PDFTextField") {
        const t = form.getTextField(name);
        return { name, type: "text", value: t.getText() ?? "", multiline: t.isMultiline() };
      }
      if (kind === "PDFCheckBox") return { name, type: "checkbox", value: form.getCheckBox(name).isChecked() };
      if (kind === "PDFDropdown" || kind === "PDFOptionList") {
        const d = kind === "PDFDropdown" ? form.getDropdown(name) : form.getOptionList(name);
        return { name, type: "choice", value: d.getSelected()[0] ?? "", options: d.getOptions() };
      }
      if (kind === "PDFRadioGroup") {
        const r = form.getRadioGroup(name);
        return { name, type: "radio", value: r.getSelected() ?? "", options: r.getOptions() };
      }
    } catch {
      /* champ exotique : non modifiable ici */
    }
    return { name, type: "other" };
  });
}

export async function fillForm(bytes: Bytes, values: Record<string, string | boolean>, flatten: boolean, password?: string): Promise<Bytes> {
  const doc = await load(bytes, password);
  const form = doc.getForm();
  for (const f of await listFields(bytes, password)) {
    if (!(f.name in values)) continue;
    const v = values[f.name];
    if (f.type === "text") form.getTextField(f.name).setText(String(v));
    if (f.type === "checkbox") v ? form.getCheckBox(f.name).check() : form.getCheckBox(f.name).uncheck();
    if (f.type === "choice" && v) {
      try { form.getDropdown(f.name).select(String(v)); } catch { form.getOptionList(f.name).select(String(v)); }
    }
    if (f.type === "radio" && v) form.getRadioGroup(f.name).select(String(v));
  }
  if (flatten) form.flatten();
  return doc.save({ useObjectStreams: true });
}

// ── Images posées sur une page (37 signature, 33 caviardage) ────────────────

export interface Placement { page: number; x: number; y: number; width: number; height: number }

/** Pose une image PNG/JPEG ; coordonnées en fraction de la page (0–1, origine en haut à gauche). */
export async function stampImage(bytes: Bytes, image: Bytes, places: Placement[], password?: string): Promise<Bytes> {
  const doc = await load(bytes, password);
  const img = isPng(image) ? await doc.embedPng(image) : await doc.embedJpg(image);
  for (const p of places) {
    const page = doc.getPage(p.page);
    const { x, y, width, height } = toPdfRect(page, p);
    page.drawImage(img, { x, y, width, height });
  }
  return doc.save({ useObjectStreams: true });
}

/** Fraction de page (vue à l'écran, rotation comprise) → rectangle PDF. */
export function toPdfRect(page: PDFPage, p: { x: number; y: number; width: number; height: number }) {
  const box = page.getCropBox();
  const rot = page.getRotation().angle % 360;
  // Seules les rotations 0 et 180 conservent l'orientation de l'image ; 90/270 sont rares pour des formulaires.
  if (rot === 180) {
    return { x: box.x + (1 - p.x - p.width) * box.width, y: box.y + p.y * box.height, width: p.width * box.width, height: p.height * box.height };
  }
  return { x: box.x + p.x * box.width, y: box.y + (1 - p.y - p.height) * box.height, width: p.width * box.width, height: p.height * box.height };
}

/** Remplace des pages par des images (caviardage réel : le contenu d'origine de ces pages disparaît). */
export async function replacePagesWithImages(bytes: Bytes, replacements: Map<number, Bytes>, password?: string): Promise<Bytes> {
  const src = await load(bytes, password);
  const out = await PDFDocument.create();
  for (let i = 0; i < src.getPageCount(); i++) {
    const img = replacements.get(i);
    if (!img) {
      const [p] = await out.copyPages(src, [i]);
      out.addPage(p);
      continue;
    }
    const orig = src.getPage(i);
    const box = orig.getCropBox();
    const rot = orig.getRotation().angle % 180 !== 0;
    const [w, h] = rot ? [box.height, box.width] : [box.width, box.height];
    const page = out.addPage([w, h]);
    const e = isPng(img) ? await out.embedPng(img) : await out.embedJpg(img);
    page.drawImage(e, { x: 0, y: 0, width: w, height: h });
  }
  return out.save({ useObjectStreams: true });
}

// ── Compression (45) ────────────────────────────────────────────────────────

export type JpegRecoder = (jpeg: Bytes, maxDim: number, quality: number) => Promise<{ bytes: Bytes; width: number; height: number } | null>;

/** Réencode les photos (JPEG) du PDF plus petites ; le reste est réécrit en flux d'objets compacts. */
export async function compress(bytes: Bytes, recode: JpegRecoder, maxDim: number, quality: number, password?: string) {
  const doc = await load(bytes, password);
  let replaced = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (d.get(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
    if (d.get(PDFName.of("Filter"))?.toString() !== "/DCTDecode") continue;
    const cs = d.get(PDFName.of("ColorSpace"))?.toString();
    if (cs !== "/DeviceRGB" && cs !== "/DeviceGray") continue; // CMYK, ICC… : on n'y touche pas
    if (obj.contents.length < 40 * 1024) continue;
    const r = await recode(obj.contents, maxDim, quality);
    if (!r || r.bytes.length >= obj.contents.length * 0.9) continue;
    (obj as unknown as { contents: Bytes }).contents = r.bytes;
    d.set(PDFName.of("Width"), PDFNumber.of(r.width));
    d.set(PDFName.of("Height"), PDFNumber.of(r.height));
    d.set(PDFName.of("Length"), PDFNumber.of(r.bytes.length));
    d.set(PDFName.of("ColorSpace"), PDFName.of(cs === "/DeviceGray" ? "DeviceGray" : "DeviceRGB"));
    d.delete(PDFName.of("DecodeParms"));
    replaced++;
  }
  const out = await doc.save({ useObjectStreams: true });
  return { bytes: out.length < bytes.length ? out : bytes, replaced, smaller: out.length < bytes.length };
}

// ── Calque texte invisible (35 Rendre cherchable) ───────────────────────────

export interface OcrWord { text: string; x: number; y: number; w: number; h: number }

/** Ajoute le texte reconnu, invisible mais sélectionnable, au-dessus de chaque page. Coordonnées en pixels de l'image OCR. */
export async function addTextLayer(bytes: Bytes, pages: { words: OcrWord[]; width: number; height: number }[], password?: string): Promise<Bytes> {
  const { StandardFonts } = await import("@cantoo/pdf-lib");
  const doc = await load(bytes, password);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.getPages().forEach((page, i) => {
    const ocr = pages[i];
    if (!ocr?.words.length) return;
    const box = page.getCropBox();
    const sx = box.width / ocr.width, sy = box.height / ocr.height;
    for (const w of ocr.words) {
      // Helvetica standard ne couvre que WinAnsi : les autres caractères sont remplacés.
      const text = [...w.text].map((ch) => { try { font.encodeText(ch); return ch; } catch { return "?"; } }).join("");
      if (!text.trim()) continue;
      const width = w.w * sx;
      const unit = font.widthOfTextAtSize(text, 1) || 1;
      const size = Math.max(1, Math.min(width / unit, w.h * sy * 1.2));
      page.drawText(text, { x: box.x + w.x * sx, y: box.y + box.height - (w.y + w.h) * sy + w.h * sy * 0.15, size, font, opacity: 0 });
    }
  });
  return doc.save({ useObjectStreams: true });
}
