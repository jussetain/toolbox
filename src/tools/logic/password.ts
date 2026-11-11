// Générateur de mots de passe : tirage cryptographique sans biais, robustesse en bits.

export type RandomInt = (max: number) => number;

/** Entier uniforme dans [0, max) via crypto.getRandomValues, sans biais (rejet). */
export const cryptoInt: RandomInt = (max) => {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % max;
};

export const SETS = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!#$%&*+-=?@_~.,:;",
};
export type SetId = keyof typeof SETS;
const AMBIGUOUS = /[O0oIl1|]/g;

export interface PasswordOptions { length: number; sets: SetId[]; noAmbiguous: boolean }

export function alphabet(o: Pick<PasswordOptions, "sets" | "noAmbiguous">): string[] {
  return o.sets.map((s) => (o.noAmbiguous ? SETS[s].replace(AMBIGUOUS, "") : SETS[s]));
}

/** Mot de passe contenant au moins un caractère de chaque famille choisie. */
export function password(o: PasswordOptions, rnd: RandomInt = cryptoInt): string {
  const groups = alphabet(o).filter(Boolean);
  if (!groups.length) throw new Error("Choisis au moins un type de caractères.");
  const all = groups.join("");
  const len = Math.max(o.length, groups.length);
  const chars = groups.map((g) => g[rnd(g.length)]);
  while (chars.length < len) chars.push(all[rnd(all.length)]);
  // Mélange de Fisher-Yates : les caractères imposés ne restent pas en tête.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export const passwordBits = (o: PasswordOptions) => o.length * Math.log2(Math.max(1, alphabet(o).join("").length));

// Mots courants, sans accents ni lettres ambiguës à l'oral : faciles à taper et à dicter.
const RAW = `abeille abricot acier adresse agneau aigle aiguille aimant album algue allure amande ampoule ancre anneau antenne appel arbre arche argent armoire arome asperge atelier atlas aube auberge avion avocat badge bagage baguette baleine balcon ballon bambou banane banc bandeau barque bassin bateau bazar beignet berger beton biscuit bison blason bocal bougie bouquet boussole bouton branche brioche brique brosse buffet bureau cabane cacao cactus cadeau cadre cahier caillou calme camion canal canard canon capitaine caramel carnet carotte carte castor cerise chaise chaland chameau champ chanson chapeau charbon chariot chateau chaton chemin cheval chocolat cigale cinema citron clairon clavier cloche clou coffre colline comete compas concert copain corail cornet coton coussin crayon crabe cratere crepe criquet crochet cuivre cygne dauphin dentelle desert diamant domino dragon drapeau dune echelle ecorce ecran ecureuil enclume encre epice epine escargot etoile falaise farine fenetre feuille ficelle figue flamme fleuve flocon flute foret fourmi fraise frisson fromage fusee galet gant garage gazon gilet girafe glacier gland gomme gorille goutte grain grange grenier griffe grotte guitare hamac hameau harpe herisson hibou horloge houblon igloo image indigo iris ivoire jardin jasmin jongleur journal jumelle jungle kayak kiwi lagune lampe lanterne lapin laurier lavande legume lentille levier lezard licorne lierre limace lingot lion litchi livre loutre lumiere lune lutin macaron madame magie maison mammouth manche mangue manteau marbre marelle marmotte marteau masque matelas melon menthe meteore miel miroir mitaine moineau montagne mouette moulin mouton muguet musique navire neige nuage oasis ocean olive ombre opale orage orange orchidee oreiller orgue ortie ourson outil pagode paille palmier panda panier papaye papillon paquet parapluie passoire pastel patin pelote pendule pepite perle phare piano pigeon pinceau pirate piscine planete plume poivre pomme pompier portail potager poulpe prairie prune puzzle pyjama quartz radeau radis raisin rateau renard requin rideau riviere robot rocher roseau rubis ruche sable sabot safran salade sapin sardine satin sauce savon sentier serpent sifflet sirop soleil sorbet souris stylo sucre tambour tampon tapis tasse taupe theiere tigre tipi tissu toboggan tomate tonneau torche tortue toupie tracteur trefle tresor tricot trompette tulipe tunnel turban usine vague valise vanille velo vent verger violon volcan wagon yaourt zebre zeste`;
export const WORDS = [...new Set(RAW.split(/\s+/).filter(Boolean))];

export interface PhraseOptions { words: number; separator: string; capitalize: boolean; digit: boolean }

export function passphrase(o: PhraseOptions, rnd: RandomInt = cryptoInt): string {
  const ws = Array.from({ length: Math.max(2, o.words) }, () => WORDS[rnd(WORDS.length)]).map((w) => (o.capitalize ? w[0].toUpperCase() + w.slice(1) : w));
  if (o.digit) {
    const i = rnd(ws.length);
    ws[i] += String(rnd(10));
  }
  return ws.join(o.separator);
}

export const passphraseBits = (o: PhraseOptions) => Math.max(2, o.words) * Math.log2(WORDS.length) + (o.digit ? Math.log2(10 * Math.max(2, o.words)) : 0);

/** Robustesse lisible à partir de l'entropie. */
export function strength(bits: number): { label: string; level: 0 | 1 | 2 | 3 } {
  if (bits < 45) return { label: "Faible", level: 0 };
  if (bits < 65) return { label: "Correct", level: 1 };
  if (bits < 90) return { label: "Fort", level: 2 };
  return { label: "Très fort", level: 3 };
}
