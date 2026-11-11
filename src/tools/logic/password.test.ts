import { describe, expect, it } from "vitest";
import { cryptoInt, password, passwordBits, passphrase, passphraseBits, strength, WORDS } from "./password";

describe("mots de passe", () => {
  it("respecte longueur et familles", () => {
    for (let i = 0; i < 200; i++) {
      const p = password({ length: 8, sets: ["lower", "upper", "digits", "symbols"], noAmbiguous: true });
      expect(p).toHaveLength(8);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[0-9]/);
      expect(p).not.toMatch(/[O0oIl1|]/);
    }
  });

  it("refuse sans famille, calcule l'entropie", () => {
    expect(() => password({ length: 10, sets: [], noAmbiguous: false })).toThrow();
    expect(passwordBits({ length: 10, sets: ["digits"], noAmbiguous: false })).toBeCloseTo(33.22, 1);
    expect(strength(100).label).toBe("Très fort");
  });

  it("tirage uniforme", () => {
    const counts = new Array(3).fill(0);
    for (let i = 0; i < 30000; i++) counts[cryptoInt(3)]++;
    counts.forEach((c) => expect(Math.abs(c - 10000)).toBeLessThan(500));
  });

  it("phrases de passe", () => {
    expect(WORDS.length).toBeGreaterThan(350);
    const p = passphrase({ words: 5, separator: "-", capitalize: true, digit: true });
    const parts = p.split("-");
    expect(parts).toHaveLength(5);
    expect(parts.every((w) => /^[A-Z]/.test(w))).toBe(true);
    expect(p).toMatch(/\d/);
    expect(passphraseBits({ words: 6, separator: " ", capitalize: false, digit: false })).toBeGreaterThan(50);
  });
});
