// Logique pure des outils Développeur (85–96).

// ── JSON (85) ────────────────────────────────────────────────────────────────

export type JsonResult =
  | { ok: true; output: string; lines: number }
  | { ok: false; message: string; line?: number; column?: number };

export function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as object).sort().map((k) => [k, sortKeysDeep((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** Position (ligne, colonne 1-indexées) d'un index dans un texte. */
export function lineCol(text: string, index: number) {
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  return { line, column: index - before.lastIndexOf("\n") };
}

export function formatJson(input: string, indent: number | "\t" | 0, sortKeys = false): JsonResult {
  if (!input.trim()) return { ok: false, message: "Colle du JSON pour commencer." };
  try {
    let value = JSON.parse(input);
    if (sortKeys) value = sortKeysDeep(value);
    const output = indent === 0 ? JSON.stringify(value) : JSON.stringify(value, null, indent);
    return { ok: true, output, lines: output.split("\n").length };
  } catch (e) {
    const msg = (e as Error).message;
    // Chromium/WebView2 : « … at position 42 (line 3 column 5) » ; WebKit : pas de position.
    const lc = msg.match(/line (\d+) column (\d+)/);
    if (lc) return { ok: false, message: msg, line: +lc[1], column: +lc[2] };
    const pos = msg.match(/position (\d+)/);
    if (pos) return { ok: false, message: msg, ...lineCol(input, +pos[1]) };
    return { ok: false, message: msg };
  }
}

// ── Base64 (86) ──────────────────────────────────────────────────────────────

export function bytesToBase64(bytes: Uint8Array, urlSafe = false, wrap = 0): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  let out = btoa(bin);
  if (urlSafe) out = out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (wrap > 0) out = out.match(new RegExp(`.{1,${wrap}}`, "g"))?.join("\n") ?? out;
  return out;
}

export function base64ToBytes(s: string): Uint8Array {
  let clean = s.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error("Ce n'est pas du Base64 valide.");
  clean += "=".repeat((4 - (clean.length % 4)) % 4);
  const bin = atob(clean);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export const encodeBase64Text = (s: string, urlSafe = false, wrap = 0) =>
  bytesToBase64(new TextEncoder().encode(s), urlSafe, wrap);

export function decodeBase64Text(s: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(base64ToBytes(s));
}

// ── UUID (88) ────────────────────────────────────────────────────────────────

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const fmtUuid = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

type Fill = (b: Uint8Array<ArrayBuffer>) => Uint8Array;
const secureFill: Fill = (b) => crypto.getRandomValues(b);

export function uuidV4(rand: Fill = secureFill): string {
  const b = rand(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return fmtUuid(hex(b));
}

export function uuidV7(now = Date.now(), rand: Fill = secureFill): string {
  const b = rand(new Uint8Array(16));
  let ts = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  return fmtUuid(hex(b));
}

export interface UuidInfo {
  valid: boolean;
  version?: number;
  variant?: string;
  /** v1 et v7 : date de création. */
  date?: Date;
  nil?: boolean;
}

export function inspectUuid(s: string): UuidInfo {
  const h = s.trim().replace(/^urn:uuid:/i, "").replace(/[{}]/g, "").replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h)) return { valid: false };
  if (/^0+$/.test(h)) return { valid: true, nil: true, version: 0, variant: "nil" };
  if (/^f+$/.test(h)) return { valid: true, nil: true, version: 15, variant: "max" };
  const version = parseInt(h[12], 16);
  const v = parseInt(h[16], 16);
  const variant = v < 8 ? "NCS" : v < 12 ? "RFC 9562" : v < 14 ? "Microsoft" : "réservé";
  let date: Date | undefined;
  if (version === 7) date = new Date(parseInt(h.slice(0, 12), 16));
  if (version === 1) {
    const t = BigInt("0x" + h.slice(13, 16) + h.slice(8, 12) + h.slice(0, 8));
    date = new Date(Number((t - 122192928000000000n) / 10000n));
  }
  return { valid: true, version, variant, date };
}

// ── JWT (89) ─────────────────────────────────────────────────────────────────

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
  signingInput: string;
}

export function decodeJwt(token: string): DecodedJwt {
  const parts = token.trim().replace(/^Bearer\s+/i, "").split(".");
  if (parts.length !== 3) throw new Error("Un JWT a trois parties séparées par des points.");
  const part = (s: string, what: string) => {
    try {
      return JSON.parse(decodeBase64Text(s));
    } catch {
      throw new Error(`${what} illisible.`);
    }
  };
  return {
    header: part(parts[0], "En-tête"),
    payload: part(parts[1], "Contenu"),
    signature: parts[2],
    signingInput: `${parts[0]}.${parts[1]}`,
  };
}

const HMAC: Record<string, string> = { HS256: "SHA-256", HS384: "SHA-384", HS512: "SHA-512" };

/** Vérifie une signature HMAC. `null` si l'algorithme n'est pas HMAC. */
export async function verifyJwtHmac(jwt: DecodedJwt, secret: string): Promise<boolean | null> {
  const hash = HMAC[String(jwt.header.alg)];
  if (!hash) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(jwt.signingInput)));
  return bytesToBase64(sig, true) === jwt.signature.replace(/=+$/, "");
}

// ── Timestamps (90) ──────────────────────────────────────────────────────────

export type TsUnit = "s" | "ms" | "us" | "ns";

/** Devine l'unité d'un timestamp Unix d'après son nombre de chiffres. */
export function guessUnit(n: string): TsUnit {
  const digits = n.replace(/^-/, "").split(".")[0].length;
  if (digits <= 11) return "s";
  if (digits <= 14) return "ms";
  if (digits <= 17) return "us";
  return "ns";
}

export function timestampToDate(n: string, unit: TsUnit): Date {
  const v = Number(n);
  const ms = unit === "s" ? v * 1000 : unit === "ms" ? v : unit === "us" ? v / 1000 : v / 1e6;
  return new Date(ms);
}

export function relativeTime(d: Date, now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
  const diff = (d.getTime() - now) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60], ["second", 1],
  ];
  for (const [u, s] of units) if (Math.abs(diff) >= s || u === "second") return rtf.format(Math.round(diff / s), u);
  return "";
}

// ── Liens (93) ───────────────────────────────────────────────────────────────

const TRACKING = [
  /^utm_/i, /^fbclid$/i, /^gclid$/i, /^gclsrc$/i, /^dclid$/i, /^gbraid$/i, /^wbraid$/i, /^msclkid$/i, /^mc_(cid|eid)$/i,
  /^igshid$/i, /^igsh$/i, /^yclid$/i, /^_hsenc$/i, /^_hsmi$/i, /^__hs/i, /^hsCtaTracking$/i, /^mkt_tok$/i, /^vero_/i,
  /^oly_(anon|enc)_id$/i, /^rb_clickid$/i, /^s_cid$/i, /^ttclid$/i, /^twclid$/i, /^li_fat_id$/i, /^trk$/i, /^trkCampaign$/i,
  /^ref_src$/i, /^ref_url$/i, /^spm$/i, /^_ga$/i, /^_gl$/i, /^si$/i, /^feature$/i, /^pp$/i, /^ved$/i, /^ei$/i, /^sca_esv$/i,
];

/** Paramètres « si », « feature », « pp » : seulement sur les domaines où ce sont des traceurs. */
const HOST_SPECIFIC: Record<string, RegExp> = {
  si: /(^|\.)(youtube\.com|youtu\.be|spotify\.com)$/,
  feature: /(^|\.)(youtube\.com|youtu\.be)$/,
  pp: /(^|\.)(youtube\.com|youtu\.be)$/,
  ved: /(^|\.)google\./,
  ei: /(^|\.)google\./,
  sca_esv: /(^|\.)google\./,
};

/** Redirections connues : domaine → paramètre contenant l'URL de destination. */
const REDIRECTS: [RegExp, string, RegExp?][] = [
  [/(^|\.)google\.[a-z.]+$/, "q", /^\/url$/],
  [/(^|\.)google\.[a-z.]+$/, "url", /^\/url$/],
  [/^l\.facebook\.com$|^lm\.facebook\.com$/, "u"],
  [/^l\.instagram\.com$/, "u"],
  [/(^|\.)safelinks\.protection\.outlook\.com$/, "url"],
  [/^out\.reddit\.com$/, "url"],
  [/(^|\.)youtube\.com$/, "q", /^\/redirect$/],
  [/(^|\.)linkedin\.com$/, "url", /^\/redir/],
  [/(^|\.)slack-redir\.net$/, "url"],
  [/(^|\.)steamcommunity\.com$/, "url", /^\/linkfilter/],
  [/(^|\.)vk\.com$/, "to", /^\/away\.php$/],
];

export interface CleanedLink { original: string; cleaned: string; removed: string[]; unwrapped: number }

export function cleanLink(raw: string): CleanedLink {
  const removed: string[] = [];
  let unwrapped = 0;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { original: raw, cleaned: raw, removed, unwrapped };
  }
  for (let hops = 0; hops < 5; hops++) {
    const r = REDIRECTS.find(([host, param, path]) => host.test(url.hostname) && (!path || path.test(url.pathname)) && url.searchParams.get(param));
    if (!r) break;
    try {
      url = new URL(url.searchParams.get(r[1])!);
      unwrapped++;
    } catch {
      break;
    }
  }
  for (const key of [...url.searchParams.keys()]) {
    const tracked = TRACKING.some((re) => re.test(key));
    const hostRule = HOST_SPECIFIC[key.toLowerCase()];
    if (tracked && (!hostRule || hostRule.test(url.hostname))) {
      url.searchParams.delete(key);
      removed.push(key);
    }
  }
  if (/^(utm_|fbclid|gclid)/i.test(url.hash.slice(1))) url.hash = "";
  let cleaned = url.toString();
  if (!url.search && cleaned.endsWith("?")) cleaned = cleaned.slice(0, -1);
  return { original: raw, cleaned, removed: [...new Set(removed)], unwrapped };
}

export const findUrls = (text: string) => text.match(/https?:\/\/[^\s<>"'`]+/g) ?? [];

// ── Coordonnées (94) ─────────────────────────────────────────────────────────

export interface Coord { lat: number; lng: number; source: string }

const valid = (lat: number, lng: number) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(isNaN(lat) || isNaN(lng));

function dms(deg: string, min = "0", sec = "0", hemi = ""): number {
  const v = Math.abs(+deg.replace(",", ".")) + +min.replace(",", ".") / 60 + +sec.replace(",", ".") / 3600;
  return /[SWO]/i.test(hemi) || deg.startsWith("-") ? -v : v;
}

/** Extrait une coordonnée d'un lien de carte (Google, OSM, Bing, Apple) ou d'un texte (décimal ou DMS). */
export function parseCoord(input: string): Coord | null {
  const s = input.trim();
  if (!s) return null;
  const num = "(-?\\d{1,3}(?:\\.\\d+)?)";
  const patterns: RegExp[] = [
    new RegExp(`@${num},${num}`), // Google Maps …/@48.85,2.35,15z
    new RegExp(`!3d${num}!4d${num}`), // Google data=…!3d48.8!4d2.3
    new RegExp(`[?&](?:q|query|ll|sll|daddr|center|destination)=${num}(?:,|%2C)\\s*${num}`, "i"),
    new RegExp(`mlat=${num}&mlon=${num}`), // OSM marqueur
    new RegExp(`#map=\\d+/${num}/${num}`), // OSM
    new RegExp(`cp=${num}~${num}`), // Bing
    new RegExp(`geo:${num},${num}`),
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m && valid(+m[1], +m[2])) return { lat: +m[1], lng: +m[2], source: s };
  }
  // DMS : 48°51'24"N 2°21'03"E (ou O pour ouest)
  const d = s.match(
    /(\d{1,3}(?:[.,]\d+)?)\s*°\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*['′]\s*)?(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:"|″|'')\s*)?([NS])[\s,;]+(\d{1,3}(?:[.,]\d+)?)\s*°\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*['′]\s*)?(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:"|″|'')\s*)?([EWO])/i,
  );
  if (d) {
    const lat = dms(d[1], d[2], d[3], d[4]);
    const lng = dms(d[5], d[6], d[7], d[8]);
    if (valid(lat, lng)) return { lat, lng, source: s };
  }
  // Décimal : « 48.8566, 2.3522 » ou « 48,8566 2,3522 »
  const m = s.match(/^\s*(-?\d{1,3}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/) ?? s.match(/(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
  if (m) {
    const lat = +m[1].replace(",", ".");
    const lng = +m[2].replace(",", ".");
    if (valid(lat, lng)) return { lat, lng, source: s };
  }
  return null;
}

export function toDms(v: number, pos: string, neg: string): string {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const mf = (a - d) * 60;
  const m = Math.floor(mf);
  const sec = ((mf - m) * 60).toFixed(1);
  return `${d}°${String(m).padStart(2, "0")}′${sec.padStart(4, "0")}″${v < 0 ? neg : pos}`;
}

/** Distance orthodromique en mètres (formule de haversine). */
export function haversine(a: Coord, b: Coord): number {
  const R = 6371008.8;
  const r = (x: number) => (x * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const formatDistance = (m: number) =>
  m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toLocaleString("fr-FR", { maximumFractionDigits: m < 100000 ? 2 : 0 })} km`;

// ── Unicode (95) ─────────────────────────────────────────────────────────────

export type Flag = "invisible" | "bidi" | "space" | "confusable" | "control";

const SPECIAL: Record<number, [string, Flag]> = {
  0x00a0: ["ESPACE INSÉCABLE", "space"],
  0x00ad: ["TRAIT D'UNION CONDITIONNEL", "invisible"],
  0x034f: ["GRAPHÈME DE LIAISON INVISIBLE", "invisible"],
  0x061c: ["MARQUE DE LETTRE ARABE", "bidi"],
  0x115f: ["REMPLISSAGE HANGUL", "invisible"],
  0x1160: ["REMPLISSAGE HANGUL", "invisible"],
  0x180e: ["SÉPARATEUR DE VOYELLE MONGOL", "invisible"],
  0x2000: ["DEMI-CADRATIN", "space"], 0x2001: ["CADRATIN", "space"], 0x2002: ["ESPACE DEMI-CADRATIN", "space"],
  0x2003: ["ESPACE CADRATIN", "space"], 0x2004: ["ESPACE TIERS", "space"], 0x2005: ["ESPACE QUART", "space"],
  0x2006: ["ESPACE SIXIÈME", "space"], 0x2007: ["ESPACE TABULAIRE", "space"], 0x2008: ["ESPACE PONCTUATION", "space"],
  0x2009: ["ESPACE FINE", "space"], 0x200a: ["ESPACE ULTRAFINE", "space"],
  0x200b: ["ESPACE SANS CHASSE", "invisible"],
  0x200c: ["ANTILIANT SANS CHASSE", "invisible"],
  0x200d: ["LIANT SANS CHASSE", "invisible"],
  0x200e: ["MARQUE GAUCHE-À-DROITE", "bidi"],
  0x200f: ["MARQUE DROITE-À-GAUCHE", "bidi"],
  0x2028: ["SÉPARATEUR DE LIGNES", "control"],
  0x2029: ["SÉPARATEUR DE PARAGRAPHES", "control"],
  0x202a: ["ENCHÂSSEMENT GAUCHE-À-DROITE", "bidi"], 0x202b: ["ENCHÂSSEMENT DROITE-À-GAUCHE", "bidi"],
  0x202c: ["DIRECTIONNEL DE DÉPILEMENT", "bidi"], 0x202d: ["FORÇAGE GAUCHE-À-DROITE", "bidi"],
  0x202e: ["FORÇAGE DROITE-À-GAUCHE", "bidi"],
  0x202f: ["ESPACE INSÉCABLE ÉTROITE", "space"],
  0x205f: ["ESPACE MOYENNE MATHÉMATIQUE", "space"],
  0x2060: ["GLUON DE MOTS", "invisible"],
  0x2061: ["APPLICATION DE FONCTION", "invisible"], 0x2062: ["MULTIPLICATION INVISIBLE", "invisible"],
  0x2063: ["SÉPARATEUR INVISIBLE", "invisible"], 0x2064: ["PLUS INVISIBLE", "invisible"],
  0x2066: ["ISOLAT GAUCHE-À-DROITE", "bidi"], 0x2067: ["ISOLAT DROITE-À-GAUCHE", "bidi"],
  0x2068: ["ISOLAT DE PREMIER FORT", "bidi"], 0x2069: ["FIN D'ISOLAT", "bidi"],
  0x3000: ["ESPACE IDÉOGRAPHIQUE", "space"],
  0x3164: ["REMPLISSAGE HANGUL", "invisible"],
  0xfeff: ["INDICATEUR D'ORDRE DES OCTETS (BOM)", "invisible"],
  0xffa0: ["REMPLISSAGE HANGUL DEMI-CHASSE", "invisible"],
};

/** Lettres non latines qui ressemblent à des lettres latines → lettre imitée. */
const CONFUSABLES: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "һ": "h", "ԁ": "d",
  "ԛ": "q", "ԝ": "w", "ɡ": "g", "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C",
  "Т": "T", "Х": "X", "У": "Y", "І": "I", "Ј": "J", "Ѕ": "S", "Ԛ": "Q", "Ԝ": "W",
  "α": "a", "ο": "o", "ν": "v", "ρ": "p", "τ": "t", "υ": "u", "ι": "i", "κ": "k",
  "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T",
  "Υ": "Y", "Χ": "X",
};

const CATEGORIES: [RegExp, string][] = [
  [/\p{Lu}/u, "Lettre majuscule"], [/\p{Ll}/u, "Lettre minuscule"], [/\p{L}/u, "Lettre"], [/\p{M}/u, "Diacritique"],
  [/\p{Nd}/u, "Chiffre"], [/\p{N}/u, "Nombre"], [/\p{P}/u, "Ponctuation"], [/\p{Sc}/u, "Symbole monétaire"],
  [/\p{Extended_Pictographic}/u, "Emoji"], [/\p{S}/u, "Symbole"], [/\p{Zs}/u, "Espace"], [/\p{Cc}/u, "Contrôle"],
  [/\p{Cf}/u, "Format (invisible)"], [/\p{Co}/u, "Usage privé"],
];

const SCRIPTS = ["Latin", "Cyrillic", "Greek", "Arabic", "Hebrew", "Han", "Hiragana", "Katakana", "Hangul", "Thai", "Devanagari"];
const SCRIPT_FR: Record<string, string> = {
  Latin: "latin", Cyrillic: "cyrillique", Greek: "grec", Arabic: "arabe", Hebrew: "hébreu", Han: "han", Hiragana: "hiragana",
  Katakana: "katakana", Hangul: "hangûl", Thai: "thaï", Devanagari: "devanagari",
};

export interface CharInfo {
  char: string;
  code: number;
  hex: string;
  utf8: string;
  category: string;
  script?: string;
  name?: string;
  flag?: Flag;
  looksLike?: string;
}

const CONTROL_NAMES: Record<number, string> = { 9: "TABULATION", 10: "SAUT DE LIGNE (LF)", 13: "RETOUR CHARIOT (CR)", 32: "ESPACE" };

export function inspectChars(s: string): CharInfo[] {
  return [...s].map((char) => {
    const code = char.codePointAt(0)!;
    const special = SPECIAL[code];
    const category = CATEGORIES.find(([re]) => re.test(char))?.[1] ?? "Autre";
    const script = SCRIPTS.find((sc) => new RegExp(`\\p{Script=${sc}}`, "u").test(char));
    let flag: Flag | undefined = special?.[1];
    if (!flag && /\p{Cc}/u.test(char) && ![9, 10, 13].includes(code)) flag = "control";
    if (!flag && /\p{Cf}/u.test(char)) flag = "invisible";
    if (!flag && (code >= 0xe0000 && code <= 0xe007f)) flag = "invisible"; // tags
    const looksLike = CONFUSABLES[char];
    if (!flag && looksLike) flag = "confusable";
    return {
      char,
      code,
      hex: "U+" + code.toString(16).toUpperCase().padStart(4, "0"),
      utf8: [...new TextEncoder().encode(char)].map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" "),
      category,
      script: script ? SCRIPT_FR[script] : undefined,
      name: special?.[0] ?? CONTROL_NAMES[code],
      flag,
      looksLike,
    };
  });
}

/** Retire invisibles et contrôles bidi, remplace espaces exotiques et sosies par l'ASCII. */
export function sanitizeText(s: string, opts = { invisibles: true, spaces: true, confusables: true }): string {
  return inspectChars(s)
    .map((c) => {
      if (opts.invisibles && (c.flag === "invisible" || c.flag === "bidi" || c.flag === "control")) return "";
      if (opts.spaces && c.flag === "space") return " ";
      if (opts.confusables && c.flag === "confusable") return c.looksLike!;
      return c.char;
    })
    .join("");
}
