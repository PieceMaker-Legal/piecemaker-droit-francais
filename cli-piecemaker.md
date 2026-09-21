# Commande `piecemaker`

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
(installation des composants Python GLiNER, conversion, MCP) vit
directement dans ce dépôt, sous `server/piecemaker/vendor/installer/` — aucun
clone séparé, aucun processus d'administration distinct : la configuration passe
par l'onglet Dossier › Configuration de l'application elle-même.

`piecemaker` rejoue lui-même les seules étapes du socle dont ce dépôt a
besoin — par `server/piecemaker/vendor/installer/bin/piecemaker.mjs --step
<id> --yes`, en mode non interactif — dans cet ordre : `01-prerequis`, `03-python-gliner`,
`04-conversion-md`, `12-mcp-piecemaker`,
`07-legifrance`. Explicitement exclues :
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

## Sous-commande `conversion`

`piecemaker conversion [--case <chemin>] [--force] [--json] [pièce…]` convertit
et pseudonymise les pièces d'un dossier juridique enregistré. C'est un **client
HTTP** de la porte unique : la requête part sur la boucle locale vers
`POST /api/piecemaker/local/scan`, monté avant l'authentification et refusé à
tout appelant qui n'est pas 127.0.0.1. Le CLI ne détient donc aucun secret, et
la conversion emprunte exactement le même service, la même file d'attente et la
même exclusivité GLiNER que l'interface.

Conséquences :

- serveur arrêté ⇒ il est **démarré automatiquement** avant la conversion ;
- sans serveur joignable, la conversion échoue au lieu de lancer un Python isolé ;
- `--force` renvoie la liste complète des pièces, ce que la porte unique traite
  comme une reconversion (elle n'ajoute `--skip-existing` que si aucune pièce
  n'est nommée) ;
- tous les Markdown vont dans `Fichiers convertis PieceMaker`.

L'outil MCP `conversion` appelle cette même sous-commande.

Réinstaller la commande après un `git pull` qui la modifie :

```
node scripts/piecemaker/cli/install-command.mjs
```

Réglages par variables d'environnement : `PIECEMAKER_APP_DIR`,
`PIECEMAKER_APP_PORT`, `PIECEMAKER_VITE_PORT`.

Une mise à jour n'est jamais forcée : un dépôt qui porte des modifications
locales ou une branche divergente est signalé et laissé intact.
