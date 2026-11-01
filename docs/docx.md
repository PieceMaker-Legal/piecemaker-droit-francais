# Documents Word (`.docx`)

Deux chemins indépendants manipulent les `.docx` : l'**assistant** par le skill
`docx-cli`, l'**avocat** par la visionneuse intégrée. Ils écrivent le même
fichier sur disque ; chacun voit les modifications de l'autre.

## 1. Côté assistant — skill `docx-cli`

| Quoi | Où |
| --- | --- |
| Installation (skill vendu, déclaré dans chaque dossier) | `server/piecemaker/vendor/skills/docx-cli/`, `server/piecemaker/skill-declaration.ts` |
| Règles de rédaction par document et templates (déclaré dans chaque dossier) | `server/piecemaker/vendor/piecemaker-plugin/skills/style-redaction-cabinet/SKILL.md` |
| Style Word du cabinet (profil hors dépôt, `~/.piecemaker/custom/style-docx/` ; document créé et LibreOffice) | `server/piecemaker/vendor/piecemaker-plugin/skills/style-redaction-cabinet/scripts/style-docx.py`, `references/configuration-style-docx.md` |
| Garde-fou Bash (`docx read pièce.docx` passe par le hook) | `server/piecemaker/vendor/piecemaker-plugin/scripts/protect-originals.mjs` |
| Classement des `.docx` produits par l'IA | `server/piecemaker/vendor/piecemaker-plugin/scripts/classify-ai-documents.mjs` |

- Remplace `document-skills:docx` : le binaire `docx` mute l'OOXML **en place**
  (styles maison, thème et objets embarqués conservés), adresse le contenu par
  localisateurs stables, et expose `docx track-changes` pour les actes à relire.
- Le skill est copié dans `.agents/skills/docx-cli/` de chaque dossier (liens
  Claude, Cursor, OpenCode, Grok). Le binaire `docx` est posé au premier usage
  (`scripts/bootstrap.sh`, version épinglée, SHA-256 vérifié).
- Travaillant entièrement par Bash, il est couvert par `protect-originals.mjs`,
  qui inspecte aussi les commandes shell. Par défaut seuls PDF et images sont
  protégés (`lib/protection.cjs`, `PROTECTED_EXTENSIONS`) : un `.docx` n'est
  jamais protégé, même s'il figure dans `.piecemaker/protection.json`.

## 2. Côté avocat — visionneuse / éditeur intégré

Ouvrir un `.docx` depuis l'arborescence affiche un éditeur Word complet
(`@eigenpal/docx-editor-react`, Apache-2.0, interface `fr`) au lieu du message
« Fichier binaire ».

| Fichier | Rôle |
| --- | --- |
| `src/piecemaker/docx/DocxDocumentViewer.tsx` | Éditeur, rechargement externe, enregistrement automatique |
| `src/piecemaker/docx/index.ts` | `DocxDocumentViewer`, `isDocxDocument` |
| `src/modules/code-editor/CodeEditor.tsx` | **Seul fichier CloudCLI touché** : import + une ligne de branchement, juste avant le rendu binaire |
| `server/piecemaker/docx-document.ts` | Version et sauvegarde avec `If-Match` |
| `server/modules/piecemaker-docx/` | Normalisation OOXML, lecture du mtime et écriture atomique |
| `server/piecemaker/index.ts` | Montage du routeur |

Fonctionnement :

- Lecture des octets par l'API CloudCLI existante (`api.readFileBlob`).
- Toutes les secondes, comparaison du `mtime` : si le fichier a changé sur
  disque (par exemple `docx-cli` côté assistant), l'éditeur se recharge.
- Après une frappe ou un clic de l'utilisateur, chaque `onChange` programme un
  enregistrement 800 ms plus tard. `save()` est sélectif par défaut : seules
  les parties modifiées de l'archive sont repackagées. Les sauvegardes sont
  sérialisées pour préserver l’ordre des écritures.
- Écriture atomique (fichier `.tmp` puis `rename`), 100 Mo maximum.
- La sauvegarde corrige l’attribut `w:csTheme` émis par l’éditeur en
  `w:cstheme`, conformément au schéma OOXML. Les autres parties du document
  sont conservées ; un fichier valide reste identique octet pour octet. Une
  archive illisible est refusée avant toute écriture sur le document existant.
- Route derrière `authenticateToken` (montage `/api/piecemaker`), limitée aux
  `.docx`, chemin résolu contre la racine du projet (même contrôle lexical que
  le file-tree CloudCLI).

### Question à l'assistant depuis un commentaire

Une case « Envoyer à Claude / Codex / Mistral » s'ajoute au formulaire de
commentaire quand un chat du même dossier est ouvert. Le choix est mémorisé.

| Fichier | Rôle |
| --- | --- |
| `src/piecemaker/docx/CommentQuestionSlots.tsx` | Case et réponse en cours, par portail dans le DOM de la librairie |
| `src/piecemaker/docx/useCommentQuestions.ts` | Envoi, suivi du tour, réponse dans le fil |
| `src/piecemaker/docx/commentQuestions.ts` | Stockage local, prompt, lecture du tour |
| `src/piecemaker/chat/useDocxCommentQuestions.ts` | Passage par le composeur du chat |
| `src/modules/chat/ChatInterface.tsx` | Un import et un appel de hook |

- La question passe par le composeur : même modèle, mêmes permissions, même file
  d'attente. Le chat refuse l'envoi si un message y attend déjà.
- Le prompt contient le passage commenté, son paragraphe et la question, sans
  consigne. L'assistant répond dans la session ; il n'a rien à écrire au document.
- Un script retrouve le tour par le texte du prompt, envoyé après la question. Le
  sondage a lieu toutes les 3 s, seulement tant qu'une question est en attente.
- `protect-originals.mjs` autorise sans demande, pour Claude, les lectures `docx`
  d'un document du dossier (`read`, `find`, `outline`, `wc`, `comments list`).
  Pendant une autre demande d'autorisation, la carte affiche seulement « répond… ».
- Pendant le tour, le texte partiel s'affiche dans la carte du commentaire. À la
  fin, le texte de l'assistant devient une réponse du fil, signée du fournisseur.
  Il est donc enregistré dans le `.docx` et visible dans Word.
- La question en attente survit à un rechargement (`localStorage`). Elle est
  oubliée après 7 jours si le document n'est pas rouvert.
- Une bannière signale un envoi refusé, une question non reçue après 10 min, une
  réponse vide ou une copie impossible. Le chat refuse aussi l'envoi pendant un
  travail en arrière-plan, pour ne pas ouvrir son dialogue à la place de l'avocat.
- Limites : pas de case sur une réponse dans un fil ; seul le texte de
  l'assistant est repris, sans les outils ; le Markdown reste brut.

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
4. **Enregistrements concurrents non sérialisés — corrigé dans l’éditeur intégré.**
   Une file d’attente sérialise désormais `save()` et le `PUT` correspondant.
   Les écritures par d’autres programmes restent indépendantes.
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
