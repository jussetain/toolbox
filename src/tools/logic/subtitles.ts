// Sous-titres : mots horodatés, découpage en lignes, style, export ASS / SRT. Logique pure (testée).

export interface Word { text: string; start: number; end: number }
export interface Cue { start: number; end: number; words: Word[] }

const WORD_SPLIT = /\s+/;

// ── Sources ──────────────────────────────────────────────────────────────────

interface WhisperToken { text: string; offsets?: { from: number; to: number } }
interface WhisperSegment { text: string; offsets: { from: number; to: number }; tokens?: WhisperToken[] }

/**
 * Mots horodatés depuis la sortie JSON complète de whisper.cpp (`-ojf`).
 * Le texte vient du segment (UTF-8 sûr : un jeton peut couper un caractère accentué en deux),
 * les temps viennent des jetons regroupés par mot. Si les deux ne s'alignent pas, temps répartis
 * au prorata des caractères dans le segment.
 */
export function wordsFromWhisper(json: { transcription?: WhisperSegment[] }): Word[] {
  const out: Word[] = [];
  for (const seg of json.transcription ?? []) {
    const texts = seg.text.trim().split(WORD_SPLIT).filter(Boolean);
    if (!texts.length) continue;
    const s0 = seg.offsets.from / 1000, s1 = seg.offsets.to / 1000;
    const groups: { start: number; end: number }[] = [];
    for (const t of seg.tokens ?? []) {
      if (!t.offsets || /^\[_|^\[/.test(t.text.trim()) || !t.text.trim()) continue;
      const a = t.offsets.from / 1000, b = t.offsets.to / 1000;
      if (/^\s/.test(t.text) || !groups.length) groups.push({ start: a, end: b });
      else groups[groups.length - 1].end = b;
    }
    if (groups.length === texts.length) {
      texts.forEach((text, i) => out.push({ text, start: Math.max(s0, groups[i].start), end: Math.max(groups[i].start, Math.min(s1, groups[i].end)) }));
    } else out.push(...spread(texts, s0, s1));
  }
  return fixOrder(out);
}

/** Répartit des mots sur un intervalle, au prorata de leur longueur. */
export function spread(texts: string[], start: number, end: number): Word[] {
  const weights = texts.map((t) => t.length + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let t = start;
  return texts.map((text, i) => {
    const d = ((end - start) * weights[i]) / total;
    const w = { text, start: t, end: t + d };
    t += d;
    return w;
  });
}

const srtTime = (s: string) => {
  const m = s.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 10 ** m[4].length : NaN;
};

/** Mots depuis un SRT ou un VTT (temps des mots estimés à l'intérieur de chaque bloc). */
export function wordsFromSrt(srt: string): Word[] {
  const out: Word[] = [];
  for (const block of srt.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const t = lines.findIndex((l) => l.includes("-->"));
    if (t < 0) continue;
    const [a, b] = lines[t].split("-->").map(srtTime);
    const text = lines.slice(t + 1).join(" ").replace(/<[^>]+>/g, "").replace(/\{[^}]*\}/g, "");
    const words = text.split(WORD_SPLIT).filter(Boolean);
    if (words.length && !isNaN(a) && !isNaN(b)) out.push(...spread(words, a, b));
  }
  return fixOrder(out);
}

function fixOrder(words: Word[]): Word[] {
  words.sort((a, b) => a.start - b.start);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.end <= w.start) w.end = w.start + 0.05;
    if (i + 1 < words.length && w.end > words[i + 1].start) w.end = Math.max(w.start + 0.05, words[i + 1].start);
  }
  return words;
}

// ── Découpage ────────────────────────────────────────────────────────────────

export interface Split {
  /** Nombre de mots maximum par sous-titre (0 = phrases complètes). */
  maxWords: number;
  /** Caractères maximum par sous-titre (sécurité pour les longues phrases). */
  maxChars: number;
}

const ENDS_SENTENCE = /[.!?…]["»)]*$/;
const ENDS_CLAUSE = /[,;:]["»)]*$/;

/** Regroupe les mots en sous-titres. Coupe toujours en fin de phrase et sur un silence. */
export function group(words: Word[], { maxWords, maxChars }: Split): Cue[] {
  const cues: Cue[] = [];
  let cur: Word[] = [];
  const len = (ws: Word[]) => ws.reduce((n, w) => n + w.text.length + 1, -1);
  const flush = () => {
    if (cur.length) cues.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = cur[cur.length - 1];
    const silence = prev ? w.start - prev.end : 0;
    if (cur.length && (silence > (maxWords ? 0.6 : 1.0) || (maxWords && cur.length >= maxWords) || len([...cur, w]) > maxChars)) flush();
    cur.push(w);
    // Phrases : coupe à la ponctuation forte, ou à la virgule quand la ligne est déjà longue.
    if (ENDS_SENTENCE.test(w.text) || (!maxWords && ENDS_CLAUSE.test(w.text) && len(cur) > maxChars * 0.6)) flush();
  }
  flush();
  // Enchaînement sans clignotement : un sous-titre reste affiché jusqu'au suivant si l'écart est court.
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1];
    const hold = Math.max(cues[i].end, cues[i].start + 0.25);
    cues[i].end = next && next.start - hold < 0.4 ? next.start : hold;
  }
  return cues;
}

export const cueText = (c: Cue, upper = false) => {
  const t = c.words.map((w) => w.text).join(" ");
  return upper ? t.toLocaleUpperCase("fr-FR") : t;
};

// ── Style ────────────────────────────────────────────────────────────────────

export interface SubStyle {
  font: string;
  /** Taille du texte en % de la hauteur de la vidéo. */
  size: number;
  bold: boolean;
  upper: boolean;
  color: string;
  outlineColor: string;
  /** Épaisseur du contour en % de la taille du texte. */
  outline: number;
  /** Bandeau derrière le texte (au lieu du contour). */
  box: boolean;
  boxColor: string;
  boxOpacity: number;
  position: "bottom" | "middle" | "top";
  /** Marge depuis le bord, en % de la hauteur. */
  margin: number;
  /** Couleur du mot prononcé (null = pas de surlignage). */
  highlight: string | null;
  /** Décalage en secondes (positif = sous-titres plus tard). */
  offset: number;
}

export const DEFAULT_STYLE: SubStyle = {
  font: "Arial", size: 5, bold: true, upper: false, color: "#FFFFFF", outlineColor: "#000000", outline: 12,
  box: false, boxColor: "#000000", boxOpacity: 60, position: "bottom", margin: 8, highlight: null, offset: 0,
};

/** Préréglages prêts à l'emploi. */
export const PRESETS: { id: string; label: string; split: Split; style: Partial<SubStyle> }[] = [
  { id: "classic", label: "Classique", split: { maxWords: 0, maxChars: 84 }, style: { font: "Arial", size: 5, bold: true, upper: false, highlight: null, box: false, position: "bottom", margin: 8 } },
  { id: "short", label: "Réseaux (2–3 mots)", split: { maxWords: 3, maxChars: 24 }, style: { font: "Arial Black", size: 7.5, bold: true, upper: true, highlight: "#FFD400", box: false, outline: 14, position: "middle", margin: 0 } },
  { id: "word", label: "Mot à mot", split: { maxWords: 1, maxChars: 20 }, style: { font: "Impact", size: 10, bold: false, upper: true, highlight: null, box: false, outline: 10, position: "middle", margin: 0 } },
  { id: "box", label: "Bandeau", split: { maxWords: 0, maxChars: 60 }, style: { font: "Segoe UI", size: 4.5, bold: true, upper: false, highlight: null, box: true, boxOpacity: 65, position: "bottom", margin: 6 } },
];

/** #RRGGBB + opacité (0–100) → &HAABBGGRR (ASS : alpha inversé). */
export function assColor(hex: string, opacity = 100): string {
  const h = hex.replace("#", "").padEnd(6, "0");
  const a = Math.round(255 * (1 - opacity / 100)).toString(16).padStart(2, "0");
  return `&H${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

const assTime = (s: number) => {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, sec = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
const assEscape = (t: string) => t.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, "\\N");

/** Taille de police ASS (pixels de la vidéo). */
export const fontPx = (style: SubStyle, height: number) => Math.max(8, Math.round((height * style.size) / 100));

/** Fichier ASS complet : le style et le découpage choisis, prêts à incruster par FFmpeg. */
export function toAss(cues: Cue[], style: SubStyle, width: number, height: number): string {
  const fs = fontPx(style, height);
  const align = { bottom: 2, middle: 5, top: 8 }[style.position];
  const marginV = style.position === "middle" ? 0 : Math.round((height * style.margin) / 100);
  const outline = style.box ? Math.max(2, Math.round(fs * 0.25)) : Math.round((fs * style.outline) / 100);
  const back = style.box ? assColor(style.boxColor, style.boxOpacity) : assColor("#000000", 0);
  const outlineColour = style.box ? back : assColor(style.outlineColor);
  const marginH = Math.round(width * 0.05);
  const head = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${style.font.replace(/,/g, " ")},${fs},${assColor(style.color)},${assColor(style.color)},${outlineColour},${back},${style.bold ? -1 : 0},0,0,0,100,100,0,0,${style.box ? 3 : 1},${outline},0,${align},${marginH},${marginH},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const lines: string[] = [];
  const at = (t: number) => assTime(t + style.offset);
  const up = (t: string) => (style.upper ? t.toLocaleUpperCase("fr-FR") : t);
  for (const c of cues) {
    if (c.end + style.offset <= 0) continue;
    if (!style.highlight || c.words.length < 2) {
      lines.push(`Dialogue: 0,${at(c.start)},${at(c.end)},Default,,0,0,0,,${assEscape(up(cueText(c)))}`);
      continue;
    }
    // Surlignage : un événement par mot, le mot prononcé change de couleur.
    const hl = assColor(style.highlight);
    c.words.forEach((w, i) => {
      const from = i === 0 ? c.start : w.start;
      const to = i === c.words.length - 1 ? c.end : c.words[i + 1].start;
      if (to <= from) return;
      const text = c.words.map((x, j) => (j === i ? `{\\c${hl}}${assEscape(up(x.text))}{\\c${assColor(style.color)}}` : assEscape(up(x.text)))).join(" ");
      lines.push(`Dialogue: 0,${at(from)},${at(to)},Default,,0,0,0,,${text}`);
    });
  }
  return [...head, ...lines].join("\n") + "\n";
}

const srtStamp = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

/** SRT du découpage choisi (sans style), pour YouTube ou un lecteur. */
export const toSrt = (cues: Cue[], style: Pick<SubStyle, "offset" | "upper">) =>
  cues.map((c, i) => `${i + 1}\n${srtStamp(c.start + style.offset)} --> ${srtStamp(c.end + style.offset)}\n${cueText(c, style.upper)}`).join("\n\n") + "\n";

/** Sous-titre et mot actifs à l'instant `t` (aperçu). */
export function activeAt(cues: Cue[], t: number): { cue: Cue; word: number } | null {
  const cue = cues.find((c) => t >= c.start && t < c.end);
  if (!cue) return null;
  let word = 0;
  cue.words.forEach((w, i) => { if (t >= w.start) word = i; });
  return { cue, word };
}
