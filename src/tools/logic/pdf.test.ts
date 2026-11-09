import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { crop, fillForm, listFields, merge, pageCount, parseRanges, protect, selectPages, split, unlock } from "./pdf";

async function makePdf(pages: number, withForm = false) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) doc.addPage([200, 300]).drawText(`Page ${i + 1}`, { x: 20, y: 250, font, size: 12 });
  if (withForm) {
    const f = doc.getForm();
    f.createTextField("nom").addToPage(doc.getPage(0), { x: 10, y: 10, width: 100, height: 20 });
    f.createCheckBox("ok").addToPage(doc.getPage(0), { x: 120, y: 10, width: 15, height: 15 });
  }
  return doc.save();
}

describe("PDF", () => {
  it("plages de pages", () => {
    expect(parseRanges("1-3, 5, 8-", 9)).toEqual([0, 1, 2, 4, 7, 8]);
    expect(parseRanges("-2", 5)).toEqual([0, 1]);
    expect(() => parseRanges("4-2", 5)).toThrow();
    expect(() => parseRanges("7", 5)).toThrow(/hors limites/);
    expect(() => parseRanges("a", 5)).toThrow(/incomprise/);
  });

  it("fusionne, sélectionne, découpe", async () => {
    const a = await makePdf(2), b = await makePdf(3);
    const m = await merge([{ name: "a", bytes: a }, { name: "b", bytes: b }]);
    expect(await pageCount(m)).toBe(5);
    const s = await selectPages(m, [{ index: 4 }, { index: 0, rotate: 90 }]);
    const doc = await PDFDocument.load(s);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(1).getRotation().angle).toBe(90);
    expect((await split(m, "each")).length).toBe(5);
    const g = await split(m, [[0, 1], [2, 3, 4]]);
    expect(g.map((x) => x.label)).toEqual(["p1-2", "p3-5"]);
  });

  it("rogne", async () => {
    const c = await PDFDocument.load(await crop(await makePdf(1), { top: 10, right: 0, bottom: 10, left: 25 }));
    const box = c.getPage(0).getCropBox();
    expect(box.width).toBeCloseTo(150);
    expect(box.height).toBeCloseTo(240);
  });

  it("chiffre puis déverrouille", async () => {
    const enc = await protect(await makePdf(2), "secret", "", { printing: true, copying: false, modifying: false });
    await expect(pageCount(enc)).rejects.toThrow(/protégé/);
    await expect(pageCount(enc, "mauvais")).rejects.toThrow(/incorrect/);
    const open = await unlock(enc, "secret");
    expect(await pageCount(open)).toBe(2);
  });

  it("remplit et aplatit un formulaire", async () => {
    const src = await makePdf(1, true);
    expect((await listFields(src)).map((f) => f.type)).toEqual(["text", "checkbox"]);
    const filled = await fillForm(src, { nom: "Justin", ok: true }, false);
    const f = await listFields(filled);
    expect(f[0]).toMatchObject({ value: "Justin" });
    expect(f[1]).toMatchObject({ value: true });
    const flat = await fillForm(src, { nom: "Justin" }, true);
    expect(await listFields(flat)).toEqual([]);
  });
});
