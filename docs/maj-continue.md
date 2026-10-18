# Mise à jour continue de l’interface desktop

L’application installée conserve son serveur, ses dossiers et son moteur Electron
en local. Sur macOS et Windows, elle vérifie au lancement puis toutes les trente
minutes si une interface signée est disponible pour sa version complète. Le
téléchargement reste en arrière-plan ; l’activation attend le prochain lancement
de l’application. Aucune page ouverte pendant le travail n’est rechargée pour
appliquer une mise à jour.

Une première release complète contenant ce mécanisme est nécessaire. Les anciennes
applications ne savent pas télécharger ces paquets. Cette branche ne publie aucune
release et ne change pas le numéro de version.

## Périmètre et compatibilité

Un canal appartient à une version complète immuable : `desktop-X.Y.Z`. L’interface
continue est compilée avec le même `package.json`, donc le même `APP_VERSION`, que
le serveur installé. Le workflow compare les sources à `vX.Y.Z` et refuse tout
changement hors de `src/`, `public/`, `pwa/`, `index.html`, `vite.config.js`,
`docs/` et `README.md`. Un changement du serveur, des dépendances, des plugins,
du protocole desktop ou de sa configuration impose une nouvelle version complète.
Les tags de versions complètes doivent rester immuables.

Les onglets de plugins livrés avec l’application gardent leur cycle de mise à jour
actuel. La livraison continue concerne l’interface hôte Electron ; un navigateur
externe ou le téléphone continue à recevoir l’interface embarquée du serveur.
Le mécanisme ne s’applique ni au développement Vite ni aux installations npm seules.

Une publication frontend doit rester compatible fonctionnellement avec les API
existantes : la comparaison des sources garantit un serveur identique, mais ne
prouve pas qu’un nouveau composant utilise correctement son API. Le workflow
exécute les tests frontend et le contrôle TypeScript avant signature.

## Chargement local

`desktop-bootstrap/overlay/electron-piecemaker/ui-updates/` intercepte les requêtes
HTTP de la session Electron pour l’origine exacte du serveur lancé par
`LocalServerController`. La fonction officielle `session.protocol.handle` sert
les ressources du paquet sélectionné ; `session.fetch` avec
`bypassCustomProtocolHandlers: true` transmet les autres requêtes au réseau.
Les URL, cookies, localStorage, API et WebSockets conservent leur origine.
Il n’y a pas de nouveau serveur ni de modification des fichiers CloudCLI.

Le bundle signé de l’application reste intact. Les paquets sont stockés dans
`<CLOUDCLI_HOME>/ui-updates/desktop-X.Y.Z/`, hors de l’application. Le staging
macOS et Windows ajoute `electron-piecemaker/ui-update-runtime.json`. Sous Windows
compact, ce fichier est explicitement décompressé à côté du serveur physique.

Les service workers et leur Cache Storage sont purgés pour cette seule origine
au lancement ; cookies et localStorage sont conservés. Le service worker desktop
devient un simple relais sans cache : le cache local des paquets remplace sa
fonction pour l’interface. Les autres origines de la session restent inchangées.

## Signature et intégrité

La clé publique Ed25519 est versionnée dans `desktop-bootstrap/ui-updates.json`.
La clé privée n’entre jamais dans le dépôt. La clé locale initiale est
`~/.piecemaker/ui-updates-signing.pem`, créée en mode `0600` ; la sauvegarder dans
un emplacement sûr. Sa perte empêche de signer pour les applications existantes.
Sa rotation nécessite une release complète embarquant une nouvelle clé publique.

Le manifeste `ui-update.json` contient une charge JSON signée, identifiant de
runtime, séquence croissante, SHA-256, taille et nom de l’archive. Le client vérifie
la signature avant de télécharger l’archive, puis sa taille, son empreinte et son
contenu. Le paquet est un tableau JSON compressé par gzip, contenant les noms et
les octets base64 des fichiers. Aucun fichier de l’archive n’est exécuté par Node
ni extrait dans le système de fichiers ; les octets frontend sont servis à la
fenêtre isolée Electron. Les chemins non sûrs et doublons sont rejetés.

Limites : 32 Mio téléchargés, 96 Mio de JSON décompressé, 10 000 fichiers,
30 secondes par téléchargement. Les téléchargements exigent HTTPS.
La séquence enregistrée empêche de réinstaller une version déjà essayée, y compris
une interface rejetée. Un retour arrière volontaire est publié avec une nouvelle
séquence et les anciennes sources d’interface.

## Activation et retour arrière

Un téléchargement valide est écrit atomiquement puis marqué `pending` dans
`state.json`. Il ne change jamais le paquet utilisé par la session courante.
Au lancement suivant, le paquet devient `current` avec `trial: true` ; le paquet
précédent reste disponible. Les signatures et empreintes sont revérifiées depuis
le cache, sans connexion réseau.

Le processus Electron confirme le paquet lorsque la page a fini de charger et
que React a rendu un élément dans `#root`, après deux secondes d’observation.
Une exception JavaScript non interceptée au démarrage, une page vide, un échec de
chargement ou la disparition du renderer avant confirmation provoque le repli et le
rechargement. Une fermeture avant confirmation laisse le marqueur d’essai : le
lancement suivant revient à la version précédente. Si le cache est altéré ou
absent, l’interface embarquée reste disponible.

Ce contrôle détecte un échec de démarrage, pas tous les défauts fonctionnels
possibles d’un écran déjà rendu. Le retour arrière éditeur reste nécessaire pour
ces derniers. Pour désactiver entièrement le mécanisme au lancement, définir
`PIECEMAKER_UI_UPDATES=0` ; l’application utilise alors son interface embarquée.

## Préparer GitHub

Dans le dépôt GitHub, configurer l’environnement `ui-updates`, restreindre ses
branches autorisées et y ajouter le secret `PIECEMAKER_UI_SIGNING_KEY` contenant
la clé privée PEM. Aucun secret n’est configuré automatiquement par cette branche.
Exemple, depuis un terminal du mainteneur :

```sh
gh secret set PIECEMAKER_UI_SIGNING_KEY --env ui-updates --repo PieceMaker-Legal/piecemaker-droit-francais < ~/.piecemaker/ui-updates-signing.pem
```

Pour générer ultérieurement une nouvelle paire, avec une destination hors du dépôt :

```sh
node scripts/piecemaker/ui-updates/keygen.mjs /chemin/prive/cle-interface.pem
```

Cette commande refuse d’écraser une clé existante et n’affiche que la clé publique.
Changer la clé publique d’une application existante demande une release complète.

## Publication

Après la première release complète, les pushes de changements UI sur `main`
déclenchent `piecemaker-ui-release.yml`. Le canal correspond au tag `vX.Y.Z`
déduit de `package.json`. Une publication manuelle peut cibler un tag complet
explicitement avec l’entrée `runtime_tag` du workflow. Aucun incrément de version
complète n’est effectué.

Le workflow refuse une divergence du runtime, teste, construit le frontend,
signe le paquet, puis publie une prérelease GitHub `ui-desktop-X.Y.Z`, exclue de
`releases/latest`. Le bouton de mise à jour complète garde donc son fonctionnement
actuel. Les canaux UI ne portent pas de version sémantique complète et ne sont pas
des versions npm.

L’archive est nommée d’après son SHA-256 et envoyée avant le manifeste qui la
référence. Si la publication s’interrompt, le manifeste précédent reste utilisable.
Une séquence inférieure ou identique à celle du canal publié est refusée ; pour
republier une ancienne interface, lancer un nouveau workflow plutôt que relancer
une ancienne exécution. Les canaux sont sérialisés par la concurrence GitHub.

Le workflow `piecemaker-ui-tests.yml` exécute les tests de paquets et un vrai
Electron sur les runners macOS et Windows, pour activation et retour arrière.
La publication de l’interface dépend de la réussite de ce workflow sur les deux
systèmes. Ces tests ne remplacent pas la validation des fonctions métier.
Le test Electron utilise un profil temporaire, un serveur local fictif et des
clés éphémères ; il vérifie POST, cookies, flux HTTP, WebSocket et localStorage.

## Vérification locale sans build

```sh
node --test desktop-bootstrap/overlay/electron-piecemaker/ui-updates/*.test.mjs scripts/piecemaker/ui-updates/*.test.mjs desktop-bootstrap/lib/ui-updates.test.mjs desktop-bootstrap/lib/compact-package.test.mjs
node --experimental-vm-modules --test desktop-bootstrap/overlay/electron-piecemaker/main.test.js
npx --no-install electron scripts/piecemaker/ui-updates/electron-smoke.mjs
npx --no-install electron scripts/piecemaker/ui-updates/electron-smoke.mjs --broken
npx --no-install electron scripts/piecemaker/ui-updates/electron-smoke.mjs --startup-error
```

Aucun build Vite n’est nécessaire pour ces tests. La compilation complète de
l’interface se fait sur les runners GitHub, pas sur le poste de développement.

## Test HTTPS local avec l’interface déjà installée

Sur un Mac équipé de PieceMaker et du binaire Electron de développement :

```sh
node scripts/piecemaker/ui-updates/local-test.mjs
```

Un argument facultatif indique le dossier `Contents/Resources/app` d’une autre
installation. Le test copie seulement son interface compilée dans un dossier
temporaire, utilise un profil Electron vierge et sert des réponses API fictives.
Il ne lance pas le backend de l’application installée et n’accède à aucun dossier.
Il ne construit pas Vite, ne lit pas la clé de signature de production, ne contacte
pas GitHub et ne modifie ni l’application ni les releases.

Le flux utilise réellement HTTPS, avec une clé de signature éphémère et un certificat
local approuvé seulement dans les processus de test via `NODE_EXTRA_CA_CERTS`.
Aucune autorité n’est installée dans le système. Les accès réseau du renderer à
des hôtes externes sont bloqués. Une bannière identifie la fenêtre de test.

Les onze étapes vérifient le téléchargement sans activation immédiate, le lancement
suivant, le fonctionnement hors connexion, le refus des signatures invalides,
des runtimes incompatibles et des archives altérées, le téléchargement d’une
interface vide et son retour arrière, le refus de la réessayer, puis le retour
arrière d’une interface qui a déjà affiché un élément avant de lever une exception.
Le localStorage persiste entre les lancements. Des captures et un `report.json`
restent dans le dossier temporaire annoncé par la commande.

Ce banc valide le transport et le chargement de l’interface de production jusqu’à
l’écran de connexion, avec un serveur fictif. Il ne valide ni les fonctions métier
après connexion, ni un installateur macOS signé complet, ni le parcours Windows.
Une réussite locale n’autorise pas à elle seule une distribution.

Références : [protocol.handle](https://www.electronjs.org/docs/latest/api/protocol),
[session.fetch / bypassCustomProtocolHandlers](https://www.electronjs.org/docs/latest/api/net),
[isolation et sécurité Electron](https://www.electronjs.org/docs/latest/tutorial/security).
