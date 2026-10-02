# Documents Word (`.docx`)

Deux chemins indépendants manipulent les `.docx` : l'**assistant** par le skill
`docx-cli`, l'**avocat** par la visionneuse intégrée. Ils écrivent le même
fichier sur disque ; chacun voit les modifications de l'autre.

## 1. Côté assistant — skill `docx-cli`

| Quoi | Où |
| --- | --- |
| Installation (marketplace `kklimuk/docx-cli`, plugin `docx-cli@docx-cli`, activation) | `server/piecemaker/vendor/installer/steps/11-docx-cli.mjs` |
| Usage en rédaction (templates, placeholders, modifications suivies) | `server/piecemaker/vendor/piecemaker-plugin/skills/redaction-juridique/SKILL.md` |
| Garde-fou Bash (`docx read pièce.docx` passe par le hook) | `server/piecemaker/vendor/piecemaker-plugin/scripts/protect-originals.mjs` |
| Classement des `.docx` produits par l'IA | `server/piecemaker/vendor/piecemaker-plugin/scripts/classify-ai-documents.mjs` |

- Remplace `document-skills:docx` : le binaire `docx` mute l'OOXML **en place**
  (styles maison, thème et objets embarqués conservés), adresse le contenu par
  localisateurs stables, et expose `docx track-changes` pour les actes à relire.
- Le binaire n'est pas installé par l'étape 11 : le skill le pose au premier
  usage (`scripts/bootstrap.sh`, version épinglée, SHA-256 vérifié).
- Travaillant entièrement par Bash, il est couvert par `protect-originals.mjs`,
  qui inspecte aussi les commandes shell. Par défaut seuls PDF et images sont
  protégés (`lib/protection.cjs`, `PROTECTED_EXTENSIONS`) : un `.docx` n'est
  protégé que s'il est listé dans `.piecemaker/protection.json`.

## 2. Côté avocat — visionneuse / éditeur intégré

Ouvrir un `.docx` depuis l'arborescence affiche un éditeur Word complet
(`@eigenpal/docx-editor-react`, Apache-2.0, interface `fr`) au lieu du message
« Fichier binaire ».

| Fichier | Rôle |
| --- | --- |
| `src/piecemaker/docx/DocxDocumentViewer.tsx` | Éditeur, rechargement externe, enregistrement automatique |
| `src/piecemaker/docx/index.ts` | `DocxDocumentViewer`, `isDocxDocument` |
| `src/modules/code-editor/CodeEditor.tsx` | **Seul fichier CloudCLI touché** : import + une ligne de branchement, juste avant le rendu binaire |
| `server/piecemaker/docx-document.ts` | `GET /api/piecemaker/docx-document/version` (mtime) et `PUT /api/piecemaker/docx-document` (écriture) |
| `server/piecemaker/index.ts` | Montage du routeur |

Fonctionnement :

- Lecture des octets par l'API CloudCLI existante (`api.readFileBlob`).
- Toutes les secondes, comparaison du `mtime` : si le fichier a changé sur
  disque (par exemple `docx-cli` côté assistant), l'éditeur se recharge.
- Après une frappe ou un clic de l'utilisateur, chaque `onChange` programme un
  enregistrement 800 ms plus tard. `save()` est sélectif par défaut : seules
  les parties modifiées de l'archive sont repackagées.
- Écriture atomique (fichier `.tmp` puis `rename`), 100 Mo maximum.
- Route derrière `authenticateToken` (montage `/api/piecemaker`), limitée aux
  `.docx`, chemin résolu contre la racine du projet (même contrôle lexical que
  le file-tree CloudCLI).

## 3. Défauts connus (audit du 2026-09-26)

1. **Écriture sans garde sur les pièces originales.** L'enregistrement
   automatique s'applique à tout `.docx` du projet, y compris une pièce reçue
   ou un fichier listé dans `protection.json`. Une frappe accidentelle modifie
   l'original sans confirmation. Piste : lecture seule par défaut, bouton
   « Modifier », refus côté route des fichiers protégés.
2. **Perte de frappe sur modification externe.** Si le fichier change sur
   disque pendant la fenêtre de 800 ms, le rechargement annule le minuteur :
   la dernière saisie est perdue, sans avertissement.
3. **Contrôle de chemin lexical uniquement.** Pas de `realpath` : un lien
   symbolique dans le projet pointant hors du projet serait suivi (même
   faiblesse que le file-tree CloudCLI).
4. **Enregistrements concurrents non sérialisés.** Deux `save()` rapprochés
   peuvent se chevaucher ; seul le debounce les espace.
5. **Projet absent.** Sans `projectId`, `load()` ne fait rien et l'écran reste
   sur « Chargement… ».
6. **Chaînes en dur.** « Fermer » et « Chargement… » ne passent pas par
   l'i18n.
7. **Sondage permanent.** Une requête par seconde tant qu'un `.docx` est
   ouvert.
8. **Lint.** `react(set-state-in-effect)` sur l'effet de chargement (faux
   positif : l'état est posé après un `await`).
9. **Exception à la règle upstream.** Les 3 lignes de `CodeEditor.tsx` ne sont
   ni de la marque ni de l'isolation ; c'est le seul point d'entrée possible
   pour remplacer le rendu binaire.
10. **Non testé en conditions réelles** lors de la récupération (serveur de dev
    arrêté) : typecheck et lint seulement.
