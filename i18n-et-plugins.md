# Surcharge i18n

Renomme le vocabulaire UI (« projet » CloudCLI → « dossier » PieceMaker, marque CloudCLI → PieceMaker) sans jamais toucher `src/modules/i18n/locales/**`, conformément à « Add, don't edit ».

Périmètre : les overrides i18n **réécrivent l'UI CloudCLI existante** — ils ne créent aucun écran. Toute fonctionnalité nouvelle relève du système de plugins (voir plus bas), et un plugin ne peut inversement rien renommer dans l'hôte.

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

# Système de plugins

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

## Exceptions upstream assumées

- **Auth (`AuthContext.tsx`)** : l'amorçage d'authentification ne doit se jouer qu'au montage. Le jeton est lu par une `ref` et `token` est hors des dépendances de `checkAuthStatus` ; sans cela, l'en-tête `X-Refreshed-Token` (rotation à la demi-vie, `server/modules/auth/auth.middleware.ts`) rejoue l'effet, remet `isLoading` à vrai, et `ProtectedRoute` démonte tout le sous-arbre `<Router>` — dossier sélectionné, onglet actif, chat et terminal perdus, retour à « Choisissez votre dossier ». Ni marque ni isolation de données : l'exception se justifie parce qu'aucun correctif côté PieceMaker ne peut réparer un démontage global. **Un merge qui résout ce fichier vers CloudCLI réintroduit le bug en silence** : le garde-fou est `src/piecemaker/auth/tests/authSessionSurvivesTokenRotation.test.tsx`, fichier à nous, qui échoue alors (l'amorçage part 3 fois au lieu d'une). Ne jamais le supprimer pour « faire passer » un merge : restaurer les cinq lignes.
- **Bibliothèque (`ChatInterface.tsx`)** : le chat reste monté lorsqu'un autre onglet est affiché. `ChatInterface.tsx` transmet donc son état `isActive` à `useChatComposerState.ts`, puis à `useSlashCommands.ts`, afin que le retour sur l'onglet Chat relance le scan des commandes et des skills du fournisseur actif. Cette empreinte de trois fichiers CloudCLI est volontaire, générique et limitée à la visibilité de l'onglet ; elle évite tout couplage du chat au plugin PieceMaker et tout rechargement global de l'application.
