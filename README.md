# Toolbox

102 outils locaux pour Windows dans une seule app : vidéo, audio, images, PDF, texte, fichiers, système, dev.
Lanceur global `Ctrl + Maj + Espace`. Les résultats vont dans `Téléchargements\Toolbox\AAAA-MM-JJ`.

## Stack

- Tauri 2 (Rust) + React / TypeScript / Vite
- DA « Atelier » : `src/styles/atelier.css` (tokens), `src/styles/app.css` (mise en page)

## Structure

| Chemin | Rôle |
| --- | --- |
| `src/tools/registry.ts` | Les 102 outils (id, catégorie, nom, description) |
| `src/tools/impl/` | Interfaces des outils implémentés ; `index.ts` les déclare |
| `src/Launcher.tsx` | Fenêtre du lanceur (label `launcher`) |
| `src-tauri/src/jobs.rs` | Tâches longues : thread, progression (événement `job`), annulation |
| `src-tauri/src/output.rs` | Dossier de sortie du jour, noms de fichiers uniques |
| `src-tauri/src/launcher.rs` | Raccourci global, fenêtre lanceur, zone de notification |
| `src-tauri/src/tools/` | Commandes Rust des outils |

## Ajouter un outil

1. Commande Rust dans `src-tauri/src/tools/<outil>.rs` ; pour un traitement long, `jobs::spawn` renvoie un id de tâche.
2. Déclarer la commande dans `generate_handler!` (`src-tauri/src/lib.rs`).
3. Composant React dans `src/tools/impl/`, enregistré dans `src/tools/impl/index.ts`.

## Moteurs externes

Téléchargés une seule fois à la première utilisation (`src-tauri/src/engines.rs`), dans `%LOCALAPPDATA%\app.toolbox.windows\engines` ; un exécutable déjà présent dans le PATH est utilisé en priorité.

| Moteur | Outils | Taille |
| --- | --- | --- |
| FFmpeg (BtbN, GPL) | Vidéo, audio, enregistrements | ≈ 90 Mo |
| yt-dlp | Télécharger une vidéo | ≈ 18 Mo |
| Pandoc | Convertir des documents | ≈ 35 Mo |
| whisper.cpp + modèle small | Transcrire, sous-titres auto | ≈ 475 Mo |
| llama.cpp + Llama 3.2 3B Q4 | Résumer, Traduire, Interroger | ≈ 2 Go |
| ISNet (ONNX) | Supprimer l'arrière-plan | ≈ 170 Mo |

Intégrés à Windows (rien à télécharger) : OCR, détection de visages, synthèse vocale, Wi-Fi, DDC/CI, registre.
Office → PDF utilise Word/PowerPoint/Excel s'ils sont installés, sinon LibreOffice ; page web/Markdown → PDF utilise Edge.

## Tests

```sh
pnpm test               # logique TS (vitest)
cd src-tauri && cargo test   # Rust, dont un test qui exécute réellement chaque opération FFmpeg
cargo xwin check --target x86_64-pc-windows-msvc   # vérifie le code propre à Windows depuis Linux
```

## Développement

```sh
pnpm install
pnpm tauri dev          # Linux ou Windows
cd src-tauri && cargo test
```

Build Windows : GitHub Actions (`.github/workflows/build.yml`) produit l'installeur NSIS et le MSI.
