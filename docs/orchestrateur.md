# Orchestrateur de projet

Reproduction dans PieceMaker du fonctionnement de Claude Projects, pour le travail juridique d'un avocat : un chat de projet tenu par un **orchestrateur**, qui délègue chaque travail de fond à un **fil** (thread). Chaque fil est une session CloudCLI ordinaire (même chat, streaming, outils, autorisations, copie Markdown), sur Claude, Codex ou Mistral selon les providers connectés. Il n'y a ni code ni dépôt ni PR côté avocat : les résultats sont des **livrables** du dossier.

Tout est ajouté à côté de CloudCLI (« Add, don't edit ») : aucun fichier upstream n'est modifié.

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
| `plugins/piecemaker-projets/` | Onglet « Projet » : chat du projet, vue d'ensemble, paramètres. |

## Stockage

Par dossier, dans `<dossier>/.piecemaker/orchestrateur/` :
- `etat.json` : `ProjectState` (réglages, messages du chat, décisions, fils, livrables, minuteries, recherches rapides, état de l'orchestrateur). Écriture atomique (`.tmp` puis `rename`), `revision` incrémentée à chaque écriture.
- `memoire.md` : mémoire du projet ; sa révision est dans `memoire.json` (`{ revision, updatedAt }`). `update_memory` remplace tout le texte et refuse une révision périmée.
- `fichiers/` : dossier des fichiers partagés entre les fils, indiqué à l'orchestrateur et à chaque fil.

Au redémarrage du serveur : un fil `working` ou `blocked` repasse `failed` avec l'erreur « Interrompu : serveur redémarré » (puis relance automatique, voir plus bas) ; `orchestrator.running` repasse à faux et les événements en attente sont conservés.

## Sessions

- **Orchestrateur** : une session CloudCLI du dossier (`openSession(provider, dossier, 'Orchestrateur du projet')`), provider `settings.orchestratorProvider` (`auto` = Claude si connecté, sinon Codex, sinon Mistral). Le premier message de la session est `formatPreamble(...)` suivi du premier wake ; les suivants sont `formatWake(...)` seul : les événements et la note de présence, sans rappel des règles. Les règles (prompt générique en anglais, `ORCHESTRATOR_RULES`) et les instructions du projet (vides par défaut, réglées par l'utilisateur) ne partent qu'une fois par session ; un recyclage les renvoie avec la reprise à froid. Les runtimes CloudCLI n'acceptant pas de prompt système par session sans modifier leurs fichiers, le premier message en tient lieu. Outils Claude : `allowedTools = ['mcp__orchestrateur', 'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch']`, `disallowedTools = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'mcp__fil']`, `permissionMode: 'default'`.
- **Recyclage** : après `settings.recycleAfter` tours (défaut 60), ou quand un tour de l'orchestrateur échoue, `sessionId` repasse à `null` et une clé neuve est tirée ; le tour suivant ouvre une nouvelle session dont le préambule contient la reprise à froid (messages récents, fils, mémoire, consigne de ne pas reposter). L'interface propose aussi « Recycler l'orchestrateur ».
- **Fil** : une session CloudCLI par fil, dans le dossier ou dans un dossier autorisé (`settings.folders`). Premier message : `formatThreadKickoff(...)`. Outils Claude : préférences de l'utilisateur (`<provider>Permissions`, comme `taches` dans `server/piecemaker/index.ts`) plus `allowedTools += 'mcp__fil'`, `disallowedTools += 'mcp__orchestrateur'`, `permissionMode: 'acceptEdits'`.
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
- Fin de tour : si l'orchestrateur n'a appelé ni `post_message`, ni `ask_decision`, ni `react`, ni `no_reply_needed`, sa dernière réponse texte (`lastAnswer`) est postée telle quelle (filet pour Codex et Mistral).

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
- `POST /message` `{ project, text }` (l'utilisateur courant devient `orchestrator.userId`).
- `POST /decision` `{ project, decisionId, option }` ; `POST /widget` `{ project, messageId, actionId, text? }` ; `POST /approval` `{ project, messageId, allow }` ; `POST /folder` `{ project, messageId, allow }` ; `POST /setup` `{ project, messageId, accept }` ; `POST /react` `{ project, messageId, emoji, on }`.
- `PUT /settings`, `PUT /memory` `{ text, revision }`, `PUT /deliverable` `{ id, state }`.
- `POST /thread/resolve` `{ project, threadId, resolved }`, `POST /thread/stop` `{ project, threadId }`, `POST /recycle` `{ project }`.

Locale (boucle locale seulement, `isLoopback`), montée dans le `localRouter` de `server/piecemaker/index.ts` : `POST /api/piecemaker/local/orchestrateur/call` `{ root, session_key, tool, args }`.

## Interface : PieceMaker Agent

Même présentation que Claude Projects (thème sombre, typographie sobre, beaucoup d'espace). Interface en français.

### Emplacement

- Un bouton **PieceMaker Agent** dans le panneau de gauche, juste **au-dessus** du bouton « Nouvelle session » de chaque dossier (injection DOM, même mécanique que le bouton « Analyse Tabulaire » de `plugins/piecemaker-tabular-review/src/client/sidebar.ts`, mais `beforebegin`). Un clic sélectionne le dossier et déploie l'agent.
- L'agent **remplace le chat principal** : dans `src/modules/piecemaker-workspace-tabs/WorkspacePanels.tsx` (fichier PieceMaker), un mode principal `agent` à côté de `chat` et `shell` rend `AgentChat`. Revenir au chat CloudCLI : ouvrir une session (clic sur une session du panneau de gauche, sur un fil, ou « Nouvelle session ») quitte le mode agent.
- Le **volet de droite** s'ouvre automatiquement avec l'agent et rend `AgentPanel`.
- Plus d'onglet « Projet » dans la barre du haut : le plugin `piecemaker-projets` est retiré ; l'interface vit dans `src/modules/piecemaker-agent/` (React, standards `.agents/skills/frontend-module-standards/SKILL.md`), qui appelle les routes `/api/piecemaker/orchestrateur/*` avec `authenticatedFetch`. Les références à `plugin:piecemaker-projets` (`open-panels.ts`, `volets-ouverts.mjs`, `pm.mjs` cible `projet`, `useAutoPanel.ts`) sont retirées.
- Rafraîchissement : `GET /state` toutes les 2 s tant que l'agent est affiché.

### Chat de l'agent (colonne principale)

- **En-tête** : icône du dossier et nom du dossier avec un chevron (menu : Recycler l'orchestrateur, Paramètres), puis à droite une icône mégaphone (annonces : posts `notify`) et un engrenage (ouvre l'onglet Paramètres du volet).
- **Fil** : messages de l'utilisateur dans une bulle grise alignée à droite ; posts de l'orchestrateur en texte libre, sans bulle, Markdown rendu, liens soulignés. Un séparateur **« Nouveau »** en trait ondulé orange marque le premier message non lu (dernier message vu gardé en `localStorage` par dossier). Un post lié à un fil (`threadId`) commence par une petite ligne de rattachement en coude suivie du titre du fil en gris ; un clic ouvre le fil dans le chat CloudCLI (`/session/<id>`). Sous un ack, la **carte du fil** : titre, état (pastille colorée : en file, en cours, bloqué, à relire, terminé, échec, arrêté), provider.
- **Cartes** empilées sous un post : décisions (question, options en boutons, recommandée marquée, choix grisé une fois fait, « Retirée »), autorisations (outil, entrée repliée, Autoriser / Refuser), widgets (boutons, brouillon éditable + Envoyer, comparaison en tableau, étapes), connexion (bouton « Connecter <provider> » qui ouvre les réglages, événement `piecemaker:open-settings`), accès à un dossier, mise en route ; sorties jointes en cartes (fichier, lien, artifact). Réactions sous un message au survol ; 👀 visible pendant que l'orchestrateur traite.
- **Bannière d'alerte** au-dessus du compositeur : carte arrondie avec icône, titre, sous-texte gris, un bouton secondaire et une croix de fermeture (orchestrateur sans provider connecté, tour en échec).
- **Compositeur** : carte arrondie, placeholder « Écrire à PieceMaker Agent… », bouton d'envoi ↵ (Entrée envoie, Maj+Entrée nouvelle ligne). En dessous : + (joindre un fichier, envoyé dans le dossier des fichiers partagés puis cité dans le message), micro avec chevron (dictée par la Web Speech API si disponible, sinon masqué), nom du modèle de l'orchestrateur à droite, indicateur circulaire orange qui tourne pendant un tour de l'orchestrateur (`orchestrator.running`).

### Volet de droite

- **Barre du haut** : onglets « Fils de discussion » (badge bleu du nombre de fils actifs : en file, en cours, bloqués), « Contexte », « Instructions », « Paramètres » ; l'onglet actif est une pilule grise. Un bouton + avec un menu : « Tâches planifiées » (liste des minuteries et routines, création d'une routine) et « Vue personnalisée » (filtre enregistré). À droite : recherche, filtre (par état), agrandir, replier le volet.
- **Fils de discussion** : fils triés par activité ; titre, état, provider, âge (« 19h »), dernier extrait ; filtre par état, recherche par titre ; actions Résoudre / Rouvrir, Arrêter ; livrables du fil avec leur état (brouillon, à relire, validé ; l'utilisateur peut valider).
- **Contexte** : sélecteur « Vous uniquement » (seul mode, affiché comme dans Projects) ; sections repliables avec chevron et compteur gris : Instructions (une ligne « Instructions du projet » avec un aperçu tronqué, clic → onglet Instructions), Mémoire (texte rendu), Fichiers avec un + (dossiers autorisés marqués « Cet ordinateur », fichiers partagés avec leur âge), Artéfacts (miniature, titre tronqué, avatar de l'auteur, âge ; clic → onglet Artifacts) et Livrables. En pied de volet, une barre de stockage « X sur Y utilisés » (taille du dossier des fichiers partagés sur l'espace libre du disque).
- **Instructions** : éditeur des instructions du projet (vides par défaut) et de la mémoire, avec Enregistrer (révision vérifiée).
- **Paramètres** : provider et modèle de l'orchestrateur, provider et modèle par défaut des fils (providers non connectés grisés), fils simultanés par provider, dossiers autorisés, recyclage après N tours, « Recycler l'orchestrateur ».
