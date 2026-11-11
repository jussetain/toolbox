// Passage d'un fichier d'un outil à l'autre (ex. capture d'écran → Annoter).
let pending: string | null = null;
export const handOff = (path: string) => void (pending = path);
/** Lecture tolérante au double rendu du mode strict : effacé juste après, pas à la lecture. */
export const takeHandOff = () => {
  const p = pending;
  if (p) setTimeout(() => { if (pending === p) pending = null; }, 0);
  return p;
};
