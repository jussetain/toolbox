export type CategoryId =
  | "video"
  | "audio"
  | "images"
  | "docs"
  | "text"
  | "files"
  | "system"
  | "dev";

export interface Category {
  id: CategoryId;
  name: string;
  /** Couleur de la catégorie (aplat). */
  color: string;
  /** Variante foncée lisible sur fond crème (≥ 4.5:1). */
  ink: string;
}

export const CATEGORIES: Category[] = [
  { id: "video", name: "Vidéo", color: "#E2572B", ink: "#A33A12" },
  { id: "audio", name: "Audio", color: "#3A9A5B", ink: "#226B3C" },
  { id: "images", name: "Images", color: "#6E9BEA", ink: "#1F4FA8" },
  { id: "docs", name: "Documents", color: "#E5574F", ink: "#A3271F" },
  { id: "text", name: "Texte et parole", color: "#E9C24A", ink: "#7A5A00" },
  { id: "files", name: "Fichiers", color: "#D9CBB0", ink: "#5E5547" },
  { id: "system", name: "Système", color: "#4FB3A9", ink: "#1D6B63" },
  { id: "dev", name: "Développeur", color: "#A98BE6", ink: "#5B36A8" },
];

export const categoryById = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, Category>;

export interface Tool {
  /** Numéro 1–96, stable. */
  n: number;
  id: string;
  category: CategoryId;
  name: string;
  description: string;
  /** Mots-clés supplémentaires pour la recherche. */
  keywords?: string;
}

type Row = [string, string, string, string?];

const rows: Record<CategoryId, Row[]> = {
  video: [
    ["download-video", "Télécharger une vidéo", "Depuis YouTube, X, TikTok et d'autres sites, à partir d'un lien", "youtube yt-dlp"],
    ["burn-subtitles", "Incruster des sous-titres", "Depuis un fichier SRT ou par transcription automatique", "srt captions"],
    ["change-speed", "Changer la vitesse", "Accélère ou ralentit sans déformer les voix", "accelerer ralentir"],
    ["extract-frames", "Extraire des images", "Enregistre des images fixes en PNG, JPEG ou HEIC", "frames capture"],
    ["record-screen", "Enregistrer l'écran", "Écran, fenêtre ou zone, avec le son", "capture recorder"],
    ["compress-video", "Compresser une vidéo", "Réduit le poids, garde la qualité", "reduire taille"],
    ["convert-video", "Convertir une vidéo", "En MP4, MOV, WebM ou M4V", "mp4 mov webm"],
    ["resize-video", "Redimensionner une vidéo", "Dimensions exactes", "resolution"],
    ["crop-rotate-video", "Recadrer et pivoter", "Recadre, pivote et retourne une vidéo", "crop rotate"],
    ["media-info", "Infos média", "Codec, résolution, images/s, débit et métadonnées", "ffprobe codec"],
    ["trim-video", "Couper une vidéo", "Coupe le début et la fin sans réencodage", "trim cut"],
    ["merge-videos", "Fusionner des vidéos", "Assemble des clips dans l'ordre choisi", "join concat"],
    ["mute-video", "Couper le son", "Retire la bande-son sans réencodage", "mute muet"],
    ["replace-audio", "Remplacer l'audio", "Nouvelle musique ou voix, en remplacement ou en mixage", "musique"],
    ["video-to-gif", "Vidéo vers GIF", "GIF animés de haute qualité", "gif"],
  ],
  audio: [
    ["clean-audio", "Nettoyer l'audio", "Réduit le bruit de fond et le ronflement", "bruit denoise"],
    ["record-audio", "Enregistrer et transcrire", "Enregistre ta voix puis la transcrit en local", "micro dictaphone"],
    ["trim-audio", "Couper un audio", "Garde seulement la partie voulue", "trim"],
    ["extract-audio", "Extraire l'audio", "Enregistre la bande-son d'une vidéo", "mp3"],
    ["convert-audio", "Convertir un audio", "En MP3, M4A, WAV, FLAC ou AIFF", "mp3 wav flac"],
  ],
  images: [
    ["blur-faces", "Flouter les visages", "Détecte les visages et les floute, pixelise ou masque", "anonymiser"],
    ["beautify-screenshot", "Embellir une capture", "Fond, marge, coins arrondis et ombre", "screenshot"],
    ["remove-background", "Supprimer l'arrière-plan", "Détoure le sujet, fond transparent ou uni", "detourer fond"],
    ["convert-images", "Convertir des images", "En JPEG, PNG, HEIC, TIFF ou WebP", "jpg png webp heic"],
    ["compress-images", "Compresser des images", "Plus léger, sans perte visible", "reduire"],
    ["resize-images", "Redimensionner des images", "Par pourcentage, côté long ou taille exacte", "resize"],
    ["rotate-images", "Pivoter des images", "Pivote ou retourne plusieurs photos d'un coup", "rotate"],
    ["remove-metadata", "Supprimer les métadonnées", "Retire position GPS, appareil et date", "exif gps"],
    ["color-picker", "Pipette", "Prend une couleur à l'écran, en HEX, RGB, HSL ou code", "couleur color"],
    ["redact-image", "Masquer une zone", "Floute, pixelise ou noircit une partie d'image", "caviarder"],
    ["annotate-screenshot", "Annoter une capture", "Flèches, cadres, texte et étapes numérotées", "annotation"],
  ],
  docs: [
    ["scan-document", "Numériser un document", "Scanner ou photos, assemblés en un PDF", "scan"],
    ["redact-pdf", "Caviarder un PDF", "Supprime vraiment noms, numéros ou zones", "anonymiser"],
    ["fill-forms", "Remplir et aplatir un formulaire", "Remplit un formulaire PDF, ajoute du texte, aplatit", "formulaire"],
    ["ocr-pdf", "Rendre un PDF cherchable", "Ajoute un calque texte invisible aux PDF scannés", "ocr"],
    ["pdf-to-word", "PDF vers Word", "Convertit en document Word modifiable", "docx"],
    ["sign-pdf", "Signer un PDF", "Dessine ou tape ta signature, puis place-la", "signature"],
    ["merge-pdfs", "Fusionner des PDF", "Combine PDF et images en un document", "assembler"],
    ["split-pdf", "Découper un PDF", "En pages séparées ou par plages", "split"],
    ["organize-pdf", "Organiser un PDF", "Réordonne, pivote et supprime des pages", "pages"],
    ["delete-pages", "Supprimer des pages", "Retire les pages inutiles", ""],
    ["extract-pages", "Extraire des pages", "Enregistre une sélection de pages en nouveau PDF", ""],
    ["images-to-pdf", "Images vers PDF", "Transforme photos et scans en un PDF", ""],
    ["crop-pdf", "Recadrer un PDF", "Réduit la taille des pages", "crop"],
    ["compress-pdf", "Compresser un PDF", "Recompresse les images du document", "reduire"],
    ["add-password", "Ajouter un mot de passe", "Protège un PDF, limite impression et copie", "chiffrer"],
    ["remove-password", "Retirer un mot de passe", "Copie déverrouillée d'un PDF dont tu as le mot de passe", "deverrouiller"],
    ["pdf-to-images", "PDF vers images", "Chaque page en PNG, JPEG ou HEIC", ""],
    ["convert-documents", "Convertir des documents", "Word, OpenDocument, RTF, HTML, texte, Markdown", "pandoc"],
    ["word-to-pdf", "Word vers PDF", "Documents Word, RTF et texte en PDF", "docx"],
    ["powerpoint-to-pdf", "PowerPoint vers PDF", "Présentations en PDF", "pptx slides"],
    ["excel-to-pdf", "Excel vers PDF", "Tableurs en PDF", "xlsx"],
    ["webpage-to-pdf", "Page web vers PDF", "Enregistre une page web en PDF", "url html"],
    ["markdown-to-pdf", "Markdown vers PDF", "Met en page des notes Markdown en PDF", "md"],
  ],
  text: [
    ["transcribe", "Transcrire", "Transcription horodatée d'un audio ou d'une vidéo", "whisper sous-titres"],
    ["summarize", "Résumer", "Résume un texte ou un document, en local", "resume ia"],
    ["extract-text", "Extraire le texte", "Reconnaît le texte d'images et de PDF scannés", "ocr"],
    ["capture-text", "Capturer du texte", "Sélectionne une zone de l'écran et copie son texte", "ocr ecran"],
    ["translate", "Traduire", "Textes, documents et sous-titres, en local", "traduction"],
    ["text-to-speech", "Synthèse vocale", "Transforme texte, documents et PDF en audio", "tts voix"],
    ["ask-document", "Interroger un document", "Réponses sur un document avec références de pages", "question ia"],
    ["word-counter", "Compteur de mots", "Mots, caractères, phrases, paragraphes, temps de lecture", "compter"],
    ["case-converter", "Convertisseur de casse", "MAJUSCULES, camelCase, snake_case, kebab-case…", "casse"],
  ],
  files: [
    ["qr-code", "QR code", "Crée des QR codes ou lit codes et codes-barres", "barcode"],
    ["batch-rename", "Renommage par lot", "Rechercher-remplacer, numérotation, dates, casse", "renommer"],
    ["find-duplicates", "Trouver les doublons", "Trouve les fichiers identiques et met les copies à la corbeille", "doublon"],
    ["zip-unzip", "Zip / Dézip", "Ouvre ZIP, RAR, 7z, TAR ; crée des ZIP protégés", "archive 7z rar"],
    ["organize-downloads", "Ranger les téléchargements", "Trie les images téléchargées par site d'origine", "trier"],
  ],
  system: [
    ["speed-test", "Test de débit", "Mesure descendante, montante et réactivité", "internet vitesse"],
    ["storage-explorer", "Explorateur de stockage", "Ce qui remplit le disque, et nettoyage sûr", "disque espace"],
    ["wifi-password", "Mot de passe Wi-Fi + QR", "Affiche un mot de passe Wi-Fi enregistré et son QR code", "wifi"],
    ["battery-health", "Santé de la batterie", "Capacité, cycles et chargeur", "batterie"],
    ["keep-awake", "Empêcher la veille", "Garde le PC éveillé pendant une durée choisie", "caffeine veille"],
    ["uninstall-app", "Désinstaller une app", "Supprime une app avec ses caches et restes", "desinstaller"],
    ["presentation-mode", "Mode présentation", "Masque icônes et barre des tâches, coupe les notifications", "partage ecran"],
    ["clean-keyboard", "Nettoyer le clavier", "Bloque le clavier une minute pour le nettoyer", "clavier"],
    ["dead-pixel-test", "Test de pixels morts", "Remplit l'écran de couleurs unies", "ecran pixel"],
    ["eject-all", "Éjecter tous les disques", "Éjecte proprement disques, cartes et images disque", "usb"],
    ["startup-items", "Démarrage et arrière-plan", "Liste ce qui se lance au démarrage et permet de le couper", "demarrage"],
    ["unblock-file", "Débloquer un fichier téléchargé", "Vérifie l'éditeur signé et retire le blocage Windows", "smartscreen zone"],
    ["reset-permissions", "Réinitialiser les autorisations", "Réinitialise l'accès caméra, micro, position d'une app", "confidentialite"],
    ["hidden-settings", "Réglages cachés", "Active des réglages Windows absents des Paramètres", "tweaks"],
    ["display-control", "Contrôle des écrans", "Luminosité, contraste et volume des écrans externes", "ddc luminosite"],
    ["mouse-fixes", "Réglages souris", "Sens et vitesse de défilement de la molette", "souris scroll"],
  ],
  dev: [
    ["json-formatter", "Formateur JSON", "Indente, minifie et valide du JSON", "json"],
    ["base64", "Base64", "Encode et décode texte et fichiers", "encode decode"],
    ["hash-generator", "Générateur de hash", "MD5, SHA-1, SHA-256, SHA-512, et comparaison", "checksum sha md5"],
    ["uuid-generator", "Générateur d'UUID", "UUID v4 ou v7 en série, et inspection", "guid"],
    ["jwt-decoder", "Décodeur JWT", "En-tête, claims, expiration et signature HMAC", "token"],
    ["timestamp-converter", "Convertisseur de timestamp", "Timestamps Unix ↔ dates, fuseaux horaires", "epoch date"],
    ["diff-checker", "Comparateur de textes", "Compare deux textes ou fichiers", "diff"],
    ["regex-tester", "Testeur de regex", "Surlignage en direct, groupes et remplacement", "regex"],
    ["clean-links", "Nettoyeur de liens", "Retire les paramètres de pistage et les redirections", "utm url"],
    ["coordinate-picker", "Pipette de coordonnées", "Coordonnées depuis un lien de carte, distances", "gps carte"],
    ["unicode-inspector", "Inspecteur Unicode", "Montre chaque caractère, repère les invisibles", "caracteres"],
    ["lorem-ipsum", "Lorem Ipsum", "Texte de remplissage en texte, HTML ou Markdown", "placeholder"],
  ],
};

let n = 0;
export const TOOLS: Tool[] = CATEGORIES.flatMap((c) =>
  rows[c.id].map(([id, name, description, keywords]) => ({
    n: ++n,
    id,
    category: c.id,
    name,
    description,
    keywords,
  })),
);

export const toolById = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<string, Tool>;

export function toolsIn(category: CategoryId): Tool[] {
  return TOOLS.filter((t) => t.category === category);
}
