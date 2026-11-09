import { describe, expect, it } from "vitest";
import { applyRules, DEFAULT_RULES, duplicates } from "./rename";

describe("Renommage", () => {
  const files = ["IMG_0001.JPG", "IMG_0002.JPG", "notes.txt"];
  it("remplace, numérote et met en minuscules", () => {
    const r = applyRules(files, { ...DEFAULT_RULES, find: "img_", replace: "vacances-", caseMode: "lower", extension: "lower" });
    expect(r.map((x) => x.name)).toEqual(["vacances-0001.jpg", "vacances-0002.jpg", "notes.txt"]);
    const n = applyRules(files, { ...DEFAULT_RULES, newName: "photo", numbering: true, numberStart: 1, numberPad: 3 });
    expect(n.map((x) => x.name)).toEqual(["photo-001.JPG", "photo-002.JPG", "photo-003.txt"]);
  });
  it("regex avec groupes", () => {
    const r = applyRules(["2024-05-01 rapport.pdf"], { ...DEFAULT_RULES, regex: true, find: "(\\d{4})-(\\d{2})-(\\d{2}) (.*)", replace: "$4 $3.$2.$1" });
    expect(r[0].name).toBe("rapport 01.05.2024.pdf");
  });
  it("signale erreurs et doublons", () => {
    expect(applyRules(["a.txt"], { ...DEFAULT_RULES, suffix: ":" })[0].error).toBeTruthy();
    expect(applyRules(["a.txt"], { ...DEFAULT_RULES, regex: true, find: "(" })[0].error).toBeTruthy();
    expect([...duplicates(["A.txt", "b.txt", "a.TXT"])]).toEqual([2, 0]);
  });
});
