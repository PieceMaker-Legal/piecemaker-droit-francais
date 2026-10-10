# Bibliothèque PieceMaker

Plugin CloudCLI autonome : une bibliothèque de skills et de plugins, une liste d’agents, les MCP du dossier et les marketplaces Legal / Anthropic existantes. Les titres et descriptions viennent du frontmatter YAML. Le contenu complet est demandé uniquement à l’ouverture du document.

Les onglets Connecteurs, Skills, Plugins et Agents lisent le catalogue SQLite. Chaque plugin expose toute son arborescence importée ; les fichiers texte peuvent être ouverts et enregistrés dans l’éditeur natif. Un MCP, une skill ou un agent livré par un plugin reste dans cet onglet Plugins.

## Installation

Comme tous les plugins PieceMaker : compilé et installé par la chaîne commune `plugins/toolchain`, embarqué dans l'application Electron et réinstallé à chaque démarrage si besoin. Depuis le dépôt : `npm run plugins`. Voir `docs/plugins.md`.

## Collecte

- Au démarrage et à chaque « Actualiser », la Bibliothèque recopie dans son catalogue les skills, agents et MCP trouvés sur l’ordinateur, **sans jamais déplacer, modifier ni supprimer les originaux** :
  - skills personnels (`~/.claude/skills`, `~/.claude/skills/synced`, `~/.claude/commands`, `~/.agents/skills`, `~/.codex/skills`, `~/.cursor/skills`, `~/.config/opencode/skills`, `~/.vibe/skills`, `~/.grok/skills`) ;
  - skills de projet de chaque dossier connu de PieceMaker, hors copies posées par la Bibliothèque (celles du manifeste `.piecemaker/library.json`) ;
  - agents, MCP et plugins Claude installés.
- Un fichier illisible n’interrompt pas la collecte : il est listé dans l’interface après « Actualiser ».
- Un skill supprimé de la Bibliothèque n’est plus réimporté ; son original reste en place.
- Un élément modifié dans la Bibliothèque garde sa version modifiée ; il n’est plus remplacé par l’original.

## Données et activation

- Le catalogue appartient au backend PieceMaker hébergé dans CloudCLI : `~/.piecemaker/library-backend/catalog.sqlite` (ou `PIECEMAKER_HOME`). La désinstallation de l’application le conserve.
- Rien n’est retiré des providers : les skills, agents et MCP personnels sont copiés au catalogue et restent où ils sont. Une ligne « Actif partout · Claude, Codex… » signale ceux qu’un provider charge déjà dans tous les dossiers.
- **Skills personnels et skills du dossier : activés par défaut.** L’interface affiche, pour le dossier ouvert, l’état réel de chaque skill et son origine (Personnel, Dossier, Bibliothèque). « Activé » signifie disponible pour tous les providers : quand un provider ne lit pas le répertoire personnel d’origine, la Bibliothèque pose une copie dans le dossier — dans `.agents/skills/<nom>` (et ses liens hors `.claude`) pour un skill de `~/.claude`, dans `.claude/skills/<nom>` seulement pour un skill de `~/.agents/skills`, partout pour un skill d’un autre répertoire personnel. Rien n’est copié pour un skill du dossier, ni dans le répertoire personnel lui-même.
- **Désactiver** un skill personnel ou du dossier le masque pour ce dossier seulement : dans le popup du chat (tous providers), dans Claude Code (`skillOverrides` dans `.claude/settings.local.json` ; la Bibliothèque ne retire que les clés qu’elle a écrites), dans Codex (réglage de session `--config skills.config`, par chemin du `SKILL.md`) et dans Mistral Vibe (variable `VIBE_DISABLED_SKILLS`, par nom ; sans effet si `enabled_skills` est défini dans la config Vibe de l’utilisateur). Cursor et OpenCode n’ont pas de réglage par dossier ; Codex et Vibe lancés hors de PieceMaker voient encore le skill. Le réactiver revient à l’état par défaut.
- **Skills de la Bibliothèque seule** (créés dans la Bibliothèque, venus d’un autre projet ou d’un plugin) : désactivés par défaut, installés dans le dossier à l’activation. Agents et MCP sont aussi désactivés au départ. Les MCP `piecemaker` et `legifrance`, et le skill `docx-cli`, sont déclarés dans chaque dossier par le serveur, hors de cette activation.
- L’état du dossier est remis d’aplomb avant chaque message et à l’ouverture du popup : copies manquantes ou périmées réécrites, copies devenues inutiles retirées.
- Les noms de dossiers suivent la spec Agent Skills (minuscules, chiffres, tirets).
- Claude Code exécute la version personnelle d’un skill quand un skill personnel et un skill de projet portent le même nom : la Bibliothèque le signale quand une copie modifiée risque d’être ignorée.
- Activer un élément l’écrit **dans le dossier**, en fichiers standards lisibles sans PieceMaker :
  - skill : copie réelle dans `.agents/skills/<nom>/` (lu par Codex, Cursor, OpenCode et Mistral Vibe), reliée par liens relatifs à `.claude/skills`, `.cursor/skills`, `.opencode/skills` et `.grok/skills` ;
  - agent : `.claude/agents/<nom>.md`, `.codex/agents/<nom>.toml`, `.vibe/agents/<nom>.toml`, `.opencode/agent/<nom>.md`, `.grok/agents/<nom>.md` ;
  - MCP : `.mcp.json`, `.codex/config.toml`, `.vibe/config.toml`, `.cursor/mcp.json`, `opencode.json`, `.grok/config.toml`.
- `<dossier>/.piecemaker/library.json` recense ce que la Bibliothèque a écrit, avec l’empreinte de chaque fichier. C’est lui qui fait foi : un catalogue reconstruit retrouve les activations du dossier, et un fichier retouché à la main n’est ni écrasé ni supprimé (« Composant personnel préservé »).
- Un plugin Claude Code s’active par dossier avec le mécanisme natif : `enabledPlugins` dans `<dossier>/.claude/settings.local.json`. Claude charge alors le plugin entier (hooks, LSP, commandes) dans ce seul dossier ; les autres providers reçoivent ses skills, agents et MCP. L’interrupteur « Partout » bascule le réglage global de `~/.claude/settings.json`, sans jamais modifier un dossier.
- Une acquisition depuis la marketplace installe le plugin désactivé globalement : il ne devient actif que là où il est activé.
- Codex ne lit `.codex/config.toml` et Mistral Vibe ne lit `.vibe/` que dans un dossier de confiance. PieceMaker lance Vibe avec `--trust` ; pour Codex, la confiance se règle dans Codex.
- La visionneuse réutilise le volet natif `EditorSidebar` de CloudCLI, avec édition et enregistrement direct dans le catalogue. Les métadonnées YAML sont actualisées à chaque sauvegarde et les modifications concurrentes sont détectées.
- Les skills ne sont pas joints aux messages : tous les providers les lisent dans le dossier. Les instructions des agents actifs sont jointes aux prochains messages. Une désactivation ne supprime pas celles déjà reçues dans l’historique d’une conversation : commencer une nouvelle session pour repartir sans ce contexte.

La Bibliothèque ne constitue pas un confinement système : un processus local disposant des mêmes droits que l’utilisateur peut lire les données backend.

## Validation

```sh
npm install --ignore-scripts
npm test
```

Les tests couvrent le chargement des métadonnées, l’ouverture explicite, l’activation limitée au dossier, l’origine et l’avertissement de version personnelle, les éléments non importés, les interrupteurs de plugin par dossier et global, et les réponses arrivant après un changement de dossier. Les tests du backend sont dans `server/piecemaker/library/*.test.ts` (`npm test` depuis la racine).
