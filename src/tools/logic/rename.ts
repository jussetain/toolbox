// Renommage par lot (65) : calcul des nouveaux noms, sans toucher au disque.

export interface RenameRules {
  find: string;
  replace: string;
  regex: boolean;
  matchCase: boolean;
  prefix: string;
  suffix: string;
  caseMode: "keep" | "lower" | "upper" | "title";
  numbering: boolean;
  numberStart: number;
  numberPad: number;
  numberPosition: "prefix" | "suffix";
  numberSeparator: string;
  /** Remplace entièrement le nom (avant numérotation). */
  newName: string;
  extension: "keep" | "lower" | "upper";
}

export const DEFAULT_RULES: RenameRules = {
  find: "", replace: "", regex: false, matchCase: false, prefix: "", suffix: "", caseMode: "keep",
  numbering: false, numberStart: 1, numberPad: 2, numberPosition: "suffix", numberSeparator: "-",
  newName: "", extension: "keep",
};

const splitExt = (name: string) => {
  const i = name.lastIndexOf(".");
  return i > 0 ? [name.slice(0, i), name.slice(i + 1)] : [name, ""];
};

const titleCase = (s: string) => s.toLocaleLowerCase("fr").replace(/(^|[\s_\-.])(\p{L})/gu, (_, a, b) => a + b.toLocaleUpperCase("fr"));

export function applyRules(names: string[], r: RenameRules): { name: string; error?: string }[] {
  let re: RegExp | null = null;
  if (r.find) {
    try {
      re = r.regex
        ? new RegExp(r.find, r.matchCase ? "g" : "gi")
        : new RegExp(r.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), r.matchCase ? "g" : "gi");
    } catch {
      return names.map((n) => ({ name: n, error: "Expression régulière invalide" }));
    }
  }
  return names.map((original, i) => {
    let [base, ext] = splitExt(original);
    if (r.newName) base = r.newName;
    if (re) base = base.replace(re, r.replace);
    if (r.caseMode === "lower") base = base.toLocaleLowerCase("fr");
    if (r.caseMode === "upper") base = base.toLocaleUpperCase("fr");
    if (r.caseMode === "title") base = titleCase(base);
    base = r.prefix + base + r.suffix;
    if (r.numbering) {
      const n = String(r.numberStart + i).padStart(r.numberPad, "0");
      base = r.numberPosition === "prefix" ? n + r.numberSeparator + base : base + r.numberSeparator + n;
    }
    if (r.extension === "lower") ext = ext.toLowerCase();
    if (r.extension === "upper") ext = ext.toUpperCase();
    const name = ext ? `${base}.${ext}` : base;
    if (!base.trim()) return { name, error: "Nom vide" };
    if (/[\\/:*?"<>|]/.test(name)) return { name, error: "Caractère interdit par Windows" };
    return { name };
  });
}

/** Signale les noms en double (Windows ignore la casse). */
export function duplicates(names: string[]): Set<number> {
  const seen = new Map<string, number>();
  const dup = new Set<number>();
  names.forEach((n, i) => {
    const k = n.toLowerCase();
    if (seen.has(k)) {
      dup.add(i);
      dup.add(seen.get(k)!);
    } else seen.set(k, i);
  });
  return dup;
}
