# Library de l'agent central

La Library réunit, au niveau de l'agent central seulement, le fonds de rédaction du cabinet et ce que les dossiers produisent. Rien n'y est écrit par le modèle : tout ce qui est généré l'est par du code statique, à chaque lecture.

## Contenu

| Dossier du bundle | Contenu | Source |
| --- | --- | --- |
| `domains/`, `templates/`, `guidelines/`, `assets/` | Le dépôt Legal-OKF (`PieceMaker-Legal/Legal-OKF`) | Clone local dans `<brain>/Library/` |
| `clients/` | Une fiche `type: Client` par partie cliente (`side: client`) des fiches `persons/` de chaque dossier du brain | Généré |
| `projects/` | Une fiche `type: Projet` par artifact docx (`document` de `artifact.json`) de chaque dossier du brain | Généré, sauf la section `## Liens` |

Les dossiers sont ceux de l'index du brain (`<brain>/.piecemaker/dossiers.json`). Une fiche générée porte `generated.by: library` ; elle disparaît quand sa source disparaît. Une fiche sans cette marque (faite à la main, ancien exemple) est gardée. Les anciens `exemples/` (`type: Exemple`) deviennent des `projects/` (`type: Projet`) et les liens du bundle sont réécrits. Le `index.md` racine reçoit les liens vers `clients/index.md` et `projects/index.md` s'ils manquent.

## Relier un projet

Un projet est relié à un template ou une guideline par une ligne `- [Titre](/templates/x.md)` sous `## Liens` de sa fiche. L'agent la pose au fur et à mesure (skill `library` du brain) ; l'avocat attache ou détache un projet dans la vue. La régénération garde ces lignes.

## Clone

`GET /api/piecemaker/legal-okf` clone le dépôt au premier affichage (une tentative par démarrage), avec les identifiants git de l'ordinateur. Le bouton de mise à jour lance `git pull --ff-only` : une guideline modifiée localement n'est jamais écrasée ; en cas de divergence, l'erreur de git s'affiche. Dépôt et branche : `~/.piecemaker/legal-okf.json` (`repository`, `branch`) ou `PIECEMAKER_LEGAL_OKF_REPO`, `PIECEMAKER_LEGAL_OKF_BRANCH`.

## Vue

Onglet Library du volet de l'agent central. Liste : templates par domaine, avec leurs projets attachés (attacher, détacher) et leurs guidelines (Modifier ouvre le fichier entier, 500 lignes au plus, frontmatter obligatoire). Les guidelines d'un template sont celles qu'il lie ou qui le lient, et celles de la même ligne d'un tableau de domaine. Graphe : tous les concepts et leurs liens Markdown, coloré par type ; un clic montre la fiche.

## Routes

Sous `/api/piecemaker/legal-okf` : `GET /` (génère puis lit), `POST /sync`, `GET /concept?id=`, `PUT /concept` `{ id, content }` (guidelines, templates, domaines, projets), `PUT /link` `{ project, target, attach }`.

## Fichiers

| Rôle | Fichier |
| --- | --- |
| Clone et mise à jour | `server/piecemaker/legal-okf/source.ts` |
| Génération `clients/`, `projects/` | `server/piecemaker/legal-okf/generate.ts` |
| Graphe, liste, édition, liens | `server/piecemaker/legal-okf/read.ts` |
| Routes | `server/piecemaker/legal-okf/index.ts` |
| Vue | `src/modules/piecemaker-workspace-tabs/agent/Library.tsx`, `LibraryGraph.tsx`, `libraryApi.ts` |
| Skill de l'agent central | `server/piecemaker/vendor/brain/skills/library/SKILL.md` |
