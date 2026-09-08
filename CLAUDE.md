# Repository guidance

Forking CloudCLI. Never modify original code, only plug your additions on it so upstream is possible.
Clear separation in folder is necessary (PieceMaker subfolder).
**Never comment inside code files.** Use self-evident names for vars, give one comment in the commit. 
**Always commit once a task is over.** Never push.

## Plugging code in / rebranding CloudCLI

Upstream merges must stay mechanical. Every line added to a CloudCLI file is a future conflict, so:

**Add, don't edit.** New behaviour goes in a new file or folder. Files we create carry no merge cost.

**Touch an upstream file only for branding or data isolation** — a hardcoded product name, URL, `appId`, protocol, or `~/.cloudcli` path. Nothing else justifies it.

**One substitution per line, with an upstream fallback.** Replace the hardcoded value by a reference to `product.config.json` (via `shared/product-config.mjs`, or `src/shared/constants.ts` on the front end), and default that reference to the original CloudCLI value. A merge then stays a one-line resolution, and the code still behaves as upstream when the config is absent.

**Never improve an upstream file in passing.** No reformatting, no comment cleanup, no drive-by fix, no unused alias script. `git diff <upstream file>` must show only lines that branding or isolation demands — every other line is reverted, however sound.

**Copying an upstream file into a template** (e.g. `public/sw.js` → `pwa/service-worker.js`): copy it byte-for-byte from `git show HEAD:<path>`, then apply the substitutions with a script that asserts each pattern is present and unique. Diff the result against the original and check nothing else moved.

**Never redirect provider-owned paths** — `~/.codex`, `~/.claude` and friends belong to the tools, not to us. Only CloudCLI's own data root moves.

Before committing, read `git diff` file by file and justify each hunk out loud. If you cannot, revert it.

## Code PieceMaker added on top of CloudCLI

PieceMaker is french-law oriented feature.

### `server/piecemaker/vendor/` — code du dépôt, pas une copie

Ce dossier a commencé comme une reprise du dépôt historique PieceMaker-Installer.
Ce régime est terminé : **le code de `vendor/` appartient à ce dépôt**, se
modifie comme le reste, et ne doit rien à une resynchronisation amont. Aucun
correctif n'a à être « remonté » ailleurs, aucune modification n'est à justifier
par la fidélité à une source.

La règle « Add, don't edit » ne concerne donc que les fichiers CloudCLI. Le nom
`vendor/` et l'arborescence (`websocket-server/`, `piecemaker-plugin/`,
`installer/`, `mcp/`) sont conservés parce que les `require` internes en
dépendent, et pour ne pas déplacer inutilement des centaines de fichiers.

### Harness Legal

Couche de vérification des citations juridiques, portée depuis
https://github.com/open-legal-products/mike. Principe : **le modèle ne cite que
ce qu'il a lu dans le tour, et la vérification est mécanique** — recherche de
sous-chaîne tolérante aux espaces, à la casse et à la ponctuation, jamais un
jugement du modèle. Un extrait qui a dérivé est recalé sur le texte source (ce
n'est pas une faute) ; un extrait introuvable passe à `verified: false`.

Deux points de branchement distincts :

- **Proxy PII** : démarré et attendu dans `server/piecemaker/index.ts`, avant
  que CloudCLI puisse écouter. `anonymizer/lifecycle.ts` refuse le démarrage si
  le proxy ou le routage Claude/Codex n'est pas prêt ; les lancements de chat
  revérifient cet état. Le proxy appartient au processus serveur et disparaît
  avec lui. Le fournisseur Codex géré utilise HTTP Responses, pas WebSocket.
- **Harnais de chat** : `harness/chat-harness.ts` décore les services publics
  `providerRuntimeService.run/getRunner` et `sessionsService.fetchHistory`.
  Il traite les événements normalisés Claude/Codex avant leur diffusion et
  leur mise en tampon pour reconnexion. Aucun fichier CloudCLI upstream n'est
  modifié. Le terminal PTY brut n'est pas une conversation structurée : cette
  visionneuse et ces annotations concernent le chat, pas son affichage ANSI.

- `server/piecemaker/harness/decisions.cjs` — repère les résultats d'outil
  `consulter_decision` (appariement `tool_use_id` côté Anthropic, `call_id` côté
  Responses, le nom d'outil ne vivant que sur le bloc d'appel) et écrit le texte
  intégral dans `~/.piecemaker/decisions/<id>.json`. Nécessaire parce que
  `consulter_decision` ne rend le texte intégral que dans son résultat, jamais
  sur le disque, et que `Download_Query_Results` ne le rend jamais du tout.
- `server/piecemaker/harness/citation-turn.ts` — comportement de Mike : texte
  diffusé progressivement, bloc `<CITATIONS>` masqué même découpé, événements
  `citations` started/partial/final, vérification mécanique puis fin du tour.
  Les décisions viennent seulement des résultats `consulter_decision` de ce
  tour, appariés par `toolId` ; aucun cache global ne les rend vérifiables.
  Les Markdown sont résolus dans le dossier réel de la session, avec contrôle
  des liens symboliques et lecture mémoïsée par tour. Les moteurs de parsing
  et de vérification vendorisés restent inchangés.
- `server/piecemaker/harness/citation-store.ts` — snapshots locaux privés des
  textes ayant servi à vérifier les extraits, avec leurs positions. Les liens
  utilisent des empreintes opaques ; la route de lecture est authentifiée et
  refuse les sessions supprimées. Ces snapshots contiennent du texte réel,
  contrairement au journal `citations-verifiees.jsonl` qui ne contient
  **aucun extrait ni texte source**, et utilise l'identifiant de session.
  Lorsqu'une décision n'avait pas été lue dans le tour, la visionneuse peut
  ouvrir sa copie déjà présente dans `decisions/` : elle cherche mécaniquement
  le passage pour la consultation, sans modifier le `verified: false` initial.
  Cette provenance est affichée explicitement ; le snapshot reste inchangé.
- `src/piecemaker/citations/` — liens Markdown natifs du chat, panneau de
  lecture à droite, sélection d'extrait, surlignage des positions vérifiées,
  avertissement des extraits introuvables. Réutilise l'API authentifiée et les
  composants Button/ScrollArea de CloudCLI. L'entrée existante PieceMaker
  monte ce panneau sans modifier le rendu React de l'hôte.
  Le lien « Ouvrir ce passage sur Légifrance » utilise les fragments de texte
  du navigateur et un nouvel onglet. L'intégration directe testée en iframe
  est refusée par Légifrance (HTTP 403, `X-Frame-Options: SAMEORIGIN`).
- `server/piecemaker/harness/citation-instructions.ts` — discipline de lecture
  et format JSON ajoutés aux requêtes de chat Claude/Codex, retirés de l'écho
  utilisateur et de l'historique affiché. Les commandes slash sont préservées.
- `server/piecemaker/harness/flux-sse.cjs` — collecteur du texte visible d'un
  flux SSE (`thinking` et `partial_json` exclus), mémoire bornée.
- `server/piecemaker/harness/index.cjs` et `verification.cjs` — observateurs
  historiques conservés et testés. Dans l'application, le proxy garde la
  capture des décisions mais reçoit `verifyResponses: false` : la vérification
  et le journal appartiennent désormais au harnais de chat, qui connaît le
  tour et le dossier. `PIECEMAKER_CITATIONS=off` concerne ces observateurs
  historiques, pas le harnais de chat.

Invariants tenus par les tests (`harness.test.js`, `proxy-harness.test.js`) :

- **Espace en clair.** L'observation porte sur le corps client *avant*
  anonymisation et sur le texte livré au client *après* ré-identification. Le
  cache de décisions contient donc du texte réel, dans la même forme que celui
  qu'écrit le hook de PieceMaker-Installer : les deux installations partagent
  `~/.piecemaker/decisions/` au lieu de le dupliquer.
- **Transparence stricte.** Ce qui est livré au client est octet pour octet
  identique avec et sans harnais. Les trois chemins de retour sont couverts :
  SSE dé-anonymisé, JSON complet, et le `pipe` du mapping vide.
- `harness` est absent par défaut de `createAnonymizerProxy` : sans lui, le
  proxy se comporte exactement comme avant.

**Comme Mike, ce harnais annote, il ne bloque pas la prose déjà diffusée.** Un
extrait corrigé reçoit le texte exact ; un extrait introuvable reste visible
avec un avertissement, jamais avec un faux surlignage. Un tour interrompu ne
publie pas d'annotations finales. Le hook Stop de PieceMaker-Installer est un
mécanisme distinct et peut toujours s'appliquer si l'utilisateur l'a installé.

Le déroulé de recherche et le format exact du bloc `<CITATIONS>` sont décrits
dans le skill vendu `server/piecemaker/vendor/piecemaker-plugin/skills/recherche-juridique/SKILL.md`.

### Anonymisation - GLiNER

- Scan GLiNER & mapping

### Protection des pièces

Les pièces originales d'un dossier (PDF, DOCX, courriels) portent les noms
réels. La promesse du produit est que l'IA ne les lit jamais : elle travaille
sur les Markdown convertis et pseudonymisés. La « protection » est ce qui tient
cette promesse.

Le modèle est **protégé par défaut** : `.piecemaker/protection.json` ne stocke
que des *exceptions*, jamais la liste des fichiers protégés. Un fichier déposé
plus tard est donc protégé sans que rien n'ait à être mis à jour. Les `.md` et
les `.json` ne sont jamais protégés — ce sont les surfaces déjà anonymisées.
Les mappings (`mapping*.json`, `*_sensitive_map.json`, `central-mapping.json`)
ne sont accessibles à l'IA en aucune circonstance, et aucune exception ne les
atteint.

La **levée de protection** (`server/piecemaker/protection/bypass.cjs`, bouton
`src/piecemaker/dossier/sections/CaseFilesProtectionBypass.tsx`) suit la même
logique : elle pose un simple drapeau `.piecemaker/protection-bypass.json`
portant la portée « dossier », **sans aucune liste de fichiers**. Elle vaut donc
pour les pièces déposées ensuite. Toute évolution qui réintroduirait une
énumération de fichiers serait une régression.

Trois couches défendent cette promesse, dans l'ordre du trajet d'un fichier.
Elles ne sont pas interchangeables : **seule la première empêche**.

#### 1. Hooks — la prévention

Hooks `PreToolUse` de Claude Code (`protect-originals.mjs`). L'IA demande à
ouvrir un chemin, le hook répond `deny` avant toute lecture. C'est la seule
couche où le contenu n'entre ni dans la conversation, ni dans le transcript sur
disque, ni dans l'historique du dossier. Elle sait aussi *expliquer* le refus et
renvoyer vers le Markdown converti, ce qui permet au modèle de se corriger seul.

Limites structurelles, à connaître avant de s'y fier :

- **Claude Code uniquement.** Codex ne reçoit qu'un hook `SessionStart` (la
  sentinelle `proxy-guard.mjs`) : aucun refus par outil, donc aucun blocage
  mécanique de lecture. Seuls le proxy et les consignes d'`AGENTS.md` s'y
  appliquent.
- **Un hook analyse du texte de commande, pas des syscalls.** `python -c
  "open(...)"`, `find -exec cat`, une variable de shell ou un chemin relatif
  après un `cd` échappent à toute analyse textuelle. C'est la raison d'être de
  la couche 3.
- `proxy-guard.mjs` est **fail-open** par conception : proxy indisponible ⇒ il
  retire la configuration du proxy des fichiers clients et laisse la session
  partir en accès direct, avec un avertissement. Le refus de démarrage, lui,
  appartient au serveur (couche 2).

#### 2. Proxy PII — le filet

`server/piecemaker/anonymizer/`, démarré et attendu par
`server/piecemaker/index.ts` avant toute écoute HTTP ; `anonymizer/lifecycle.ts`
refuse le démarrage si le proxy ou le routage Claude/Codex n'est pas prêt, et
chaque lancement de chat revérifie cet état. Il couvre Claude et Codex au même
point de passage, en SSE et en JSON, et refuse en 404 tout chemin non routé.

Ce qu'il ne peut pas faire : empêcher. Une pièce lue localement ne lui parvient
qu'**au tour suivant**, dans le rappel de l'historique, sous forme de bloc
`tool_result` — à ce moment elle est déjà dans le transcript et à l'écran. De
plus, le chemin du fichier vit dans le bloc d'appel et le contenu dans le bloc
de résultat ; leur appariement n'existe aujourd'hui que pour
`consulter_decision` (`harness/decisions.cjs`).

**Rien dans `anonymizer/` ni `harness/` ne consulte `protection.json` ni le
drapeau de levée.** Le seul filtre du proxy est le dictionnaire central. Si l'on
voulait un jour y ajouter un caviardage des pièces protégées — notamment pour
couvrir Codex —, la mécanique de substitution existe déjà et est générique
(`anonymizer/rewrite.cjs`, y compris pour un motif fragmenté entre deltas SSE) ;
mais cela heurterait l'invariant de transparence octet pour octet affirmé et
testé par `proxy-harness.test.js`, et devrait se rejouer à chaque tour puisque
le `tool_result` demeure dans l'historique.

#### 3. MXC — le confinement système

`microsoft/mxc` (« Microsoft eXecution Container ») : le shell est lancé *à
travers* un binaire qui refuse au niveau du système d'exploitation l'accès au
venv Python, aux mappings du dossier et au mapping central. Backends `seatbelt`
sur macOS, `processcontainer` sur Windows, `bubblewrap` sur Linux. Le réseau
reste autorisé — c'est un confinement du système de fichiers, pas du réseau.
L'installation vérifie son effectivité par un canari et **se désactive
elle-même** si le blocage n'a pas lieu.

C'est la seule couche qui ferme le trou de la couche 1, parce qu'elle ne lit pas
une commande : elle arbitre les ouvertures de fichiers. Deux réserves assumées :
Microsoft présente mxc comme une préversion et écrit que ses profils ne doivent
pas être traités comme des frontières de sécurité ; et sous Windows il n'expose
pas de chemins refusés, seulement une liste blanche. **MXC ne remplace donc
jamais les hooks, il se place dessous.**

#### État réel, à ne pas confondre avec l'intention

- Couche 2 : **en production**, bloquante, testée.
- Couche 1 : les scripts de hook **ne sont pas vendorisés dans ce dépôt** (seul
  `scripts/lib/` l'est, `hook-io.mjs` manque), l'étape `06-hooks` n'est pas
  rejouée par la commande `piecemaker`, et les hooks actifs sur un poste de
  développement proviennent du dépôt historique PieceMaker-Installer. La copie
  externe de `protection.cjs` ignore le drapeau de levée, que la copie
  vendorisée sait lire : le bouton n'a donc aucun effet sur les refus.
- Couche 3 : l'étape `14-mxc-sandbox` est vendorisée mais `mxc-sandbox.cjs` ne
  l'est pas, et l'étape est explicitement exclue de la commande `piecemaker`.
  **Elle n'existe pas à l'exécution.**

Corollaire à garder en tête : sur une machine où l'Installer historique n'a
jamais tourné, **il n'y a aujourd'hui aucune protection de lecture**. C'est ce
dépôt qui doit livrer la protection — les dépôts sont autonomes.

Le sandbox natif de Claude Code (permissions, `sandbox`) n'est configuré nulle
part et reste la piste la moins coûteuse à évaluer avant tout chantier mxc.

### Research - MCP LEGIFRANCE

Legal research is conducted in french law through LEGIFRANCE MCP - /Users/tsardet/Sites/mcp-legifrance

### Surcharge i18n

Renomme le vocabulaire UI (« projet » CloudCLI → « dossier » PieceMaker, marque CloudCLI → PieceMaker) sans jamais toucher `src/modules/i18n/locales/**`, conformément à « Add, don't edit ».

Périmètre : les overrides i18n **réécrivent l'UI CloudCLI existante** — ils ne créent aucun écran. Toute fonctionnalité nouvelle relève du système de plugins (voir « Système de plugins »), et un plugin ne peut inversement rien renommer dans l'hôte.

- `scripts/piecemaker/generate-i18n-overrides.mjs` lit les locales upstream, applique des règles de remplacement par langue, écrit uniquement les clés feuilles modifiées. Relancer après tout merge upstream touchant aux traductions : `node scripts/piecemaker/generate-i18n-overrides.mjs`
- `src/piecemaker/i18n/overrides/<langue>/<namespace>.json` : bundles générés (680 chaînes, 11 langues, 7 namespaces). Ne jamais éditer à la main — régénérés et écrasés à chaque run ; toute correction se fait dans les règles du script.
- `src/piecemaker/i18n/overrides.ts` charge les bundles via `import.meta.glob` et les fusionne avec `i18n.addResourceBundle(langue, namespace, bundle, true, true)` (deep merge + overwrite). Exporte aussi `PIECEMAKER_DEFAULT_LANGUAGE = 'fr'`.
- Empreinte upstream minimale dans `src/modules/i18n/config.ts` : un import, le `return` de `getSavedLanguage()` qui renvoie `PIECEMAKER_DEFAULT_LANGUAGE` au lieu de `'en'`, un appel `applyPieceMakerI18nOverrides(i18n)` après le `.init()`.
- Pour le texte codé en dur (non traduit par i18n) : `src/piecemaker/branding.ts` expose `PRODUCT_SHORT_NAME`, alimenté par le define Vite `__PRODUCT_SHORT_NAME__` (`vite.config.js`) qui lit `shortName` de `product.config.json`, repli `'PieceMaker'`.

Pièges du script à connaître avant de le modifier :

- les placeholders i18next `{{...}}` sont protégés : le remplacement ne s'applique qu'au texte entre les placeholders.
- les règles d'une langue sont triées par longueur décroissante pour que les formes fléchies soient consommées avant le nom nu ; `POST_RULES` rattrape une tournure après coup.
- `FROZEN_KEYS` gèle les clés intouchables (noms de produits tiers comme `PRISM CloudCLI`, commande npm littérale) ; `WORDING_EXCLUDED_NAMESPACES` exclut `tasks` du renommage de vocabulaire (chez TaskMaster « projet » désigne un projet logiciel), la marque y étant tout de même renommée.
- terminologie par langue : fr dossier, en case, es expediente, it fascicolo, de Dossier (neutre comme « das Projekt », articles inchangés), tr dava, ru досье (indéclinable, accords corrigés explicitement), ja/zh-CN/zh-TW 案件, ko 사건 (particules 를→을 et 가→이 ajustées).

## About CloudCLI
### Backend code

For every task that creates, modifies, refactors, or reviews backend code under `server/`, load and follow `$backend-module-standards` from `.agents/skills/backend-module-standards/SKILL.md`. Apply it only to backend code; do not impose those architecture rules on the frontend.

### Frontend code

For every task that creates, modifies, refactors, or reviews frontend code under `src/`, load and follow `$frontend-module-standards` from `.agents/skills/frontend-module-standards/SKILL.md`. Apply it only to frontend code; do not impose those architecture rules on the backend.

### Système de plugins

Point d'extension upstream, à privilégier pour toute fonctionnalité PieceMaker autonome : un plugin est un dossier hors dépôt, donc zéro empreinte de merge.

Les deux leviers ne se recouvrent pas, et aucun ne fait le travail de l'autre :

| | Surcharge i18n | Plugin |
|---|---|---|
| Sert à | renommer ce qui existe déjà (vocabulaire, marque) | ajouter ce qui n'existe pas (écran + logique métier) |
| Portée | toutes les vues CloudCLI, avant le premier rendu | son seul onglet, monté à la demande |
| Accès à l'hôte | l'instance i18next, rien d'autre | `context` / `onContextChange` / `rpc`, rien d'autre |
| Backend | aucun | sous-processus Node optionnel |
| Livraison | dans le dépôt, buildé avec l'app | dépôt git séparé, installé par l'utilisateur |
| Empreinte upstream | 3 lignes dans `src/modules/i18n/config.ts` | nulle |

Corollaire : un plugin ne peut pas rebrander l'UI, et les overrides ne peuvent pas héberger une fonctionnalité. Une fonctionnalité PieceMaker livrée en plugin devra d'ailleurs porter ses propres traductions — l'i18n de l'hôte ne l'atteint pas.

Ce que le système de plugins permet exactement, avant de s'engager :

- **Un seul emplacement : un onglet.** `ALLOWED_SLOTS = ['tab']` (`server/modules/plugins/plugin-registry.service.ts:26`). L'hôte donne un `<div>` vide et appelle `mount(container, api)` / `unmount(container)` du module ES compilé.
- **API hôte minuscule** (`plugins/starter/src/types.ts`) : `context` (thème, projet, session), `onContextChange`, `rpc`. Pas d'accès au store, au routeur, à i18next ni aux composants CloudCLI.
- **Backend optionnel** : `"server"` du manifeste est lancé par `spawn('node', …)` en sous-processus, environnement réduit (`buildPluginEnv`, `plugin-process.service.ts`), port local aléatoire ; le front l'atteint via `api.plugins.rpc()` proxifié par `router.all('/:name/rpc/*')`. Les secrets déclarés en config sont injectés en en-têtes `x-plugin-secret-*` par l'hôte, jamais exposés au navigateur.
- **Chargement front** : `PluginTabContent.tsx` récupère `dist/index.js` via l'API authentifiée puis l'importe par Blob URL (aucune requête anonyme), et remonte le plugin à chaque changement de `entry`/`enabled`.
- **Installation** : dépôt git collé dans *Settings > Plugins* → clone, `npm install`, build. Manifeste requis : `name`, `displayName`, `entry` ; `type` ∈ `react`|`module`.

À lire dans l'ordre avant d'écrire un plugin : `plugins/starter/README.md` et `plugins/starter/src/{types,index,server}.ts` (gabarit officiel vendu dans le dépôt), puis `server/modules/plugins/{plugin-registry,plugin-process,plugins}.service.ts` et `plugins.routes.ts`, enfin `src/modules/plugins/PluginTabContent.tsx`. Doc en ligne : https://cloudcli.ai/docs/plugin-overview.

Piège d'isolation connu : `plugin-registry.service.ts:8-9` code en dur `~/.claude-code-ui/plugins` et `~/.claude-code-ui/plugins.json` au lieu de passer par `getApplicationDataRoot()` (`server/shared/utils.ts:50`). Les plugins échappent donc au `CLOUDCLI_HOME` de PieceMaker. Si on adopte les plugins, c'est une substitution d'une ligne chacune (avec repli upstream), conforme à la règle « toucher un fichier upstream seulement pour la marque ou l'isolation des données ».

## Commande `piecemaker`

Point d'entrée unique de la plateforme, pour l'utilisateur final : une seule
commande, aucune question posée.

```
piecemaker
```

Elle enchaîne, dans cet ordre : libération des ports (5173, 3003), clonage du
dépôt s'il est absent, mise à jour en avance rapide, installation des
dépendances quand le verrou a bougé, installation des composants du socle,
démarrage de l'application (qui porte son propre proxy PII), installation de
la PWA, ouverture. Sautée en entier avec `--launch-only`.

Sur une machine nue, sans dépôt ni commande, chaque amorce clone le dépôt puis
lance ce premier passage :

```
curl -fsSL https://raw.githubusercontent.com/PieceMaker-Legal/piecemaker-droit-francais/main/scripts/piecemaker/cli/piecemaker.sh | sh
```

```
irm https://raw.githubusercontent.com/PieceMaker-Legal/piecemaker-droit-francais/main/scripts/piecemaker/cli/piecemaker.ps1 | iex
```

Aucune des deux n'installe Ollama ni aucun autre gestionnaire de modèles
locaux. Pour que `piecemaker` reste ensuite disponible sans repasser par le
one-liner, exécuter une fois `node scripts/piecemaker/cli/install-command.mjs`
depuis le dépôt cloné (voir plus bas).

`piecemaker` est la seule commande installée par ce dépôt. Le socle technique
(installation des composants Python GLiNER/Graphify, conversion, MCP) vit
directement dans ce dépôt, sous `server/piecemaker/vendor/installer/` — aucun
clone séparé, aucun processus d'administration distinct : la configuration passe
par l'onglet Dossier › Configuration de l'application elle-même.

`piecemaker` rejoue lui-même les seules étapes du socle dont ce dépôt a
besoin — par `server/piecemaker/vendor/installer/bin/piecemaker.mjs --step
<id> --yes`, en mode non interactif — dans cet ordre : `01-prerequis`, `03-python-gliner`,
`03b-python-graphify`, `04-conversion-md`, `12-mcp-piecemaker`,
`07-legifrance`. Explicitement exclues : `05-certificats` (pas d'HTTPS servi
par ce dépôt),
les hooks et les skills (`06-hooks`, `09-claude-assets`, `09-codex-plugin`,
`13-garde-secrets`), ainsi que `00`, `02`, `08`, `10-*`, `11`, `14`, `15`.
Une étape déjà à `done` dans `~/.piecemaker/state.json` n'est pas rejouée ;
une étape en échec ou incomplète (dépendances réseau, clés PISTE absentes en
mode non interactif) redevient un avertissement nommé — jamais un blocage —
et la suite s'exécute quand même.

Code dans `scripts/piecemaker/cli/` :

- `piecemaker.sh` — amorce POSIX installée dans le PATH. Autonome : elle résout
  un Node ≥ 20 (courant, sinon la version nvm la plus récente) et clone le dépôt
  s'il est absent, ce qui rend la commande utilisable sur une machine nue.
- `piecemaker.ps1` — équivalent PowerShell de `piecemaker.sh` pour Windows,
  même résolution de Node (PATH puis nvm-windows) et même clonage à la volée.
- `piecemaker.mjs` — orchestrateur, seul point où l'ordre des étapes est décidé.
- `install-command.mjs` — pose l'amorce dans `~/.piecemaker/bin` et dans le
  `bin` de Node (shim `.sh` sur POSIX, `.ps1` + lanceur `.cmd` sur Windows),
  complète le PATH (fichiers de profil shell sur POSIX, `HKCU\Environment` via
  `setx` sur Windows).
- `lib/` — `ports` (détection et libération des écoutants), `repos`
  (clone/mise à jour/dépendances, empreinte du verrou), `composants`
  (rejoue les étapes du socle listées ci-dessus, une par une, avec un délai
  propre à chacune), `services` (démarrage et sondes HTTP), `pwa` (vérification
  du manifest et du service worker, entrée applicative avec icône Bureau sur
  macOS/Windows/Linux et vérification de sa présence réelle), `node-runtime`,
  `config`, `exec`, `ui`.

Réinstaller la commande après un `git pull` qui la modifie :

```
node scripts/piecemaker/cli/install-command.mjs
```

Réglages par variables d'environnement : `PIECEMAKER_APP_DIR`,
`PIECEMAKER_APP_PORT`, `PIECEMAKER_VITE_PORT`.

Une mise à jour n'est jamais forcée : un dépôt qui porte des modifications
locales ou une branche divergente est signalé et laissé intact.

## Développement local

- Serveur de dev PieceMaker toujours sur le port 3003 : `SERVER_PORT=3003 PORT=3003 npm run dev`. Le port 3002 est occupé par l'application CloudCLI de bureau installée ; un port fixe évite de chercher où l'app tourne à chaque session.
- Client Vite sur http://localhost:5173 — c'est l'URL à ouvrir. Le proxy pointe vers le port serveur donné par `SERVER_PORT`.
- Node système de cette machine en v16, trop ancien pour Vite 7. Utiliser la v24 de nvm, par exemple en préfixant `export PATH="$HOME/.nvm/versions/node/v24.11.1/bin:$PATH"`.

Command to reboot:
pkill -TERM -f "$PWD/node_modules/.bin/concurrently.*server:dev.*client" 2>/
  dev/null || true
  sleep 1
  source "$HOME/.nvm/nvm.sh"
  nvm install
  npm rebuild better-sqlite3

  (
    for i in {1..120}; do
      if curl -fsS http://127.0.0.1:3003/api/auth/status >/dev/null 2>&1 &&
         curl -fsS http://127.0.0.1:5173/ >/dev/null 2>&1; then
        open http://localhost:5173
        exit 0
      fi
      sleep 0.25
    done
  ) &

  SERVER_PORT=3003 VITE_PORT=5173 npm run dev
