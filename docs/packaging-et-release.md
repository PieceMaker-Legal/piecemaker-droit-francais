# Packaging, release et distribution

## Package npm public PieceMaker

Depuis une copie propre, régénérer le paquet avec les derniers commits
récupérables :

```sh
npm run package:release
```

Cette commande incrémente la version patch, construit le client et le serveur,
puis crée l'archive `.tgz` dans `release/npm/`. Pour publier sur npm et pousser
le commit de version :

```sh
npm login
PUBLISH=1 PUSH=1 npm run package:release
```

Une fois publié, l'installation utilisateur ne nécessite aucun token :

```sh
npm install -g @piecemaker-legal/piecemaker
piecemaker
```

`piecemaker` starts the Node.js server, waits for its health endpoint, and
opens the application in an isolated Chrome/Edge/Brave/Chromium app window
(`--app=...`), not in a normal browser tab. `PWA_URL` and `PWA_PROFILE_DIR`
can override the URL and local browser profile when needed.

Le paquet publié contient l'attribution CloudCLI et reste sous AGPL-3.0-or-later.

## Package GitHub Packages public

Le chemin npmjs reste disponible. Pour publier aussi le paquet sur GitHub
Packages, le script utilise le registre npm GitHub sans supprimer la
configuration npmjs :

```sh
npm run package:github:release
```

Pour réellement publier et pousser la version :

```sh
npm login --scope=@piecemaker-legal --auth-type=legacy --registry=https://npm.pkg.github.com
PUBLISH=1 PUSH=1 npm run package:github:release
```

La publication exige une authentification du mainteneur auprès de GitHub ;
aucun token n'est créé ni enregistré par le dépôt. Après publication, régler
la visibilité du package sur **Public** dans GitHub Packages. La possibilité
d'une installation anonyme dépend ensuite des règles d'accès du registre
GitHub ; si elle est indispensable, npmjs public reste le registre garanti
pour une installation sans token.

## Construire le Desktop sans certificat

Les scripts locaux déclarés dans `package.json` sont les suivants :

```sh
npm ci
npm run desktop:pack
npm run desktop:dist:mac -- --publish never
npm run desktop:dist:win -- --publish never
```

`desktop:pack` produit une application macOS/Windows décompressée et ne
cherche pas de certificat avec `CSC_IDENTITY_AUTO_DISCOVERY=false`. Les
commandes `desktop:dist:mac` et `desktop:dist:win` produisent respectivement
un `.dmg` et un installateur NSIS `.exe` dans `release/desktop`.

Le `package.json` upstream porte encore `productName: CloudCLI`,
`appId: ai.cloudcli.desktop` et un nom d'artefact `cloudcli-desktop-*`. Le
script `scripts/release/prepare-desktop-app.js` remplace ces trois valeurs
dans l'application staged par celles de `product.config.json` ; le build
PieceMaker produit donc normalement des artefacts nommés
`piecemaker-droit-francais-desktop-*`, tout en embarquant le runtime CloudCLI.

Pour un test local sans identité de signature, utiliser les variables
suivantes :

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false npm run desktop:dist:mac -- --publish never
CSC_IDENTITY_AUTO_DISCOVERY=false npm run desktop:dist:win -- --publish never
```

Sur macOS, `build.mac.notarize` est à `true` dans `package.json`, mais
electron-builder ne lance la notarisation que si des identifiants Apple sont
présents ; sans eux, il avertit et saute cette étape. Cela peut donc produire
un DMG de test non signé ou non notarisé localement. Le workflow
`desktop-release.yml` est plus strict : son étape de vérification échoue avant
le build si `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` ou `APPLE_TEAM_ID` manque. Il n'existe donc pas
de release macOS publique via ce workflow sans certificat Developer ID
Application et accès à la notarisation Apple. Les triplets de credentials
Apple API key sont acceptés par electron-builder, mais ne satisfont pas les
tests actuels de ce workflow, qui imposent la variante Apple ID.

Sur Windows, le workflow choisit le build signé si
`WINDOWS_CSC_LINK` et `WINDOWS_CSC_KEY_PASSWORD` sont présents ; sinon il
force `CSC_IDENTITY_AUTO_DISCOVERY=false` et publie un `.exe` non signé. Un
certificat autosigné n'est pertinent que pour un parc interne dont le
certificat a été installé comme autorité de confiance. Pour une distribution
publique, il reste non approuvé et ne supprime pas l'avertissement Microsoft
Defender SmartScreen ; il faut un certificat de signature reconnu par
Microsoft et une réputation de publication suffisante.

Un binaire macOS non signé ou seulement autosigné n'est pas une distribution
publique équivalente : Gatekeeper peut bloquer son ouverture ou afficher un
développeur non identifié. Un utilisateur peut l'autoriser manuellement dans
les réglages de sécurité, mais cette procédure ne doit pas être la promesse
de la release. La signature Developer ID et la notarisation Apple sont les
prérequis pour une installation distribuée normalement. De même, un `.exe`
Windows non signé peut être téléchargé mais déclenche généralement un
avertissement SmartScreen et affiche un éditeur inconnu.

Ni le paquet npm ni le workflow Desktop ne mettent automatiquement à jour une
installation déjà installée : la mise à jour npm ou la réinstallation du
nouvel artefact Desktop reste à déclencher par le distributeur.

Le commit `72d347e` (`fix(piecemaker): suivre les releases du produit`) a
redirigé la détection de version de la Sidebar et de l'onglet À propos vers le
dépôt défini par `product.config.json`, avec repli CloudCLI upstream si la
configuration est absente. La release PieceMaker doit donc être publiée dans
ce dépôt et porter le nom explicite ci-dessus ; publier seulement une release
CloudCLI upstream ne déclenche pas la détection PieceMaker.

## Publier une nouvelle version (@piecemaker-legal/piecemaker)

**Pipeline recommandé : `release.yml` (release-it), pas `publish-npm-package.yml` seul.**

`publish-npm-package.yml` ne fait que publier sur npm — il ne crée ni tag ni Release GitHub. Or la pastille "mise à jour disponible" dans l'app (sidebar/About, hook `useVersionCheck`) interroge l'API GitHub Releases, pas npm. Publier avec `publish-npm-package.yml` seul rend donc la nouvelle version disponible sur npm sans jamais notifier les utilisateurs dans l'app. `release.yml` fait les deux en une fois : bump de version, tag git, Release GitHub, publish npm.

**Commande** :
1. Demander à l'utilisateur le numéro de version ou l'incrément (`patch` / `minor` / `major` / version explicite `X.Y.Z`) — ne jamais déduire ou incrémenter automatiquement.
2. `gh workflow run release.yml --repo PieceMaker-Legal/piecemaker-droit-francais -f increment=<patch|minor|major|X.Y.Z>` (option `-f release_name="..."` pour un nom de release custom).
3. Suivre : `gh run list --workflow release.yml --limit 1` puis `gh run view <id> --json status,conclusion` (poll par petits `sleep`, `gh run watch` dépasse souvent le temps d'exécution disponible). En cas d'échec : `gh run view <id> --log-failed`.

**Effets** : nouvelle version publiée sur `https://registry.npmjs.org/@piecemaker-legal%2fpiecemaker`, tag et Release GitHub créés, pastille "mise à jour disponible" visible dans l'app pour tous les utilisateurs (mode git : bouton "Update now" → `git pull && npm install` ; mode npm : → `npm update -g`).

`publish-npm-package.yml` reste disponible pour un publish npm isolé (test, hotfix sans notification), mais n'est plus la voie par défaut pour une release utilisateur.

## Installation utilisateur (README)

Voie principale, sans prérequis (bootstrap Node via nvm si absent) :
- macOS/Linux : `curl -fsSL https://raw.githubusercontent.com/PieceMaker-Legal/piecemaker-droit-francais/main/scripts/piecemaker/cli/piecemaker.sh | sh && piecemaker`
- Windows : `irm https://raw.githubusercontent.com/PieceMaker-Legal/piecemaker-droit-francais/main/scripts/piecemaker/cli/piecemaker.ps1 | iex; piecemaker`

Le `&& piecemaker` final est volontaire : la commande doit se terminer par le lancement effectif de l'app PWA, pas seulement par l'installation.

L'ancienne commande `npm install -g @piecemaker-legal/piecemaker` (voie npm classique, suppose Node déjà présent) a été retirée du README au profit de cette voie universelle. La section GitHub Packages (registre distinct) reste inchangée.

## Régénérer package-lock.json

Toujours le faire avec la même version de Node/npm que la CI (`Node 22` → npm 10.x), pas avec la version par défaut du poste (souvent plus récente, ex. Node 24/npm 11). Une résolution faite avec un npm plus récent peut ajouter des entrées imbriquées différentes (versions dupliquées de dépendances transitives) que `npm ci` sous npm 10 ne reconnaît pas, avec l'erreur `Missing: <pkg> from lock file`.

Commande : `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 && rm -rf node_modules package-lock.json && npm install`. Valider ensuite avec `npm ci` (toujours sous Node 22) avant de commit/push — c'est le test qui simule exactement ce que la CI va faire.

## Nom des Releases GitHub (rebrand CloudCLI → PieceMaker)

`.release-it.json` (`github.releaseName`) et le header du changelog (`plugins.@release-it/conventional-changelog.header`) étaient hérités du fork CloudCLI et généraient des releases nommées "CloudCLI UI vX.Y.Z". Corrigé pour "PieceMaker vX.Y.Z" (et changelog "PieceMaker"). Le commentaire du workflow_dispatch input `release_name` dans `.github/workflows/release.yml` a aussi été aligné (cosmétique, ne change pas le comportement — c'est juste la description de l'input par défaut).

Testé via `release.yml` (increment=patch, 1.0.3 → 1.0.4) : la Release créée s'appelle bien "PieceMaker v1.0.4". Les releases antérieures ("CloudCLI UI vX.Y.Z") restent inchangées dans l'historique, seules les nouvelles suivent le nouveau nom.

Si un autre nom de release custom est voulu ponctuellement, utiliser l'option `-f release_name="..."` de `gh workflow run release.yml` plutôt que de modifier `.release-it.json`.
