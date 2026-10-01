# Bibliothèque PieceMaker

Plugin CloudCLI autonome : une bibliothèque de skills et de plugins, une liste d’agents, les MCP du dossier et les marketplaces Legal / Anthropic existantes. Les titres et descriptions viennent du frontmatter YAML. Le contenu complet est demandé uniquement à l’ouverture du document.

Les onglets Connecteurs, Skills, Plugins et Agents lisent le catalogue SQLite. Chaque plugin expose toute son arborescence importée ; les fichiers texte peuvent être ouverts et enregistrés dans l’éditeur natif. Un MCP, une skill ou un agent livré par un plugin reste dans cet onglet Plugins.

## Installation locale

Avec Node 22 ou plus récent, depuis `plugins/piecemaker-library/` :

```sh
node install.mjs /chemin/vers/piecemaker-droit-francais
```

Le plugin est copié dans le répertoire de plugins déterminé par `product.config.json` de PieceMaker, avec priorité à `CLOUDCLI_HOME`. Il nécessite le module `server/piecemaker/library` et le pont de visionneuse `src/piecemaker/library` de PieceMaker. Sur CloudCLI sans ces extensions, le backend de bibliothèque n’est pas disponible.

La source du plugin est versionnée dans `plugins/piecemaker-library/` du dépôt PieceMaker. Relancer l’installation après une modification locale. Aucun dépôt distant n’est requis pour cette installation.

## Données et activation

- Le catalogue appartient au backend PieceMaker hébergé dans CloudCLI : `~/.piecemaker/library-backend/catalog.sqlite` (ou `PIECEMAKER_HOME`). La désinstallation de l’application le conserve.
- Rien n’est retiré des providers : les skills, agents et MCP personnels sont copiés au catalogue et restent où ils sont. Une ligne « Actif partout · Claude, Codex… » signale ceux qu’un provider charge déjà dans tous les dossiers.
- Les skills et agents livrés par PieceMaker (`server/piecemaker/vendor/piecemaker-plugin`) sont activés une fois dans chaque nouveau dossier, puis se retirent comme les autres. Tout le reste est désactivé au départ.
- Activer un élément l’écrit **dans le dossier**, en fichiers standards lisibles sans PieceMaker :
  - skill : copie réelle dans `.agents/skills/<nom>/` (lu par Codex, Cursor, OpenCode et Mistral Vibe), reliée par liens relatifs à `.claude/skills`, `.cursor/skills`, `.opencode/skills` et `.grok/skills` ;
  - agent : `.claude/agents/<nom>.md`, `.codex/agents/<nom>.toml`, `.vibe/agents/<nom>.toml`, `.opencode/agent/<nom>.md`, `.grok/agents/<nom>.md` ;
  - MCP : `.mcp.json`, `.codex/config.toml`, `.vibe/config.toml`, `.cursor/mcp.json`, `opencode.json`, `.grok/config.toml`.
- `<dossier>/.piecemaker/library.json` recense ce que la Bibliothèque a écrit, avec l’empreinte de chaque fichier. C’est lui qui fait foi : un catalogue reconstruit retrouve les activations du dossier, et un fichier retouché à la main n’est ni écrasé ni supprimé (« Composant personnel préservé »).
- Un plugin Claude Code s’active par dossier avec le mécanisme natif : `enabledPlugins` dans `<dossier>/.claude/settings.local.json`. Claude charge alors le plugin entier (hooks, LSP, commandes) dans ce seul dossier ; les autres providers reçoivent ses skills, agents et MCP. L’interrupteur « Partout » bascule le réglage global de `~/.claude/settings.json`, sans jamais modifier un dossier.
- Une acquisition depuis la marketplace installe le plugin désactivé globalement : il ne devient actif que là où il est activé.
- Codex ne lit `.codex/config.toml` et Mistral Vibe ne lit `.vibe/` que dans un dossier de confiance. PieceMaker lance Vibe avec `--trust` ; pour Codex, la confiance se règle dans Codex.
- La visionneuse réutilise le volet natif `EditorSidebar` de CloudCLI, avec édition et enregistrement direct dans le catalogue. Les métadonnées YAML sont actualisées à chaque sauvegarde et les modifications concurrentes sont détectées.
- Les instructions des skills et agents actifs sont aussi jointes aux prochains messages. Une désactivation ne supprime pas celles déjà reçues dans l’historique d’une conversation : commencer une nouvelle session pour repartir sans ce contexte.

La Bibliothèque ne constitue pas un confinement système : un processus local disposant des mêmes droits que l’utilisateur peut lire les données backend.

## Validation

```sh
npm install --ignore-scripts
npm test
```

Les tests couvrent le chargement des métadonnées, l’ouverture explicite, l’activation limitée au dossier, les interrupteurs de plugin par dossier et global, et les réponses arrivant après un changement de dossier.
