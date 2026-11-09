// Compteur de mots (62) et convertisseur de casse (63).

export interface TextStats {
  words: number;
  chars: number;
  charsNoSpaces: number;
  sentences: number;
  paragraphs: number;
  lines: number;
  /** Minutes, à 230 mots/min. */
  readingMinutes: number;
  /** Minutes, à 130 mots/min. */
  speakingMinutes: number;
}

const graphemes = (s: string) => {
  const seg = new Intl.Segmenter("fr", { granularity: "grapheme" });
  let n = 0;
  for (const _ of seg.segment(s)) n++;
  return n;
};

export function textStats(s: string): TextStats {
  const wordSeg = new Intl.Segmenter("fr", { granularity: "word" });
  let words = 0;
  for (const w of wordSeg.segment(s)) if (w.isWordLike) words++;
  const sentences = s.trim() ? (s.match(/[^.!?…]+(?:[.!?…]+|$)/g) ?? []).filter((x) => /\p{L}|\p{N}/u.test(x)).length : 0;
  return {
    words,
    chars: graphemes(s),
    charsNoSpaces: graphemes(s.replace(/\s/g, "")),
    sentences,
    paragraphs: s.split(/\n\s*\n/).filter((p) => p.trim()).length,
    lines: s ? s.split("\n").length : 0,
    readingMinutes: words / 230,
    speakingMinutes: words / 130,
  };
}

export function formatMinutes(m: number): string {
  if (m === 0) return "0 s";
  const total = Math.max(1, Math.round(m * 60));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return min ? `${min} min${sec ? ` ${sec} s` : ""}` : `${sec} s`;
}

/** Découpe un identifiant ou une phrase en mots (gère camelCase, snake_case, kebab-case…). */
export function splitWords(s: string): string[] {
  return s
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const cap = (w: string) => w.charAt(0).toLocaleUpperCase("fr") + w.slice(1).toLocaleLowerCase("fr");

export type CaseId =
  | "upper" | "lower" | "title" | "sentence" | "camel" | "pascal" | "snake" | "kebab" | "constant" | "dot" | "invert";

export const CASES: { id: CaseId; label: string }[] = [
  { id: "upper", label: "MAJUSCULES" },
  { id: "lower", label: "minuscules" },
  { id: "title", label: "Titre En Majuscules" },
  { id: "sentence", label: "Phrase normale" },
  { id: "camel", label: "camelCase" },
  { id: "pascal", label: "PascalCase" },
  { id: "snake", label: "snake_case" },
  { id: "kebab", label: "kebab-case" },
  { id: "constant", label: "CONSTANT_CASE" },
  { id: "dot", label: "dot.case" },
  { id: "invert", label: "iNVERSER" },
];

/** Les casses « identifiant » s'appliquent ligne par ligne. */
export function convertCase(s: string, c: CaseId): string {
  switch (c) {
    case "upper": return s.toLocaleUpperCase("fr");
    case "lower": return s.toLocaleLowerCase("fr");
    case "title": return s.toLocaleLowerCase("fr").replace(/(^|[\s\-'’(«"])(\p{L})/gu, (_, a, b) => a + b.toLocaleUpperCase("fr"));
    case "sentence":
      return s.toLocaleLowerCase("fr").replace(/(^\s*|[.!?…]\s+)(\p{L})/gu, (_, a, b) => a + b.toLocaleUpperCase("fr"));
    case "invert":
      return [...s].map((ch) => (ch === ch.toLocaleUpperCase("fr") ? ch.toLocaleLowerCase("fr") : ch.toLocaleUpperCase("fr"))).join("");
    default:
      return s.split("\n").map((line) => identifierCase(line, c)).join("\n");
  }
}

function identifierCase(line: string, c: CaseId): string {
  const w = splitWords(line);
  if (!w.length) return line;
  const low = w.map((x) => x.toLocaleLowerCase("fr"));
  switch (c) {
    case "camel": return low[0] + w.slice(1).map(cap).join("");
    case "pascal": return w.map(cap).join("");
    case "snake": return low.join("_");
    case "kebab": return low.join("-");
    case "constant": return low.join("_").toLocaleUpperCase("fr");
    case "dot": return low.join(".");
    default: return line;
  }
}

// Lorem ipsum (96)

const LOREM = (
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua " +
  "ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure " +
  "in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt " +
  "culpa qui officia deserunt mollit anim id est laborum curabitur pretium tincidunt lacus nulla gravida orci a odio nullam " +
  "varius turpis et commodo pharetra est eros bibendum elit nec luctus magna felis sollicitudin mauris integer in mauris eu " +
  "nibh euismod gravida duis ac tellus et risus vulputate vehicula donec lobortis risus a elit etiam tempor"
).split(" ");

/** Générateur pseudo-aléatoire déterministe (pour des tests reproductibles). */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type LoremUnit = "paragraphs" | "sentences" | "words";
export type LoremFormat = "text" | "html" | "markdown";

export function lorem(count: number, unit: LoremUnit, format: LoremFormat, startClassic = true, rand = Math.random): string {
  const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  const words = (n: number) => Array.from({ length: n }, () => LOREM[int(0, LOREM.length - 1)]);
  let first = startClassic;
  const sentence = () => {
    let w = words(int(6, 14));
    if (first) {
      w = ["lorem", "ipsum", "dolor", "sit", "amet", ...w.slice(5)];
      first = false;
    }
    if (w.length > 8) w[int(3, w.length - 3)] += ",";
    const s = w.join(" ");
    return s.charAt(0).toUpperCase() + s.slice(1) + ".";
  };
  const paragraph = () => Array.from({ length: int(4, 7) }, sentence).join(" ");

  if (unit === "words") {
    const w = words(count);
    if (startClassic) ["lorem", "ipsum", "dolor", "sit", "amet"].slice(0, count).forEach((x, i) => (w[i] = x));
    const s = w.join(" ");
    const out = s.charAt(0).toUpperCase() + s.slice(1);
    return format === "html" ? `<p>${out}</p>` : out;
  }
  const blocks = unit === "sentences" ? [Array.from({ length: count }, sentence).join(" ")] : Array.from({ length: count }, paragraph);
  if (format === "html") return blocks.map((b) => `<p>${b}</p>`).join("\n");
  return blocks.join("\n\n");
}
