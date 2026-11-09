// Redressement de perspective (32 Numériser) et filtre « document ».

export type Pt = { x: number; y: number };

/** Homographie qui envoie src[i] sur dst[i] (4 points). Renvoie la matrice 3×3 à plat. */
export function homography(src: Pt[], dst: Pt[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  return [...h, 1];
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) throw new Error("Coins alignés : impossible de redresser.");
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function apply(h: number[], p: Pt): Pt {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Taille de sortie d'un quadrilatère (haut-gauche, haut-droit, bas-droit, bas-gauche). */
export function outputSize(q: Pt[], maxDim: number) {
  let w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
  let h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  const r = Math.min(1, maxDim / Math.max(w, h));
  w = Math.max(1, Math.round(w * r));
  h = Math.max(1, Math.round(h * r));
  return { w, h };
}

/** Redresse `src` (RGBA, sw×sh) selon le quadrilatère `quad` vers une image w×h (échantillonnage bilinéaire). */
export function warp(src: Uint8ClampedArray, sw: number, sh: number, quad: Pt[], w: number, h: number): Uint8ClampedArray {
  const dstRect = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const H = homography(dstRect, quad); // sortie → source
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = apply(H, { x: x + 0.5, y: y + 0.5 });
      const fx = Math.min(Math.max(p.x - 0.5, 0), sw - 1.001);
      const fy = Math.min(Math.max(p.y - 0.5, 0), sh - 1.001);
      const x0 = fx | 0, y0 = fy | 0, dx = fx - x0, dy = fy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        out[o + c] = (src[i00 + c] * (1 - dx) + src[i10 + c] * dx) * (1 - dy) + (src[i01 + c] * (1 - dx) + src[i11 + c] * dx) * dy;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Filtres : gris, ou « document » (gris + niveaux étirés : fond blanc, encre noire). */
export function filter(px: Uint8ClampedArray, mode: "color" | "gray" | "document") {
  if (mode === "color") return;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const g = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    px[i] = px[i + 1] = px[i + 2] = g;
    hist[g]++;
  }
  if (mode === "gray") return;
  const total = px.length / 4;
  const pct = (p: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= total * p) return v;
    return 255;
  };
  const lo = pct(0.05), hi = Math.max(pct(0.6), lo + 1);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.min(255, Math.max(0, ((px[i] - lo) * 255) / (hi - lo)));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
}
