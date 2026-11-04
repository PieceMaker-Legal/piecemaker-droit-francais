# Pack Catala

L'app de bureau installe le pack Catala. L'agent l'utilise par `pm catala` et le skill `catala`. Aucune interface graphique.

## Contenu

| Outil | macOS arm64 | Windows x64 |
| --- | --- | --- |
| `catala`, `clerk`, `catala-lsp`, `catala-format`, `catala-dap` | oui, compilés par opam | oui, MSI officiel 1.3.0 |
| runtime Python Catala | oui, dans le pack | oui, dans le pack |
| `catala-proof` et Z3 5.1.0 | oui | non : le MSI ne les fournit pas |
| `catleg==0.2.9` | Python partagé | Python partagé |

Les versions sont figées dans `desktop-bootstrap/composants/catala-pack.json` : commit Catala, commit du serveur de langage, compilateur, paquets opam, URL et SHA-256 du MSI.

## Installation

1. Au démarrage de l'app empaquetée, `overlay/electron-piecemaker/catala-pack.mjs` lance `desktop-bootstrap/composants/catala.mjs` en tâche de fond, avec le Node d'Electron (`ELECTRON_RUN_AS_NODE=1`).
2. Le script calcule l'identifiant du pack à partir de la recette. Si `pack.json` porte cet identifiant et que le dossier contient `ready`, il s'arrête.
3. Sinon, il prend un verrou et installe le pack dans `<racine>/catala/<id>/`.
   - macOS : Homebrew installe `opam` si besoin. `OPAMROOT` est privé au pack ; switch `ocaml-base-compiler`, pins GitHub, `opam install` des versions exactes. Sans Homebrew, l'état est `indisponible`.
   - Windows : téléchargement du MSI, contrôle SHA-256, extraction administrative (`msiexec /a`), configuration des grammaires, suppression du MSI.
4. Il vérifie `catala --version` et, sur macOS, `catala proof --help`.
5. Il écrit `pack.json`, puis supprime les anciens packs marqués `.piecemaker-catala.json`. Une installation échouée garde l'ancien pack.

`<racine>` vaut `PIECEMAKER_COMPONENTS_HOME`, sinon `PIECEMAKER_HOME`, sinon `~/.piecemaker`. Une nouvelle recette arrive avec la mise à jour suivante de l'app.

`catleg` et ses dépendances sont dans `macos-arm64-requirements.txt` et `windows-requirements.txt` : la CI les installe dans le Python partagé (`config.json` › `pythonPath`). Aucun venv propre au pack.

## Fichiers lus par une interface future

`<racine>/catala/status.json` :

```json
{ "state": "pret | installation | en-cours | indisponible | echec", "id": "…", "step": "install", "error": "…", "updatedAt": "ISO 8601" }
```

`<racine>/catala/pack.json` : `id`, `platform`, `catala`, `version`, `prefix`, `bin` (un chemin par outil), `path`, `env`, `runtimePython`, `proof`, `installedAt`. Journal : `<racine>/catala/install.log`.

## Classement

Un programme vit dans `.piecemaker/raisonnements/<nom>/`, à côté de `<nom>.yaml` qu'il code. Même nom, même règle de nommage. Un dossier peut contenir plusieurs programmes ; `--raisonnement <nom>` choisit le programme. Un programme est un dossier avec `clerk.toml`. `listReasoningFiles` ne lit que les fichiers `.yaml` : les dossiers ne le gênent pas.

## Commandes

| Commande | Effet | Résultat |
| --- | --- | --- |
| `pm catala verifier --raisonnement <nom>` | typecheck avec invariants, format, tests clerk, tests Python | `resultats/verification.json`, `tests.json` |
| `pm catala formater` | `catala-format --in-place` | fichiers réécrits |
| `pm catala preuve --scope <Champ> [--fichier F] [--whole-program]` | `clerk start`, puis `catala proof` | `resultats/preuve.json` |
| `pm catala catleg [--fichier F]` | vigueur des articles cités, identifiants PISTE de PieceMaker | `resultats/catleg.json` |
| `pm catala lister` / `env` | programmes et dernier bilan / pack, état, Python | sortie |
| `pm catala exec <outil> -- <args>` | lance un outil du pack (LSP, DAP, autres) | code de sortie |

`verification.json` : `started_utc`, `finished_utc`, `programme`, `passed`, `sources_sha256`, `checks[]` (`name`, `command`, `exit_code`, `seconds`, `passed`, `files`). Un journal `resultats/<contrôle>.log` par contrôle. `preuve.json` ajoute `fichier`, `scope`, `conflits`. `catleg.json` : `date_controle`, `passed`, `fichiers[]` (`fichier`, `exit_code`, `passed`, `messages`).

Une preuve réussit si `catala proof` sort à 0, écrit « No errors found » et aucun `[WARNING]` : un chevauchement d'exceptions sort aussi à 0.

## Limites

- catleg contrôle la vigueur à la date du jour seulement.
- Une preuve porte sur le programme, pas sur les faits.
- Le lien avec les pièces passe par une table des sources que l'avocat construit.
- Windows : pas de preuve. Installation non testée sur un poste Windows ; `msiexec /a` sans élévation non vérifié ; un exe en cours d'usage peut bloquer le remplacement d'un pack.
- `clerk` avec des espaces dans le chemin du dossier : non vérifié.
- `catleg` n'est dans le Python partagé qu'après le prochain build CI de ce Python.
- LSP et DAP ne sont pas testés automatiquement.
