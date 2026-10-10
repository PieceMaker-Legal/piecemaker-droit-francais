# Historique Git du dossier

Chaque dossier est versionné dans un dépôt Git **local** (`.git` à la racine du dossier). Aucun remote n'est ajouté, et rien n'est jamais poussé, récupéré ou publié. L'avocat n'a rien à configurer : les commits sont faits en arrière-plan par le serveur, et l'historique s'affiche dans l'onglet Contrôle de source.

Code : `server/piecemaker/folder-history/`. Branchement : une option `folderHistory` du harnais de chat (`harness/chat-harness.ts`) et la publication des projets (`index.ts`). Aucun fichier CloudCLI n'est modifié.

## Commits produits

| Déclencheur | Sujet | Corps |
|---|---|---|
| Premier passage sur un dossier sans `.git` | `État initial du dossier` | — |
| Fin d'un tour Claude ou Codex non aborté qui a modifié des fichiers | demande de l'utilisateur (une ligne, 72 caractères au maximum) | conclusion de l'IA sans `<CITATIONS>` (4 000 caractères au maximum) |
| Début d'un tour, si des modifications non commitées existent | `Modifications hors IA` | liste `A/M/D chemin` (200 lignes au maximum) |
| Modification faite par l'avocat (Word, Finder, éditeur), après 2 min sans nouvelle écriture | `Modifications hors IA` | idem |
| 30 s après le démarrage du serveur, pour les dossiers déjà versionnés | `Modifications hors IA` | idem (ce qui a été fait app fermée) |

Auteur : `PieceMaker <commits@piecemaker.local>`. Cette identité est imposée par variables d'environnement, ce qui rend les réglages Git inutiles. Les options `commit.gpgsign=false` et `--no-verify` sont appliquées à chaque commit.

## Performance

- `begin` et `end` sont synchrones et ne font que de la tenue de compte en mémoire : le chat n'attend jamais Git.
- Une file globale garantit qu'un seul processus `git` tourne à la fois, tous dossiers confondus. Ce processus est lancé en priorité basse. Une tâche « hors IA » déjà en attente pour un dossier n'est pas dupliquée.
- La surveillance passe par `fs.watch` récursif, notifié par l'OS (FSEvents, ReadDirectoryChangesW), avec un seul watcher par dossier et aucun parcours de l'arborescence. Le coût est nul quand rien ne bouge. La liste des dossiers n'est relue que lorsque la publication des projets (cycle existant de `project-registry.ts`) détecte un changement.
- Les options `core.untrackedCache` et `core.preloadIndex` sont activées : `git add -A` ne relit que les fichiers modifiés.

## Ce qui n'est jamais versionné

Le bloc PieceMaker de `.git/info/exclude` est invisible pour l'avocat ; aucun `.gitignore` n'est créé. Il exclut :
- les dossiers `.piecemaker/`, `.claude/`, `.codex/`, `.cursor/`, `.grok/`, `.opencode/`, `.vibe/`, `.agents/` et `node_modules/` ;
- les fichiers `mapping*.json`, `*_sensitive_map.json`, `.env*` et `*.env`, les verrous Word et LibreOffice (`~$*`, `.~lock.*`), `*.lock`, `*.tmp` et `.DS_Store`.

Si un fichier sensible (mapping, `.env`, `.piecemaker/`) est déjà suivi, le dossier n'est pas versionné et un avertissement est logué.

## Dossiers laissés tranquilles

- Dossier situé à l'intérieur d'un dépôt Git parent.
- Dépôt Git déjà présent mais créé hors PieceMaker (pas de bloc PieceMaker dans `info/exclude`), par exemple un projet de code ouvert dans l'app.
- `git` absent, ou `.git/index.lock` présent : la tâche est abandonnée, et la suivante rattrapera le retard.

Toute erreur est loguée puis ignorée (fail-open).

## Retour arrière par l'IA

L'IA utilise Git en shell, sans outil MCP. La skill `historique-dossier` (`vendor/piecemaker-plugin/skills/`) lui indique `git log`, `git diff`, `git show <sha>:fichier.md` et `git restore --source <sha> -- fichier`. Elle lui interdit `reset`, `rebase`, `switch`, `stash`, `clean`, les commits manuels et tout remote.

Dans un dossier au bouclier vert, `protect-originals.mjs` refuse les commandes Git qui feraient sortir le contenu d'un objet :
- les sous-commandes `cat-file`, `archive`, `bundle`, `fast-export` et `format-patch` ;
- les options `-a`, `--text`, `--binary`, `--textconv` et `--ext-diff` ;
- tout argument `rev:chemin` qui vise une pièce protégée, un mapping ou un secret.

## Limites connues

- Une modification faite par l'avocat *pendant* un tour IA est rangée dans le commit de ce tour.
- Si l'IA écrit dans les toutes premières millisecondes d'un tour, alors qu'un commit « hors IA » est en cours, ce fichier peut se retrouver dans ce commit.
- Claude Code injecte en début de session les derniers sujets de commit (`gitStatus`). Ce contexte passe par hudsucker comme le reste du prompt.
- Restaurer une pièce protégée (PDF, image) par `git restore` reste refusé par le contrôle de chemins préexistant du hook. Seuls les fichiers lisibles par l'IA se restaurent.
- Le dépôt grossit d'une copie complète à chaque version d'un `.docx` ou d'un PDF. Un `.git` placé dans un dossier synchronisé (iCloud, OneDrive) peut se corrompre.
