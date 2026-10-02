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

# Plugins

Tout ce qui concerne les plugins (contrat, compilation, installation Electron et CLI, API de l'hôte) est dans **`plugins.md`**. Ici ne reste que la frontière avec la surcharge i18n — les deux leviers ne se recouvrent pas :

| | Surcharge i18n | Plugin |
|---|---|---|
| Sert à | renommer ce qui existe déjà (vocabulaire, marque) | ajouter ce qui n'existe pas (écran + logique métier) |
| Portée | toutes les vues CloudCLI, avant le premier rendu | son seul onglet, monté à la demande |
| Accès à l'hôte | l'instance i18next, rien d'autre | `context` / `onContextChange` / `rpc`, rien d'autre |
| Backend | aucun | sous-processus Node optionnel |
| Livraison | dans le dépôt, buildé avec l'app | `plugins/piecemaker-*/`, compilé et installé par `plugins/toolchain` |
| Empreinte upstream | 3 lignes dans `src/modules/i18n/config.ts` | nulle |

Corollaire : un plugin ne peut pas rebrander l'UI, et les overrides ne peuvent pas héberger une fonctionnalité. Un plugin porte ses propres traductions — l'i18n de l'hôte ne l'atteint pas.

## Exceptions upstream assumées

- **Auth (`AuthContext.tsx`)** : l'amorçage d'authentification ne doit se jouer qu'au montage. Le jeton est lu par une `ref` et `token` est hors des dépendances de `checkAuthStatus` ; sans cela, l'en-tête `X-Refreshed-Token` (rotation à la demi-vie, `server/modules/auth/auth.middleware.ts`) rejoue l'effet, remet `isLoading` à vrai, et `ProtectedRoute` démonte tout le sous-arbre `<Router>` — dossier sélectionné, onglet actif, chat et terminal perdus, retour à « Choisissez votre dossier ». Ni marque ni isolation de données : l'exception se justifie parce qu'aucun correctif côté PieceMaker ne peut réparer un démontage global. **Un merge qui résout ce fichier vers CloudCLI réintroduit le bug en silence** : le garde-fou est `src/piecemaker/auth/tests/authSessionSurvivesTokenRotation.test.tsx`, fichier à nous, qui échoue alors (l'amorçage part 3 fois au lieu d'une). Ne jamais le supprimer pour « faire passer » un merge : restaurer les cinq lignes.
- **Bibliothèque (`ChatInterface.tsx`)** : le chat reste monté lorsqu'un autre onglet est affiché. `ChatInterface.tsx` transmet donc son état `isActive` à `useChatComposerState.ts`, puis à `useSlashCommands.ts`, afin que le retour sur l'onglet Chat relance le scan des commandes et des skills du fournisseur actif. Cette empreinte de trois fichiers CloudCLI est volontaire, générique et limitée à la visibilité de l'onglet ; elle évite tout couplage du chat au plugin PieceMaker et tout rechargement global de l'application.
