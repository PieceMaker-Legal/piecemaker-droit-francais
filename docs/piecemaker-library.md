# Bibliothèque centrale

Le plugin Bibliothèque est développé dans `plugins/piecemaker-library/`, à la demande de l’utilisateur. Son installation copie uniquement ses fichiers exécutables dans le répertoire de plugins de l’application. Il utilise le slot `tab` et le RPC de CloudCLI. L’intégration hôte est limitée aux ajouts PieceMaker décrits ci-dessous. Deux lignes de CloudCLI sont touchées : l’isolation de son répertoire de plugins via `product.config.json`, avec repli sur `~/.claude-code-ui` lorsque cette configuration est absente, et `new Codex(options.libraryCodexOptions)` dans `codex-runtime.provider.ts` pour masquer dans Codex un skill désactivé dans un dossier (exception documentée dans `docs/upstream-cloudcli.md` §4, garde-fou `codex-options.test.ts`).

## Backend

`server/piecemaker/library/` possède une base SQLite distincte sous `PIECEMAKER_HOME/library-backend`. Les métadonnées, instructions et fichiers associés y sont centralisés. L’empreinte du contenu déduplique les copies identiques ; les origines restent enregistrées. Deux versions différentes restent deux entrées distinctes.

Un serveur interne sur une adresse de boucle locale et un port aléatoire expose uniquement le catalogue, les activations et les routes utiles aux MCP / marketplaces. Un jeton renouvelé à chaque démarrage protège cette interface. Le sous-processus du plugin, atteint par le RPC authentifié de CloudCLI, relaie les appels. Ni le jeton interne ni la base ne sont servis comme assets du plugin.

Le harnais de bibliothèque décore le service public des providers après le harnais de citations. Avant chaque message, il remet l’état du dossier d’aplomb (copies de la Bibliothèque, `skillOverrides` de Claude), ajoute les instructions de rôle des agents activés et masque ce complément dans l’écho utilisateur et l’historique affiché. Les skills ne sont pas joints aux messages : Claude, Codex, Cursor, Mistral et OpenCode les lisent dans le dossier. Les skills désactivés dans le dossier sont transmis aux runtimes (`libraryDisabledSkills`, `libraryCodexOptions`) : Codex les reçoit en `--config skills.config`, Mistral Vibe en `VIBE_DISABLED_SKILLS`. Une erreur de la Bibliothèque est journalisée et n’empêche jamais l’envoi. Le service des skills est aussi décoré : le popup du chat n’affiche pas les skills désactivés dans le dossier.

L’état d’un skill dans un dossier dépend de son origine : un skill personnel ou du dossier est activé par défaut et se désactive explicitement (table `deactivation`) ; un skill de la Bibliothèque seule, y compris ceux livrés par PieceMaker, est désactivé par défaut et s’installe à l’activation. Le manifeste `.piecemaker/library.json` du dossier fait foi pour tout ce que la Bibliothèque y a écrit. Règles détaillées, emplacements par provider et limites : `plugins/piecemaker-library/README.md`.

## Collecte

Au démarrage et à chaque « Actualiser », le backend recopie dans SQLite les skills personnels de chaque provider (dont `~/.claude/skills/synced`, `~/.claude/commands` et `~/.vibe/skills`), les skills de projet des dossiers connus (hors copies du manifeste), les agents, les MCP utilisateur, les plugins Claude installés et le connecteur Registre Public. Les originaux ne sont jamais déplacés ni modifiés. Un fichier invalide est signalé sans interrompre la collecte ; un skill supprimé de la Bibliothèque n’est plus réimporté (table `deleted_origins`).

## Limites de portée

Les skills désactivés ne sont pas copiés dans le dossier et sont masqués là où le provider le permet ; Cursor et OpenCode n’ont pas de réglage par dossier, et un provider lancé hors de PieceMaker voit encore les skills personnels. La base et les sauvegardes restent des fichiers de l’utilisateur : ce mécanisme n’est pas un sandbox interdisant toute lecture par un shell disposant des mêmes droits. Les copies vendorisées et les catalogues de plugins tiers restent leurs sources de livraison.

Une désactivation concerne les prochains messages ; elle ne retire pas les contenus déjà présents dans un transcript. L’activation des MCP et plugins existants conserve leurs règles de portée et peut nécessiter une nouvelle session du provider.

## Frontend

Le plugin possède sa liste et ses onglets. `src/piecemaker/library/` monte le composant natif `EditorSidebar` de CloudCLI dans un volet redimensionnable à droite de la liste, sans écrire de document dans le dossier ni utiliser le chat. Le contenu est fermé au démontage du plugin et à l'expiration de l'authentification. Un adaptateur en mémoire fournit le document à l'éditeur ; les lectures des fichiers ordinaires conservent leur transport habituel. Le téléchargement et l'aperçu Markdown natifs sont disponibles. Enregistrer (ou Ctrl/Cmd+S) sauvegarde le document dans le catalogue et actualise ses métadonnées YAML, sans changer ses activations. Une vérification de la version précédente empêche d'écraser une modification concurrente. Les fichiers associés restent conservés séparément du document principal.

La navigation sépare quatre types d'objets lus depuis SQLite : Connecteurs, Skills, Plugins et Agents. Un objet n'apparaît que dans un onglet. Les MCP autonomes (Registre Public, serveurs utilisateur) sont des Connecteurs ; une skill ou un agent autonome va dans Skills ou Agents ; un paquet installé, y compris son MCP, ses skills et ses agents, reste un Plugin. Un toggle installe l'élément dans le dossier pour tous les providers.
