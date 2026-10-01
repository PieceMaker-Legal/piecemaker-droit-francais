# Plugins PieceMaker

Référence unique pour **écrire, compiler, installer ou modifier l'installation** d'un plugin PieceMaker. Toute fonctionnalité PieceMaker autonome (un écran + sa logique) passe par un plugin : il vit dans `plugins/piecemaker-*/`, hors des fichiers CloudCLI, et ne crée aucune empreinte de merge. Pour renommer ce qui existe déjà dans l'UI, c'est la surcharge i18n (`i18n-et-plugins.md`), pas un plugin.

Règle d'or : **un seul contrat, une seule chaîne, un seul chemin d'installation.** Aucun plugin n'a son propre `install.mjs`, `build.mjs` ou `launcher.mjs`, et aucune liste de plugins n'est écrite à la main nulle part. Le test `plugins/toolchain/toolchain.test.mjs` le vérifie.

## Contrat d'un plugin

```
plugins/piecemaker-<nom>/
  manifest.json        contrat hôte + piecemakerSources
  icon.svg
  src/…                sources (TS ou JS), compilées par la chaîne commune
  package.json         facultatif : tests / typecheck du plugin uniquement (pas de script build)
  README.md            facultatif : fonctionnel, pas d'instructions d'installation
```

`manifest.json` :

```json
{
  "name": "piecemaker-<nom>",
  "displayName": "…",
  "version": "1.0.0",
  "icon": "icon.svg",
  "type": "module",
  "slot": "tab",
  "entry": "dist/index.js",
  "server": "launcher.mjs",
  "piecemakerInjections": ["dist/sidebar.js"],
  "piecemakerSources": {
    "index": "src/index.ts",
    "server": "src/server.ts",
    "sidebar": "src/sidebar.ts"
  }
}
```

- `name` = nom du dossier ; `entry` vaut toujours `dist/index.js`.
- `piecemakerSources.index` (obligatoire) : l'onglet, compilé pour le navigateur vers `dist/index.js`. Il exporte `mount(container, api)` / `unmount(container)`.
- `piecemakerSources.server` (facultatif) : le serveur, compilé pour Node vers `dist/server.mjs`. Présent ⇔ `"server": "launcher.mjs"` ; le lanceur est fourni par la chaîne, jamais par le plugin.
- Toute autre clé `k` : injection compilée vers `dist/k.js` ; `piecemakerInjections` doit lister exactement ces fichiers.
- Monter `version` à chaque changement visible ; l'installation, elle, se fie à l'empreinte du contenu compilé, pas à la version.
- Un serveur lit `../runtime.json` (relatif à `dist/server.mjs`) : `nodePath`, `applicationRoot`, `databasePath`, `secret`, `claudePath`, `codexPath`, `codexLauncher`. Il refuse toute requête dont l'en-tête `x-plugin-secret-access` ne vaut pas `secret`. Un module natif (`better-sqlite3`) se charge depuis l'application : `createRequire(path.join(runtime.applicationRoot, 'package.json'))`.
- Un état persistant va **hors** du dossier du plugin (`~/.piecemaker/<plugin>`, base de l'hôte…) : ce dossier est remplacé à chaque mise à jour.

`node plugins/toolchain/cli.mjs --check` valide tous les manifestes sans rien écrire.

## Chaîne commune : `plugins/toolchain/`

| Fichier | Rôle |
|---|---|
| `build.mjs` | `discoverPlugins` (tout `plugins/piecemaker-*` doté d'un manifest), `validatePlugin`, `buildPlugins({ appRoot, outDir })` : compile avec l'esbuild **de l'application**, produit un bundle. Tout échec est bloquant : jamais de bundle avec un plugin en moins. |
| `sync.mjs` | `syncPlugins({ bundleDir, dataRoot, databasePath })` : installe un bundle dans le répertoire de données. Autonome (seulement `node:*`), copié dans chaque bundle. |
| `launcher.mjs` | Lanceur commun des serveurs : l'hôte le lance avec le `node` du PATH, il relance `dist/server.mjs` avec `runtime.nodePath` (ABI des modules natifs). |
| `index.mjs` | `installPlugins({ appRoot, rebuild })` (compile dans `<app>/.piecemaker-plugins` puis installe), `dataRootFor`, `databasePathFor`. |
| `cli.mjs` | `npm run plugins` : compile et installe depuis le dépôt ; `--check` : validation seule. |

Un bundle contient un dossier prêt à installer par plugin (`manifest.json`, icône, `dist/`, `launcher.mjs` s'il a un serveur), `bundle.json` (empreinte de chaque plugin, présence d'un serveur, runtime figé à la construction : Node courant, racine de l'application, CLI `claude`/`codex`) et `sync.mjs`.

`syncPlugins` :

- recopie tout plugin absent ou dont l'empreinte diffère du marqueur `.piecemaker-bundle`, via un dossier `.tmp-*` renommé (ignoré par `scanPlugins()` pendant la copie) ;
- désinstalle un plugin qui porte le marqueur mais a disparu des sources ; ne touche jamais un plugin installé depuis Git (*Settings > Plugins*), qui n'a pas de marqueur ;
- conserve dans `plugins.json` le choix activé/désactivé de l'utilisateur ; tire une fois le secret `secrets.access` d'un plugin à serveur, puis le garde ;
- réécrit `runtime.json` de chaque plugin à serveur (runtime du bundle + `databasePath` + `secret`).

Aucun secret n'est jamais embarqué dans un bundle ni dans l'application.

## Qui installe, et quand

Les trois voies appellent la même chaîne ; seul le moment change. Dans tous les cas, l'installation a lieu **avant** le démarrage du serveur : l'hôte ne scanne les plugins et ne lance leurs serveurs qu'à son démarrage, et l'interface ne lit la liste qu'au chargement.

1. **Application Electron (voie principale).** `desktop-bootstrap/lib/build.mjs` appelle `embedBundledPlugins` (`desktop-bootstrap/lib/plugins.mjs`), qui compile le bundle dans le paquet sous `piecemaker-plugins/`. À **chaque démarrage**, l'overlay `desktop-bootstrap/overlay/electron-piecemaker/main.js` importe `piecemaker-plugins/sync.mjs` et l'exécute avant `electron/main.js` (`databasePath` = `DATABASE_PATH` ou `<données>/auth.db`, comme `electron/localServer.js`). Un plugin supprimé du répertoire de données revient donc au lancement suivant. `desktop-bootstrap/lib/place.mjs` (`quitRunningApplication`) ferme l'instance ouverte avant de remplacer l'application, sinon `open`/`start` ramènerait l'ancienne au premier plan avec ses anciens plugins — sauf avec `--no-launch` : la mise à jour intégrée (`server/piecemaker/desktop-update`) exécute l'installeur depuis le serveur de l'application, puis la quitte et la relance elle-même ; c'est ce redémarrage qui installe les plugins.
2. **Commande `piecemaker`.** `scripts/piecemaker/cli/lib/plugins.mjs` charge `plugins/toolchain/index.mjs` du dépôt : recompilation complète en mode normal, réinstallation depuis le dernier bundle avec `--launch-only` ; l'application est relancée si un plugin a changé.
3. **Développement.** `npm run plugins` après une modification, puis relancer le serveur.

Répertoire de données : `CLOUDCLI_HOME`, sinon `~/<dataDirectoryName>` de `product.config.json` (`~/.piecemaker-droit-francais`), comme `productDataRoot()` (`shared/product-config.mjs`) utilisé par `plugin-registry.service.ts`.

Les installations d'Electron et de `piecemaker` se font depuis la **dernière release publiée** (`install.sh` / `install.ps1` téléchargent le tag) : un changement de plugin n'atteint les utilisateurs qu'après une release.

Limite connue : le runtime d'un plugin à serveur référence le Node et les sources utilisés pour la construction (`~/.piecemaker/bootstrap/src/<tag>` pour Electron) ; les supprimer casse ces serveurs jusqu'à la construction suivante.

## Ajouter un plugin

1. Créer `plugins/piecemaker-<nom>/` selon le contrat ci-dessus (partir de `plugins/starter/` pour l'API).
2. `node plugins/toolchain/cli.mjs --check`, puis `npm run plugins`.
3. `node --test plugins/toolchain/toolchain.test.mjs`.

Rien d'autre : ni liste à compléter, ni installateur, ni étape Electron à modifier.

## Ce que l'hôte permet (système de plugins CloudCLI)

- **Un seul emplacement : un onglet.** `ALLOWED_SLOTS = ['tab']` (`server/modules/plugins/plugin-registry.service.ts`). L'hôte donne un `<div>` vide et appelle `mount(container, api)` / `unmount(container)`.
- **API hôte minuscule** (`plugins/starter/src/types.ts`) : `context` (thème, projet, session), `onContextChange`, `rpc`. Pas d'accès au store, au routeur, à i18next ni aux composants CloudCLI : un plugin porte ses propres traductions.
- **Serveur** : lancé par `spawn('node', …)` en sous-processus, environnement réduit (`buildPluginEnv`, `plugin-process.service.ts`), port local aléatoire, une seule fois au démarrage de l'hôte (`startEnabledPluginServers`). Le front l'atteint via `api.plugins.rpc()` proxifié par `router.all('/:name/rpc/*')`. Les secrets de `plugins.json` sont injectés en en-têtes `x-plugin-secret-*` par l'hôte, jamais exposés au navigateur.
- **Chargement front** : `PluginTabContent.tsx` récupère `entry` via l'API authentifiée puis l'importe par Blob URL, et remonte le plugin à chaque changement de `entry`/`enabled`. `PluginsContext` ne lit la liste qu'au chargement de l'interface.
- **Injections (extension PieceMaker)** : `src/piecemaker/plugin-injections/` (importé par `src/piecemaker/anonymizer/bootstrap.ts`) charge au démarrage chaque fichier de `piecemakerInjections` des plugins activés et appelle son `inject({ rpc, openTab })`, qui renvoie une fonction de nettoyage. `piecemaker-tabular-review` s'en sert pour le bouton « Tabular review » de la barre latérale.
- **Plugins externes** : URL Git collée dans *Settings > Plugins* → clone, `npm install`, build par l'hôte. Mécanisme upstream inchangé, distinct de la chaîne PieceMaker.

À lire avant d'écrire un plugin : `plugins/starter/README.md` et `plugins/starter/src/{types,index,server}.ts`, puis `server/modules/plugins/{plugin-registry,plugin-process,plugins}.service.ts` et `plugins.routes.ts`, enfin `src/modules/plugins/PluginTabContent.tsx`. Doc en ligne : https://cloudcli.ai/docs/plugin-overview.

Le code serveur de l'hôte peut importer les sources d'un plugin (`server/piecemaker/knowledge/*` importe `plugins/piecemaker-dossier/src/*`) : garder ces modules sans dépendance au navigateur.
