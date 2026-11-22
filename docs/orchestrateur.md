# Orchestrateur de projet

Reproduction dans PieceMaker du fonctionnement de Claude Projects, pour le travail juridique d'un avocat : un chat de projet tenu par un **orchestrateur**, qui délègue chaque travail de fond à un **fil** (thread). Chaque fil est une session CloudCLI ordinaire (même chat, streaming, outils, autorisations, copie Markdown), sur Claude, Codex ou Mistral selon les providers connectés. Il n'y a ni code ni dépôt ni PR côté avocat : les résultats sont des **livrables** du dossier.

L'interface est intégrée directement aux composants CloudCLI (choix explicite de l'utilisateur, exception à « Add, don't edit ») : bouton natif du panneau de gauche, chat CloudCLI ordinaire, volet de droite natif. Fichiers upstream touchés : `src/modules/sidebar/SidebarProjectSessions.tsx`, `src/shared/types.ts` (`AppTab` `agent`), locales `en`/`fr` (`sidebar.json`, `common.json`), `server/modules/websocket/services/chat-websocket.service.ts` (`displayContent` de `runDetachedChatTurn`).

## Carte des fichiers

| Fichier | Rôle |
|---|---|
| `server/modules/piecemaker-orchestrateur/types.ts` | Modèle de données (état du projet, fils, messages, décisions, livrables, minuteries, dépendances injectées). |
| `server/modules/piecemaker-orchestrateur/prompt.ts` | Règles de l'orchestrateur et des fils, format des wakes, préambule et reprise à froid. |
| `server/modules/piecemaker-orchestrateur/store.ts` | Lecture/écriture atomique de l'état et de la mémoire d'un dossier. |
| `server/modules/piecemaker-orchestrateur/service.ts` | Cœur : wakes, minuteries, fils, autorisations, outils. Toutes les dépendances sont injectées (`OrchestratorDependencies`). |
| `server/modules/piecemaker-orchestrateur/routes.ts` | Routes authentifiées de l'interface et route locale (boucle locale) des MCP. |
| `server/modules/piecemaker-orchestrateur/index.ts` | Exports. |
| `server/modules/piecemaker-orchestrateur/tests/*.test.ts` | Tests `node:test` avec dépendances simulées (modèle : `server/modules/piecemaker-suivi/tests/taches.test.ts`). |
| `server/piecemaker/index.ts` | Câblage : dépendances réelles, montage des routes. |
| `server/piecemaker/vendor/mcp/orchestrateur/server.mjs` | MCP des outils de l'orchestrateur. |
| `server/piecemaker/vendor/mcp/fil/server.mjs` | MCP des outils d'un fil. |
| `server/piecemaker/vendor/mcp/orchestrateur/client.mjs` | Client commun : appelle `POST /api/piecemaker/local/orchestrateur/call` sur la boucle locale (découverte du port comme `vendor/installer/lib/conversion-client.mjs`). |
| `server/piecemaker/mcp-declaration.ts` | `orchestrateur` et `fil` ajoutés à `BUNDLED_SERVERS`. |
| `server/piecemaker/orchestrator-runtime.ts` | Enregistre les messages du compositeur et sert les pages d’historique du chat depuis l’état du dossier. |
| `src/modules/sidebar/SidebarCentralAgentButton.tsx` | Bouton « PieceMaker Agent central » en tête de la liste des dossiers (`SidebarProjectList`, qui retire de la liste le dossier propre de l'agent central) : `POST /central/session` puis sélection de la session. |
| `src/modules/piecemaker-workspace-tabs/agent/useCentralAgent.ts` | `GET /central` une fois par page : chemin, projet et session de l'agent central. |
| `src/modules/sidebar/SidebarAgentButton.tsx` | Bouton natif « PieceMaker Agent » au-dessus de « Nouvelle session » : `POST /session` puis sélection de la session comme un clic du panneau. |
| `src/modules/sidebar/SidebarTabularReviewButton.tsx` | Bouton natif « Analyse Tabulaire » sous « Nouvelle session » (dossiers protégés, remplace l'injection DOM du plugin). |
| `src/modules/piecemaker-workspace-tabs/agent/` | Client des routes, état (`GET /state` toutes les 2 s), `useAgentSession` (la session courante est-elle l'agent du dossier ?), `AgentPanel` (onglets) et `AgentCards` (décisions, autorisations, widgets, connexions à traiter). |
| `src/modules/piecemaker-workspace-tabs/WorkspacePanels.tsx`, `WorkspaceIconTabs.tsx` | Volet `agent` des volets de droite, ouvert par défaut dans la session de l'agent ; bouton `PanelRight` dans la barre d'icônes du haut, visible seulement dans cette session. |

## Agent central (multi-dossiers)

Un agent placé au-dessus des dossiers, sur le modèle exact de Claude Projects : un chat de coordination, des fils lancés et suivis par lui, chaque fil travaillant dans un seul dossier choisi par l'avocat. C'est le même service, la même interface et les mêmes outils que l'agent d'un dossier ; seules changent les règles ci-dessous (`central` dans `projectService`).

- **Dossier propre** : `<CLOUDCLI_HOME>/PieceMaker Agent` (`centralRoot` des dépendances, câblé dans `server/piecemaker/index.ts`). Son état est dans `.piecemaker/orchestrateur/` comme pour un dossier. La session de chat y étant créée, CloudCLI l'enregistre comme projet : il passe ainsi par le proxy d'anonymisation (dictionnaire commun à tous les dossiers), mais il est retiré de la liste des dossiers du panneau gauche et des `approvedFolders` de l'orchestrateur.
- **Dossiers choisis** : `settings.folders` ne contient que des dossiers CloudCLI (chemin ou nom unique, tout autre est refusé). L'avocat les coche dans Paramètres › « Dossiers de l'agent central » ; l'agent ne peut que demander (`start_thread` sur un dossier non coché → carte d'accès, le fil attend l'accord). Le dossier propre de l'agent n'est jamais un dossier de travail.
- **Un fil, un dossier** : `start_thread` exige `folder` (pris dans `list_devices`, qui liste les dossiers avec `allowed`). La session du fil est créée dans ce dossier, donc rangée dans son panneau à côté des sessions de l'avocat. Le premier message du fil fixe son dossier et lui interdit les autres. Le blocage technique est le hook `cloisonnement` (voir ci-dessous), pour Claude, Codex, Mistral et Vibe ; Claude reçoit en plus des règles `Read(//<autre dossier>/**)` et `Edit(//<autre dossier>/**)` dans `disallowedTools`. Les livrables sont relatifs au dossier du fil.
- **Cloisonnement** (`vendor/piecemaker-plugin/scripts/cloisonnement.mjs`, PreToolUse) : toute session dont le répertoire de travail est dans un dossier (publié dans `~/.piecemaker/projects.json`) se voit refuser lecture, écriture, recherche et commande shell visant un autre dossier. Seule exception : le dossier partagé de l'agent central (`.piecemaker/orchestrateur/fichiers` du dossier marqué `.piecemaker/agent-central`). L'agent central lui-même ne lit aucun dossier : il passe par un fil. Branché dans `hooks.json` (Claude), `codex-skills.mjs` (Codex, `Bash` et `apply_patch`), `vibe-hooks.mjs` (Vibe) et `mistral-sdk/tools.ts` (chat Mistral). Limite : pour le shell, seuls les chemins écrits dans la commande sont vus ; un chemin construit à l'exécution (variable, sous-commande) échappe au hook.
- **Wakes** : un événement de fil porte `folder`. Le préambule ajoute `CENTRAL_RULES` (`prompt.ts`) et la liste des dossiers choisis.
- **Routes** : `GET /central` → `{ project, projectId, sessionId }` ; `POST /central/session` → crée la session si besoin et renvoie aussi `provider`. Les autres routes acceptent `project` = dossier propre de l'agent central.
- **Volet** : `state.central` et `state.dossiers` ; l'onglet Fils regroupe les fils par dossier.

### Brain

L’agent central s’ouvre dans le brain (`server/piecemaker/brain.ts`). L’avocat en choisit l’emplacement dans Paramètres › Brain (`PUT /central/brain`, enregistré dans `~/.piecemaker/brain.json`, par défaut `<CLOUDCLI_HOME>/PieceMaker Agent`) ; un dossier juridique est refusé. Changer l’emplacement déplace tout le brain (profil, skills, paires des dossiers, index `dossiers.json`, état de l’orchestrateur) : `brain.move` renomme le dossier, ou le copie liens compris puis efface l’ancien s’il change de disque ; il refuse un dossier non vide, et un emplacement dans l’ancien brain ou qui le contient. À l’ouverture, le brain reçoit :
- `AGENTS.md`, lien vers `~/.piecemaker/custom/perso.md` (copie sous Windows si le lien échoue) : le profil reste lu par les agents de dossier comme avant ; `CLAUDE.md` ne contient que `@AGENTS.md` ;
- `projects/<nom du dossier>/` : la paire du dossier, rien d’autre que `About.md` (prose : statut, stratégie, décisions, une section « ## Mémoire : <nom> » par acte), `Roadmap.json` (données : `suivis` par acte, `etapes` réglées par l’avocat, `synthese`) et le script `synthese.mjs`. Le nom vient de l’index `<brain>/.piecemaker/dossiers.json` (chemin réel → nom, suffixe « (2) » si deux dossiers portent le même nom). Le moteur de suivi, le Matter board, `pm`, la vue Feature `case` et le Hérisson lisent et écrivent cette paire dès qu’un brain est configuré (`vendor/piecemaker-plugin/scripts/lib/brain-case.mjs`, `modules/piecemaker-suivi/case-store.ts`) ; sans brain, ils gardent les fichiers `.piecemaker/` du dossier. Au premier accès, les anciens `*-suivi.json`, `etapes.json` et `memoires/*.md` du dossier y sont importés puis renommés `.migre`.
- Pas de doublon : les parties restent dans la base du dossier (le Matter board les y lit ; `matter.client` et `matter.parties` sont refusés dans un suivi du brain) et un événement daté par une prémisse de l’index y renvoie (`evenements.<nom>.okf`, la date et sa preuve sont relues dans l’OKF).
- `synthese.mjs` : script visible, modifiable par l’agent, lancé par `pm check`. Il reçoit les points du bilan et un `pm` pour interroger la base, et son résultat (état des parties et de l’index : `valide` ou `à exécuter : …`) est écrit sous `synthese` dans `Roadmap.json`. L’agent ne peut écrire ni `synthese` ni `etapes` à la main (Hérisson).
- Accès : l’agent central voit tout le brain ; une session de dossier n’y ouvre que sa propre paire (hook `cloisonnement`).
- Onglet Contexte de l’agent central : liste « Dossiers » (le + ajoute un dossier connu à ceux qu’il suit) ; sous chaque dossier, « About » s’édite en texte (200 lignes au plus) et « Roadmap » montre la synthèse puis les échéances et événements de chaque suivi, ligne par ligne : intitulé et date modifiables, ligne retirée ou ajoutée, nouveau suivi. Routes `GET /case`, `PUT /case/about` et `PUT /case/roadmap` (`case-pair.ts`), réservées à l’agent central ; la Roadmap passe par le même contrôle que celui du Hérisson (`roadmapErrors`), étapes et synthèse comprises.
- les skills `grill-me`, `connect-tool`, `skill-manager` et `setup-brain` (`vendor/brain/skills`, adaptés d’ai-maxxing-skills, MIT) dans `.agents/skills`, lus par Claude via le lien `.claude/skills`. Ils ne sont installés nulle part ailleurs ; un skill modifié par l’utilisateur n’est jamais écrasé.
- Limites : 200 lignes pour `AGENTS.md` et pour `About.md` ; `Roadmap.json` est contrôlée par le Hérisson, pas par un nombre de lignes. Le hook `cloisonnement` refuse un `Write`, `Edit` ou `MultiEdit` qui les dépasserait (limite : un `apply_patch` Codex ou une commande shell n’est pas mesuré).
- Mémoire native : `autoMemoryEnabled: false` dans `.claude/settings.local.json` du brain et de chaque dossier suivi. Codex n’est pas encore couvert.

### Dream

Réservé à l’agent central (Paramètres › Dream : activation, fournisseur, modèle, heure, « Lancer maintenant » via `POST /dream`). Une fois par nuit à l’heure choisie (heure locale, `tick`), une session cachée « Dream » s’ouvre dans le brain avec `formatDream` (`prompt.ts`) : l’activité des fils et du chat depuis le dernier dream. Elle peut lire et éditer le brain (`acceptEdits`, ni shell ni web), met à jour About.md (et les suivis de Roadmap.json que l’activité prouve) sous leurs limites, ne touche pas à AGENTS.md et rend un compte rendu, publié dans le chat central (« Dream du … ») et gardé dans `state.dream`.

### Rapport du Hérisson sur un fil

Réservé à l’agent central. Quand un fil rend sa réponse, le serveur relit les outils que sa session a appelés pendant ce tour (y compris ceux de ses sous-agents), et `workReport` (`vendor/piecemaker-plugin/scripts/herisson.mjs`) lance les vérifications du Hérisson correspondantes (suivi, mémoire, Catala, OKF, revue) dans le dossier du fil. Le rapport s’ajoute à la réponse du fil, entre `<system-report>` et `</system-report>`, et l’agent central le reçoit avec elle.

### Fils imbriqués

Réservé à l’agent central. Un clic sur un fil ouvre sa session dans un volet imbriqué (`agent/subagent.tsx`, rendu par `WorkspacePanels`) : chat du fil, onglets et plugins de son dossier en haut. Dès qu’un volet ou un document s’ouvre dans ce fil, il passe en plein écran avec le volet à sa droite. Le bouton retour ferme le fil et rend le chat principal, sans changer de projet. Un lien du chat central vers un fichier d’un dossier, ou une pièce jointe d’un message lié à un fil, ouvre ce fil avec le document à droite. Tant qu’un fil est ouvert, les événements globaux d’ouverture (éditeur, volets) ne visent que lui.

## Stockage

Par dossier, dans `<dossier>/.piecemaker/orchestrateur/` :
- `etat.json` : `ProjectState` (réglages, messages du chat, décisions, fils, livrables, minuteries, recherches rapides, état de l'orchestrateur). Écriture atomique (`.tmp` puis `rename`), `revision` incrémentée à chaque écriture.
- `memoire.md` : mémoire du projet ; sa révision est dans `memoire.json` (`{ revision, updatedAt }`). `update_memory` remplace tout le texte et refuse une révision périmée.
- `fichiers/` : dossier des fichiers partagés entre les fils, indiqué à l'orchestrateur et à chaque fil.

Au redémarrage du serveur : un fil `working` ou `blocked` repasse `failed` avec l'erreur « Interrompu : serveur redémarré » (puis relance automatique, voir plus bas) ; `orchestrator.running` repasse à faux et les événements en attente sont conservés.

## Sessions

- **Chat du dossier.** Le bouton et les routes de session renvoient toujours `chatSessionId`. La migration conserve l’identifiant précédent. Le coordinateur utilise le modèle du compositeur dans une session privée distincte, désignée par `sessionId`.
- **Recyclage.** Le serveur remplace la session privée après un échec, un changement de fournisseur, `settings.recycleAfter` tours ou un contexte supérieur à 70 %. Le premier tour privé reçoit les règles et un récapitulatif du dossier. Le tour suivant reçoit les événements en attente.
- **Fil** : une session CloudCLI par fil, dans le dossier ou dans un dossier autorisé (`settings.folders`). Premier message : `formatThreadKickoff(...)`. Outils Claude : préférences de l'utilisateur (`<provider>Permissions`, comme `taches` dans `server/piecemaker/index.ts`) plus `allowedTools += 'mcp__fil'`, `disallowedTools += 'mcp__orchestrateur', 'AskUserQuestion', 'ExitPlanMode'`, `permissionMode: 'bypassPermissions'` (auto-approbation : Claude `bypassPermissions`, Codex `danger-full-access` + `approvalPolicy: never`, Mistral `--auto-approve`) ; aucune permission ne bloque un fil, les hooks PreToolUse de PieceMaker (protection des pièces, ontologie) s'appliquent toujours. L'état `blocked` ne sert plus qu'aux questions posées à l'avocat (`ask_decision`).
- **Recherche rapide** (`lookup`) : session à part, `permissionMode: 'plan'` (lecture seule), modèle le moins cher ; sa réponse revient en wake `lookup_result`. Pas de fil créé.
- Les tours partent par `runDetachedChatTurn` (comme `taches`), donc une session ouverte dans le chat CloudCLI rejoue le flux en direct.

## Clés et rôles

Chaque session (orchestrateur, fil) reçoit une clé aléatoire (`randomUUID`), écrite dans son wake ou son premier message. Chaque appel MCP porte `session_key`. Le serveur résout la clé : clé de l'orchestrateur → outils orchestrateur seulement ; clé d'un fil → outils fil seulement ; sinon 403. Un outil orchestrateur n'est accepté que pendant un tour de l'orchestrateur (`orchestrator.running`).

## Wakes

Un wake est un message envoyé à la session de l'orchestrateur, au format :

```
<wake reason="message" time="…" presence="l'avocat a écrit il y a 3 min ; 1 message(s) envoyé(s) depuis" session_key="…">
  <event type="message" trust="principal" at="…" id="msg_…">texte de l'avocat</event>
  <event type="thread_reply" trust="relay" at="…" thread="thr_…" title="Rédiger les conclusions" state="review_ready">réponse du fil</event>
</wake>
```

- `trust` : `principal` (l'avocat : messages, réactions, choix de décision, clics de widget, autorisations, accès dossier, mise en route), `relay` (fils, recherche rapide), `system` (minuteries, états, relances).
- File d'attente `orchestrator.pending` : tout événement y est ajouté ; `pump()` part si l'orchestrateur ne tourne pas, prend **tous** les événements en attente et lance un seul tour. À la fin du tour, `pump()` repart s'il en reste. C'est ce qui regroupe naturellement les résultats.
- Pendant un tour qui porte un message de l'avocat, ce message reçoit la réaction 👀 (`by: 'system'`), retirée à la fin du tour.
- Le coordinateur publie ses réponses avec `post_message`. Le chat affiche les sorties jointes, les widgets et les décisions. Un signal WebSocket actualise son historique.

### Présence et minuteries (tick toutes les 3 s)

- `lastUserAt` et `postsSinceUser` : mis à jour par chaque message de l'avocat et chaque post ; joints à chaque wake (`presence`).
- **quiet** : à chaque message de l'avocat, `quietAt = maintenant + 60 s` si au moins un fil tourne ; à échéance, événement `quiet` (system).
- **time_limit** : `no_reply_needed` avec `reason: 'holding_updates'` fixe `holdingUntil = maintenant + 10 min` ; à échéance, événement `time_limit`. Tout post l'annule.
- **catch_up** : un message de l'avocat arrivé plus de 30 min après le précédent ajoute, avant lui, un événement `catch_up` (system) qui rappelle de poster les résultats retenus.
- **reminder** : `set_thread_reminder(thread_id, days)` fixe `reminderAt` ; à échéance, événement `reminder` avec le fil.
- **send_later** : minuterie `once` ; à échéance, événement `send_later` avec son texte.
- **routine** : minuterie `cron` (5 champs : minute heure jour mois jour-semaine ; `*`, nombres, listes `1,2`, intervalles `1-5`, pas `*/15`) ; à chaque échéance, un fil est lancé avec `thread.title` et `thread.instructions`, puis un événement `routine` le signale.

## Fils

États : `queued` (attend une place), `working`, `blocked` (autorisation en attente), `review_ready` (a répondu), `done` (résolu), `failed`, `stopped` (tour interrompu).

- **Fournisseur** : `start_thread` sans fournisseur (ou `auto`) prend `settings.defaultProvider`, réglé dans Paramètres › Général › « Fournisseur par défaut ». Sa valeur par défaut, `chat` (« Comme le chat principal »), reprend le fournisseur du chat de l'agent (`orchestrator.chatProvider`, sinon `orchestratorProvider`). Un ancien `auto` enregistré est lu comme `chat`.
- **Concurrence** : au plus `settings.concurrency[provider]` fils `working` ou `blocked` par provider (défaut 3). Au-delà : `queued`, contenu gardé ; une place libérée lance le plus ancien.
- **Fin d'un tour** : si `wasAborted(sessionId)` → `stopped` + événement `thread_stopped` ; si erreur → voir relance ; sinon la réponse = dernier `reply` appelé pendant le tour, sinon `lastAnswer` ; `replies.push`, état `review_ready` (sauf si résolu), événement `thread_reply` (relay). Puis la boîte `inbox` (messages reçus pendant le tour) part en un seul tour.
- **Relance** : un fil en échec avec `retries === 0` est relancé une fois automatiquement (« Le tour précédent s'est interrompu : <erreur>. Reprends là où tu t'es arrêté. »), `retries = 1`, événement `thread_retry` (system). Second échec : `failed` + événement `thread_failed`. Un fil `stopped` n'est jamais relancé automatiquement.
- **Tour lancé par l'avocat dans le chat CloudCLI du fil** : le tick voit `isProcessing(sessionId)` sur un fil qui n'est pas `working` → `working`, `external = true` ; quand il s'arrête, sa réponse est traitée comme une fin de tour.
- **Autorisations** : le tick lit `pending(sessionId)` des fils `working` ; une nouvelle demande → `blocked`, message système `approval` dans le chat du projet (outil, entrée, boutons Autoriser / Refuser), `notify`, événement `thread_blocked`. Le clic de l'avocat appelle `resolve(requestId, allow)` et ajoute un événement `approval` (principal, avec l'id du message). Plus de demande en attente → `working`, cartes restantes marquées `resolved`.
- **Accès dossier** : `start_thread` avec un `folder` hors de `settings.folders` et du dossier du projet crée un message `folderRequest` ; l'accord de l'avocat ajoute le dossier aux réglages, lance le fil et ajoute un événement `folder_access`.

## Livrables

`Deliverable` : `{ id, kind: 'document' | 'piece' | 'artifact', ref (chemin relatif au dossier ou URL d'artifact), title, state: 'brouillon' | 'a_relire' | 'valide', threadId, updatedAt }`. Créés par `reply` d'un fil (chaque `attached_outputs` de type `file` ou `artifact` devient un livrable `a_relire`) ou par `update_deliverable` de l'orchestrateur ; seul l'avocat (interface) passe un livrable à `valide`.

## Outils

Paramètres en snake_case. Chaque outil renvoie du JSON. Un refus est une erreur MCP avec un message clair.

### MCP `orchestrateur`

| Outil | Paramètres | Effet |
|---|---|---|
| `post_message` | `text`, `attached_outputs?: [{kind, ref, title?}]`, `decision_ids?`, `notify?` | Post dans le chat du projet ; `notify` → `notify()` (notifications CloudCLI : web push, bureau, webhook). |
| `edit_message` | `message_id`, `text` | Corrige un post de l'orchestrateur (`editedAt`). |
| `react` / `unreact` | `message_id`, `emoji` | Réaction de l'orchestrateur. |
| `post_widget` | `type: buttons|draft|comparison|steps`, `title?`, `body?`, `buttons?`, `draft?`, `columns?`, `rows?`, `steps?` | Carte ; un clic ou un envoi de brouillon revient en `widget_action` (principal) avec `action_id` (et le texte du brouillon) ; la carte garde `state.clicked`. |
| `update_widget` | `message_id`, `steps?`, `body?` | Met une carte à jour sur place. |
| `ask_decision` | `question`, `options: [{label, consequence}]` (2 à 4), `recommended`, `reason?` | Carte de décision postée dans le chat ; le choix revient en `decision` (principal). |
| `close_decision` | `decision_id`, `chose?` | Ferme une carte (choix ou retrait). |
| `post_thread_card` | `decision_id`, `text?` | Remonte la carte de décision d'un fil dans le chat du projet ; le choix est envoyé au fil et signalé à l'orchestrateur. |
| `start_thread` | `title`, `instructions`, `ack_project`, `ack_thread`, `context_message_ids?`, `provider?: auto|claude|codex|mistral`, `model?`, `effort?`, `folder?` | Crée le fil, poste `ack_project` avec la carte du fil, lance (ou met en file). Refus si le provider n'est pas connecté (le message dit d'utiliser `suggest_connectors`). |
| `message_thread` | `thread_id`, `text`, `context_message_ids?` | Envoie au fil (rouvre un fil résolu) ; pendant un tour, va dans `inbox`. |
| `read_thread` | `thread_id`, `limit?` | Réponses du fil, livrables, derniers messages de sa session. |
| `list_threads` | `state?` | Fils triés par activité, avec état et livrables. |
| `rename_thread` | `thread_id`, `title` | |
| `set_thread_resolved` | `thread_id`, `resolved` | `done` / retour à `review_ready`. |
| `set_thread_reminder` | `thread_id`, `days` (0 annule, 30 max) | |
| `switch_model` | `thread_id`, `model?`, `effort?` | Pour les tours suivants du fil. |
| `send_later` | `text`, `at` (ISO) | Minuterie `once`. |
| `create_routine` / `delete_routine` / `list_routines` | `cron`, `title`, `instructions`, `provider?` / `routine_id` | Minuteries `cron`. |
| `lookup` | `question` | Recherche rapide en lecture seule. |
| `read_memory` / `update_memory` | — / `text`, `revision` | |
| `get_project_settings` / `update_project_settings` | — / champs de `Settings` | |
| `list_providers` | — | Claude, Codex, Mistral : installé, connecté. |
| `list_devices` | — | Dossiers autorisés : dossier du projet, `settings.folders`, autres dossiers PieceMaker connus (non autorisés). |
| `suggest_connectors` | `target`, `reconnect?`, `reason?` | Carte de connexion (`connect`) : provider (`claude`, `codex`, `mistral`) ou connecteur de la Bibliothèque. |
| `list_thread_connectors` | `thread_id` | Serveurs MCP déclarés dans le dossier du fil. |
| `list_project_artifacts` | — | Artifacts du dossier (`.piecemaker/artifacts`). |
| `list_deliverables` / `update_deliverable` | — / `deliverable_id?`, `kind?`, `ref?`, `title?`, `state?` (sauf `valide`), `thread_id?` | |
| `propose_project_setup` | `instructions?`, `threads: [{title, instructions, provider?}]` | Carte de mise en route ; l'accord applique les instructions, lance les fils, ajoute un événement `setup`. |
| `no_reply_needed` | `reason: nothing_to_add|not_for_me|holding_updates` | |

### MCP `fil`

| Outil | Paramètres | Effet |
|---|---|---|
| `reply` | `text`, `attached_outputs?` | Réponse explicite du tour ; les sorties deviennent des livrables. |
| `ask_decision` | comme ci-dessus | Décision du fil ; événement `thread_decision` à l'orchestrateur, qui la remonte avec `post_thread_card`. |
| `message_orchestrator` | `text` | Événement `thread_message` (relay). |

## Routes

Authentifiées, sous `/api/piecemaker/orchestrateur` (`project` = chemin du dossier, vérifié contre `projectsDb`) :
- `GET /state?project=` : état complet pour l'interface, avec `providers`, `memory`, `artifacts`, fichiers partagés.
- `GET /session?project=` : `{ sessionId }` de l'agent du dossier (null sans agent, sans rien créer) ; `POST /session` `{ project }` : crée la session de l'agent si besoin, renvoie `{ sessionId, provider }`.
- `POST /message` `{ project, text }` (l'utilisateur courant devient `orchestrator.userId`).
- `POST /decision` `{ project, decisionId, option }` ; `POST /widget` `{ project, messageId, actionId, text? }` ; `POST /approval` `{ project, messageId, allow }` ; `POST /folder` `{ project, messageId, allow }` ; `POST /setup` `{ project, messageId, accept }` ; `POST /react` `{ project, messageId, emoji, on }`.
- `PUT /settings`, `PUT /memory` `{ text, revision }`, `PUT /deliverable` `{ id, state }`.
- `POST /thread/resolve` `{ project, threadId, resolved }`, `POST /thread/stop` `{ project, threadId }`, `POST /recycle` `{ project }`.

Locale (boucle locale seulement, `isLoopback`), montée dans le `localRouter` de `server/piecemaker/index.ts` : `POST /api/piecemaker/local/orchestrateur/call` `{ root, session_key, tool, args }`.

## Interface : PieceMaker Agent

Interface en français, aux couleurs du thème CloudCLI.

### Emplacement

- Un bouton **PieceMaker Agent** natif du panneau de gauche (`SidebarAgentButton`, rendu par `SidebarProjectSessions`), juste **au-dessus** du bouton « Nouvelle session » de chaque dossier. Un clic ouvre (ou crée) la session de l'agent du dossier et la sélectionne comme un clic sur une session.
- Le **chat de l'agent est le chat CloudCLI** de cette session : même composant, streaming, rendu des outils, compositeur, autorisations. Les règles et les wakes restent invisibles : l'historique montre le texte de l'avocat, ou une ligne lisible pour un événement.
- Le **volet de droite** est un volet natif des volets de droite (`AppTab` `agent`), ouvert par défaut quand la session courante est celle de l'agent (sauf sur téléphone) ; un bouton `PanelRight` dans la barre d'icônes du haut l'affiche ou le replie, visible seulement dans cette session. Son en-tête de volet garde agrandir et fermer.
- Un clic sur un fil affiche sa session CloudCLI dans le volet de droite. Le chat du coordinateur reste ouvert. La flèche de retour affiche la liste des fils.
- Rafraîchissement : `GET /state` toutes les 2 s tant que le volet est affiché ; `GET /session` à chaque changement de session.
- Le recyclage manuel attend la fin du tour actif. Les fils gardent leur propre session.

### Volet de droite

- **Barre du haut** : onglets « Fils de discussion » (badge bleu du nombre de fils actifs : en file, en cours, bloqués), « Contexte », « Instructions », « Paramètres » ; l'onglet actif est une pilule grise. Un bouton + avec un menu : « Tâches planifiées » (liste des minuteries et routines, création d'une routine) et « Vue personnalisée » (filtre enregistré). À droite : recherche, filtre (par état).
- **Fils de discussion** : en tête, une section « À traiter » avec les cartes qui attendent l'avocat (décisions ouvertes de l'agent ou d'un fil, autorisations, accès à un dossier, mise en route, widgets à boutons ou brouillon, connexion d'un provider) ; puis les fils triés par activité ; titre, état, provider, âge (« 19h »), dernier extrait ; filtre par état, recherche par titre ; actions Résoudre / Rouvrir, Arrêter ; livrables du fil avec leur état (brouillon, à relire, validé ; l'utilisateur peut valider).
- **Contexte** : sélecteur « Vous uniquement » (seul mode, affiché comme dans Projects) ; sections repliables avec chevron et compteur gris : Instructions (une ligne « Instructions du projet » avec un aperçu tronqué, clic → onglet Instructions), Mémoire (texte rendu), Fichiers avec un + (dossiers autorisés marqués « Cet ordinateur », fichiers partagés avec leur âge), Artéfacts (miniature, titre tronqué, avatar de l'auteur, âge ; clic → onglet Artifacts) et Livrables. En pied de volet, une barre de stockage « X sur Y utilisés » (taille du dossier des fichiers partagés sur l'espace libre du disque).
- **Instructions** : éditeur des instructions du projet (vides par défaut) et de la mémoire, avec Enregistrer (révision vérifiée).
- **Paramètres** : provider et modèle de l'orchestrateur, provider et modèle par défaut des fils (providers non connectés grisés), fils simultanés par provider, dossiers autorisés, recyclage après N tours, « Recycler l'orchestrateur ».
