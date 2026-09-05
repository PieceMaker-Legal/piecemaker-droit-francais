<!-- piecemaker-instructions-start -->
## PieceMaker — instructions gérées

Pour une chronologie factuelle, appeler d'abord l'outil `chronologie` du
serveur MCP `piecemaker`. Pour une question sur les personnes ou leurs liens de
droit, appeler `graphe_question` ; si l'outil signale que le graphe doit être
actualisé, lancer `graphe_construire` puis reposer la question. Consulter aussi
la règle complète suivante :

@/Users/tsardet/Documents/GitHub/piecemaker-droit-francais/.claude/rules/piecemaker.md
<!-- piecemaker-instructions-end -->

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

### Harness Legal

Couche de vérification des citations juridiques, portée depuis
https://github.com/open-legal-products/mike. Principe : **le modèle ne cite que
ce qu'il a lu dans le tour, et la vérification est mécanique** — recherche de
sous-chaîne tolérante aux espaces, à la casse et à la ponctuation, jamais un
jugement du modèle. Un extrait qui a dérivé est recalé sur le texte source (ce
n'est pas une faute) ; un extrait introuvable passe à `verified: false`.

Point de branchement : **le proxy PII** (`server/piecemaker/anonymizer/proxy.cjs`),
seul passage obligé de tout le trafic IA (Claude chat, Codex, Cursor, opencode,
terminal intégré) puisque `service.cjs` impose `ANTHROPIC_BASE_URL` /
`OPENAI_BASE_URL`. C'est la position qu'occupait le serveur de Mike. Cette
application n'installe aucun hook Claude Code — un portage par hooks y serait
inerte.

- `server/piecemaker/harness/decisions.cjs` — repère les résultats d'outil
  `consulter_decision` (appariement `tool_use_id` côté Anthropic, `call_id` côté
  Responses, le nom d'outil ne vivant que sur le bloc d'appel) et écrit le texte
  intégral dans `~/.piecemaker/decisions/<id>.json`. Nécessaire parce que
  `consulter_decision` ne rend le texte intégral que dans son résultat, jamais
  sur le disque, et que `Download_Query_Results` ne le rend jamais du tout.
- `server/piecemaker/harness/verification.cjs` — parse le bloc `<CITATIONS>` de
  fin de réponse, résout chaque source, vérifie chaque extrait, journalise une
  ligne JSON dans `~/.piecemaker/citations-verifiees.jsonl`. Le journal ne
  contient **aucun extrait ni texte source** (un test le garantit).
- `server/piecemaker/harness/flux-sse.cjs` — collecteur du texte visible d'un
  flux SSE (`thinking` et `partial_json` exclus), mémoire bornée.
- `server/piecemaker/harness/index.cjs` — façade `createHarnessJuridique`,
  interrupteur `PIECEMAKER_CITATIONS=off`. Les deux observateurs échouent
  ouvert : une erreur du harnais ne casse ni la requête ni la réponse.

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

Différence assumée avec le portage de PieceMaker-Installer : ici le harnais
**observe et journalise, il ne bloque pas** le tour — un proxy en flux ne peut
pas bloquer proprement, et Mike lui-même annotait plutôt qu'il ne bloquait. Le
hook `Stop` bloquant continue de s'appliquer aux sessions lancées depuis cette
application quand PieceMaker-Installer l'a installé, puisque le SDK charge
`settingSources: ['project', 'user', 'local']`.

Limite connue : le proxy n'a pas d'identifiant de session, le `session_id` du
journal vaut donc le fournisseur (`claude`, `codex`…).

Le déroulé de recherche et le format exact du bloc `<CITATIONS>` sont décrits
dans le skill vendu `server/piecemaker/vendor/piecemaker-plugin/skills/recherche-juridique/SKILL.md`.

### Anonymisation - GLiNER

- Scan GLiNER & mapping
- Sanbox MXC

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

Elle enchaîne, dans cet ordre : libération des ports (5173, 3003, 43098, 4000),
clonage des dépôts absents, mise à jour en avance rapide, installation des
dépendances quand le verrou a bougé, démarrage du socle (proxy PII et
administration) puis de l'application, installation de la PWA, ouverture.

Deux commandes distinctes, deux périmètres — ne pas les confondre :

| Commande | Périmètre |
| --- | --- |
| `piecemaker` | toute la plateforme : les deux dépôts, les quatre serveurs, la PWA |
| `piecemaker-installer` | menu du socle seul (proxy PII, MCP, GLiNER, certificats) |

`piecemaker-installer` est l'ancienne commande `piecemaker` du dépôt
PieceMaker-Installer, renommée pour libérer le nom. Son `bin` npm a changé de
clé ; le menu interactif est inchangé.

Code dans `scripts/piecemaker/cli/` :

- `piecemaker.sh` — amorce POSIX installée dans le PATH. Autonome : elle résout
  un Node ≥ 20 (courant, sinon la version nvm la plus récente) et clone le dépôt
  s'il est absent, ce qui rend la commande utilisable sur une machine nue.
- `piecemaker.mjs` — orchestrateur, seul point où l'ordre des étapes est décidé.
- `install-command.mjs` — pose l'amorce dans `~/.piecemaker/bin` et dans le
  `bin` de Node, complète le PATH, renomme la commande du socle.
- `lib/` — `ports` (détection et libération des écoutants), `repos`
  (clone/mise à jour/dépendances, empreinte du verrou), `services` (démarrage
  et sondes HTTP), `pwa` (vérification du manifest et du service worker, entrée
  applicative), `node-runtime`, `config`, `exec`, `ui`.

Réinstaller la commande après un `git pull` qui la modifie :

```
node scripts/piecemaker/cli/install-command.mjs
```

Réglages par variables d'environnement : `PIECEMAKER_APP_DIR`,
`PIECEMAKER_INSTALLER_DIR`, `PIECEMAKER_APP_PORT`, `PIECEMAKER_VITE_PORT`,
`PIECEMAKER_ADMIN_PORT`, `PIECEMAKER_LITELLM_PORT`.

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