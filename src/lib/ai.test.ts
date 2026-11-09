import { describe, expect, it } from "vitest";
import { chunkText, formatSrt, parseSrt, rankPassages } from "./ai";

describe("IA (utilitaires)", () => {
  it("découpe en morceaux", () => {
    const t = ["a".repeat(50), "b".repeat(50), "c".repeat(50)].join("\n\n");
    expect(chunkText(t, 110).length).toBe(2);
    expect(chunkText("x".repeat(250), 100).length).toBe(3);
  });
  it("classe les passages", () => {
    const p = [
      { text: "Le contrat prend fin le 31 décembre.", page: 1 },
      { text: "La facturation est mensuelle, payable à 30 jours.", page: 2 },
      { text: "Les pénalités de retard sont de 10 %.", page: 3 },
    ];
    expect(rankPassages(p, "Quand la facture est-elle payable ?", 1)[0].page).toBe(2);
    expect(rankPassages(p, "pénalités retard ?", 1)[0].page).toBe(3);
  });
  it("SRT aller-retour", () => {
    const s = "1\n00:00:01,000 --> 00:00:02,000\nBonjour\n\n2\n00:00:03,000 --> 00:00:04,500\nÇa va ?\nOui\n";
    const b = parseSrt(s);
    expect(b.length).toBe(2);
    expect(b[1].text).toBe("Ça va ?\nOui");
    expect(formatSrt(b)).toBe(s);
  });
});
