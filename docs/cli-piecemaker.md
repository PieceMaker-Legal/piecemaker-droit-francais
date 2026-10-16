# Commande `piecemaker`

Point d'entrée unique de la plateforme, pour l'utilisateur final : une seule
commande, aucune question posée.

```
piecemaker
```

Elle enchaîne, dans cet ordre : clonage du dépôt s'il est absent, mise à jour
en avance rapide, installation des dépendances quand le verrou a bougé,
installation des plugins PieceMaker, libération des ports (5173, 3003) et
démarrage de l'application (qui porte son propre proxy PII), installation des
composants du socle, installation de la PWA, ouverture. Sautée en entier avec
`--launch-only`, qui se contente de réparer les plugins manquants ou périmés
(puis relance l'application si elle tournait) et de démarrer l'application si
elle est arrêtée.

Les plugins sont installés **avant** le démarrage, jamais après, par la chaîne
commune `plugins/toolchain` (recompilation complète, ou réinstallation depuis le
dernier bundle avec `--launch-only`) : voir `docs/plugins.md`.

Pour l'application de bureau destinée aux utilisateurs, voir
[installation-app-electron.md](installation-app-electron.md)
(`desktop-bootstrap/install.sh` / `install.ps1`). La commande `piecemaker`
ci-dessous est la voie développeur / PWA.

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
(installation des composants Python GLiNER, conversion, MCP) vit
directement dans ce dépôt, sous `server/piecemaker/vendor/installer/` — aucun
clone séparé, aucun processus d'administration distinct : la configuration passe
par l'onglet Dossier › Configuration de l'application elle-même.

`piecemaker` rejoue lui-même les seules étapes du socle dont ce dépôt a
besoin — par `server/piecemaker/vendor/installer/bin/piecemaker.mjs --step
<id> --yes`, en mode non interactif — dans cet ordre : `01-prerequis`, `03-python-gliner`,
`04-conversion-md`, `12-mcp-piecemaker`,
`07-legifrance`. `03-python-gliner` y tourne avec `PIECEMAKER_SKIP_MODELS=1` :
le venv et les bibliothèques sont installés, pas le modèle GLiNER2-PII ;
`04-conversion-md` n'installe pas MinerU. Ces modèles locaux se téléchargent
automatiquement à l'ouverture de l'application. L'icône en haut à gauche
(avec un point bleu pendant la préparation) et le bouton de l'onglet Dossier
ouvrent le suivi « Système de pseudonymisation ». Explicitement exclues :
les hooks et les skills (`06-hooks`, `09-claude-assets`, `09-codex-plugin`,
`13-garde-secrets`), ainsi que `00`, `02`, `08`, `10-*`, `11`.
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

## Relancer depuis la PWA sur macOS

La page de secours reprend la carte de connexion, son logo et le thème choisi
dans l'interface. Elle embarque son HTML, son CSS, son JavaScript et son logo :
elle reste affichable quand le serveur est arrêté. Une navigation qui échoue,
ou reçoit une réponse serveur 5xx, affiche cette page.

Sur le Mac qui héberge la PWA du CLI (`localhost:5173`, ou son port configuré),
le bouton **Relancer PieceMaker** ouvre `piecemaker-relaunch://start`.
L'installation PWA du CLI enregistre un relais AppleScript signé localement
dans `~/.piecemaker/applications/PieceMaker Relance.app` (sous `PIECEMAKER_HOME`
si défini). Il ne reconnaît que cette URL exacte et lance la commande
`piecemaker --launch-only` en arrière-plan, sans ouvrir une seconde fenêtre.
Le navigateur peut demander l'autorisation d'ouvrir PieceMaker au premier clic.

La page interroge `/api/auth/status` et `/` sans cache toutes les 2,5 secondes et
recharge l'URL courante dès que le serveur et l'interface répondent.
Sur téléphone ou depuis une autre machine, le bouton devient **Réessayer** :
il ne lance aucun programme sur l'appareil qui affiche la page. Le texte
indique de rallumer l'ordinateur et d'ouvrir PieceMaker si celui-ci est éteint,
puis la reconnexion se fait automatiquement. Les autres installations locales
sont invitées à ouvrir leur application PieceMaker.

Le service worker CloudCLI `pwa/service-worker.js` reste intact. Le module
`scripts/piecemaker/pwa/service-worker.mjs` lui préfixe un gestionnaire de
navigation, avant ses gestionnaires existants. L'exception ciblée dans
`vite.config.js` importe ce module et enveloppe la source générée, aussi bien
en développement que lors du packaging. Le test
`scripts/piecemaker/pwa/service-worker.test.mjs` protège ce branchement et le
maintien des gestionnaires de notifications upstream. Le test macOS
`scripts/piecemaker/cli/lib/relaunch-macos.test.mjs` compile et signe un relais
temporaire, vérifie le schéma déclaré et exécute un faux lanceur.

Après mise à jour, un lancement du CLI installe le relais. Il faut ouvrir la
PWA une fois avec le serveur actif pour qu'elle récupère le nouveau worker ;
une ancienne page Offline déjà ouverte ne peut pas se mettre à jour sans lui.

## Sous-commande `conversion`

`piecemaker conversion [--case <chemin>] [--force] [--json] [pièce…]` convertit
et pseudonymise les pièces d'un dossier juridique enregistré. C'est un **client
HTTP** de la porte unique : la requête part en clair sur la boucle locale vers
`POST /api/piecemaker/local/scan` du serveur applicatif déjà lancé — celui
qu'annonce `local-server.json` dans le dossier de données (application de
bureau comprise), sinon `PIECEMAKER_APP_PORT` (3003 par défaut) —, monté avant
l'authentification et
refusé à tout appelant qui n'est pas 127.0.0.1. Le CLI ne détient donc aucun
secret, et la conversion emprunte exactement le même service, la même file
d'attente et la même exclusivité GLiNER que l'interface.

Conséquences :

- un `PIECEMAKER_APP_PORT` explicite l'emporte sur `local-server.json` ;
- serveur applicatif arrêté ⇒ il est **démarré automatiquement** avant la
  conversion, par `startApplication` du CLI principal, donc avec son proxy PII ;
- sans serveur joignable, la conversion échoue au lieu de lancer un Python isolé ;
- `--force` renvoie la liste complète des pièces, ce que la porte unique traite
  comme une reconversion (elle n'ajoute `--skip-existing` que si aucune pièce
  n'est nommée) ;
- tous les Markdown vont dans `Fichiers convertis PieceMaker`.

L'outil MCP `conversion` appelle cette même sous-commande. Il déclare les
annotations MCP `destructiveHint: false` et `openWorldHint: false` : sans elles,
Codex exige une approbation et, lancé par PieceMaker avec `approval_policy =
never`, refuse l'appel (« MCP tool call requires approval, but approval policy
is never »).

## Sous-commande `renommage`

`piecemaker renommage [--case <chemin>] [--json] <pièce> <AAAA-MM-JJ_titre>`
renomme une pièce dans son dossier, par la même porte unique
(`POST /api/piecemaker/local/rename`). Son Markdown prend le même nom et l'état
PieceMaker suit la pièce (voir `protection-pieces.md`). La pièce se désigne
comme pour `conversion` (nom ou chemin relatif). L'outil MCP `renommage`
n'existe plus : l'IA renomme une pièce par l'outil MCP `sql` (`UPDATE` du
`label`, voir `outil-sql.md`).

Réinstaller la commande après un `git pull` qui la modifie :

```
node scripts/piecemaker/cli/install-command.mjs
```

Réglages par variables d'environnement : `PIECEMAKER_APP_DIR`,
`PIECEMAKER_APP_PORT`, `PIECEMAKER_VITE_PORT`.

Une mise à jour n'est jamais forcée : un dépôt qui porte des modifications
locales ou une branche divergente est signalé et laissé intact.
