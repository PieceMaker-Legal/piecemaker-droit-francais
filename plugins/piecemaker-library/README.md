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

## Collecte

- Au démarrage et à chaque « Actualiser », la bibliothèque recopie dans son catalogue les skills, agents et MCP trouvés sur l’ordinateur, **sans jamais déplacer, modifier ni supprimer les originaux** :
  - skills personnels vus par Claude, Codex, Cursor, OpenCode et Mistral Vibe (`~/.claude/skills`, `~/.claude/skills/synced`, `~/.claude/commands`, `~/.agents/skills`, `~/.codex/skills`, `~/.cursor/skills`, `~/.config/opencode/skills`, `~/.vibe/skills`, `~/.grok/skills`) ;
  - skills de projet de chaque dossier connu de PieceMaker (hors liens posés par la bibliothèque elle-même) ;
  - agents, MCP et plugins Claude installés.
- Un fichier illisible n’interrompt pas la collecte : il est listé dans l’interface après « Actualiser ».
- Un élément supprimé de la bibliothèque n’est plus réimporté ; son original reste en place.
- Un élément modifié dans la bibliothèque garde sa version modifiée ; il n’est plus remplacé par l’original.

## Données et activation

- Le catalogue appartient au backend PieceMaker hébergé dans CloudCLI : `~/.piecemaker/library-backend/catalog.sqlite` (ou `PIECEMAKER_HOME`).
- Les skills, plugins, agents et MCP importés sont désactivés au départ. Un toggle persiste une activation pour le chemin canonique du dossier. Le backend matérialise l’élément dans `library-backend/active/` et le relie au dossier :
  - skills : `.claude/skills/<nom>` (Claude Code) et `.agents/skills/<nom>` (Codex, Cursor, OpenCode, Mistral Vibe), plus `.grok/skills/<nom>` ;
  - agents : `.claude/agents`, `.codex/agents`, `.opencode/agent`, `.grok/agents`.
  Les noms de dossiers suivent la spec Agent Skills (minuscules, chiffres, tirets). Un composant personnel déjà présent sous le même nom est conservé et signalé ; les autres providers sont quand même installés. Dans un dépôt git, les liens sont ajoutés à `.git/info/exclude`.
- **Sélection par dossier.** Dès qu’un skill est activé dans un dossier, seuls les skills activés y apparaissent dans le popup du chat : les skills personnels non sélectionnés y sont masqués, pour tous les providers. Pour Claude Code, ils sont aussi masqués nativement via `skillOverrides` dans `.claude/settings.local.json` ; la bibliothèque ne retire que les clés qu’elle a écrites. Codex, Cursor, OpenCode et Mistral n’ont que des réglages globaux : leur CLI lancée hors de PieceMaker voit encore les skills personnels.
- Claude Code exécute la version personnelle d’un skill quand un skill personnel et un skill de projet portent le même nom. La bibliothèque le signale quand une copie modifiée risque d’être ignorée.
- Les providers qui lisent nativement les skills du dossier (Claude, Codex, Cursor, OpenCode) ne reçoivent rien de plus dans leurs messages. Les autres reçoivent un index court (nom, description, chemin du `SKILL.md`), jamais le contenu complet. Les instructions d’agents sont des rôles transmis au modèle, sans création automatique de sous-processus agent.
- Les fichiers associés sont conservés dans la base, puis matérialisés uniquement pour les éléments activés. La désactivation retire cette copie active et les liens posés dans le dossier.
- Le connecteur Registre Public (`https://registre-public.com/api/mcp`) est versé dans le catalogue. Il s’installe dans le dossier, pour tous les providers, uniquement lorsqu’il est activé.
- La visionneuse réutilise le volet natif `EditorSidebar` de CloudCLI, avec édition et enregistrement direct dans le catalogue. Les métadonnées YAML sont actualisées à chaque sauvegarde et les modifications concurrentes sont détectées. Elle ne crée aucun fichier dans le dossier et ne transmet rien au chat.
- Une acquisition depuis la marketplace garde le plugin natif désactivé globalement, importe ses skills, agents et MCP dans une collection éditable et laisse la bibliothèque assurer leur activation multi-provider par dossier. « Actualiser » ne modifie jamais les activations.
- Une désactivation ne supprime pas les instructions déjà reçues dans l’historique d’une conversation. Commencer une nouvelle session pour repartir sans ce contexte.

Le masquage ne constitue pas un confinement système : un processus local disposant des mêmes droits que l’utilisateur peut lire les données backend et les skills personnels. Le plugin ne promet pas une isolation système des sessions.

## Validation

```sh
npm install --ignore-scripts
npm test
```

Les tests du plugin (`index.test.mjs`, jsdom) et du backend (`server/piecemaker/library/tests/`, `npx tsx --tsconfig server/tsconfig.json --test server/piecemaker/library/tests/*.test.ts` depuis la racine) couvrent la collecte, l’activation par dossier, le masquage dans le popup et dans Claude Code, et l’interface. Comme les autres tests PieceMaker, ils ne sont pas versionnés (voir `.gitignore`).
