import { categoryById, TOOLS, type Tool } from "./registry";

/** Minuscules sans accents. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Score d'un outil pour une requête : début de mot > sous-chaîne > sous-séquence.
 * Retourne -1 si aucun terme ne correspond.
 */
function score(tool: Tool, query: string): number {
  const name = fold(tool.name);
  const hay = `${name} ${fold(tool.description)} ${fold(tool.keywords ?? "")} ${fold(categoryById[tool.category].name)}`;
  let total = 0;
  for (const term of query.split(/\s+/).filter(Boolean)) {
    if (name.startsWith(term)) total += 100;
    else if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(name)) total += 80;
    else if (name.includes(term)) total += 50;
    else if (hay.includes(term)) total += 20;
    else if (isSubsequence(term, name)) total += 5;
    else return -1;
  }
  return total;
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

export function searchTools(query: string, recent: string[] = []): Tool[] {
  const q = fold(query.trim());
  if (!q) {
    const rec = recent.map((id) => TOOLS.find((t) => t.id === id)).filter(Boolean) as Tool[];
    return [...rec, ...TOOLS.filter((t) => !recent.includes(t.id))];
  }
  return TOOLS.map((t) => ({ t, s: score(t, q) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.t.n - b.t.n)
    .map((x) => x.t);
}
