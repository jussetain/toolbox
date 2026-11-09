import { describe, expect, it } from "vitest";
import { apply, filter, homography, outputSize, warp } from "./geometry";

describe("Géométrie", () => {
  it("homographie exacte sur les 4 coins", () => {
    const src = [{ x: 10, y: 20 }, { x: 300, y: 5 }, { x: 320, y: 400 }, { x: 0, y: 380 }];
    const dst = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 150 }, { x: 0, y: 150 }];
    const H = homography(src, dst);
    src.forEach((p, i) => {
      const q = apply(H, p);
      expect(q.x).toBeCloseTo(dst[i].x, 6);
      expect(q.y).toBeCloseTo(dst[i].y, 6);
    });
    expect(() => homography([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }], dst)).toThrow();
  });
  it("redresse un rectangle identique sans déformer", () => {
    const sw = 4, sh = 2;
    const src = new Uint8ClampedArray(sw * sh * 4).map((_, i) => (i % 4 === 3 ? 255 : i * 7 % 255));
    const quad = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }];
    expect(outputSize(quad, 100)).toEqual({ w: 4, h: 2 });
    const out = warp(src, sw, sh, quad, 4, 2);
    expect([...out.slice(0, 8)]).toEqual([...src.slice(0, 8)]);
  });
  it("filtre document : fond blanc", () => {
    const px = new Uint8ClampedArray([200, 200, 200, 255, 190, 190, 190, 255, 30, 30, 30, 255, 205, 205, 205, 255]);
    filter(px, "document");
    expect(px[0]).toBeGreaterThan(240);
    expect(px[8]).toBe(0);
  });
});
