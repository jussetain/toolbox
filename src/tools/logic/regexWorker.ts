// Exécute une regex hors du fil principal : une regex catastrophique ne fige pas l'app.

export interface RegexRequest { id: number; pattern: string; flags: string; text: string; replace: string | null }
export interface RegexMatch { index: number; end: number; text: string; groups: (string | undefined)[]; named?: Record<string, string | undefined> }
export interface RegexResponse { id: number; started?: boolean; matches?: RegexMatch[]; truncated?: boolean; replaced?: string; error?: string }

const MAX = 5000;

self.onmessage = (e: MessageEvent<RegexRequest>) => {
  const { id, pattern, flags, text, replace } = e.data;
  (self as unknown as Worker).postMessage({ id, started: true } satisfies RegexResponse);
  try {
    const re = new RegExp(pattern, flags.includes("g") ? flags : flags + "g");
    const matches: RegexMatch[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) && matches.length < MAX) {
      matches.push({ index: m.index, end: m.index + m[0].length, text: m[0], groups: m.slice(1), named: m.groups ? { ...m.groups } : undefined });
      if (m[0] === "") re.lastIndex++;
      if (!flags.includes("g")) break;
    }
    const replaced = replace === null ? undefined : text.replace(new RegExp(pattern, flags), replace);
    (self as unknown as Worker).postMessage({ id, matches, truncated: matches.length >= MAX, replaced } satisfies RegexResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: (err as Error).message } satisfies RegexResponse);
  }
};
