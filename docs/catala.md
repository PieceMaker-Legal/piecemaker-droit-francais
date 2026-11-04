# Pack Catala

L'app de bureau installe le pack Catala. L'agent l'utilise par `pm catala` et le skill `catala`. L'avocat voit l'état et les bilans dans l'onglet Catala (plugin `plugins/piecemaker-catala`).

## Contenu

| Outil | macOS arm64 | Windows x64 |
| --- | --- | --- |
| `catala`, `clerk`, `catala-lsp`, `catala-format`, `catala-dap` | archive précompilée | archive précompilée |
| runtime Python Catala | oui, dans le pack | oui, dans le pack |
| `catala-proof` et Z3 5.1.0 | oui | oui, même recette ; exécution Windows à valider en CI |
| `catleg==0.2.9` | Python partagé | Python partagé |

Les versions sont figées dans `desktop-bootstrap/composants/catala-pack.json` : commit Catala, commit du serveur de langage, compilateur, paquets opam et SHA-256 des archives. Le MSI officiel ne sert plus.

## Installation

1. Au démarrage de l'app empaquetée, `overlay/electron-piecemaker/catala-pack.mjs` lance l'installateur en tâche de fond, avec le Node d'Electron.
2. L'installateur télécharge l'archive épinglée dans `catala-pack.json`, puis contrôle son SHA-256.
3. Après contrôle des chemins et refus des liens, l'installateur extrait le pack dans `<racine>/catala/<id>/`.
4. Il configure les grammaires locales et vérifie la version du compilateur et le chargement du plugin de preuve.
5. Il écrit `pack.json` après réussite. Un second lancement réutilise le pack. Une mise à jour échouée conserve le précédent.

Aucune compilation OCaml, installation Homebrew ou résolution opam ne se fait sur le poste utilisateur. La CI précompile aussi les modules de la bibliothèque standard. L'archive conserve les binaires, plugins, bibliothèques dynamiques requises, grammaires et runtimes utiles. Elle retire le compilateur OCaml, les caches et les sources OCaml de compilation.

`<racine>` vaut `PIECEMAKER_COMPONENTS_HOME`, sinon `PIECEMAKER_HOME`, sinon `~/.piecemaker`. Un verrou évite les installations simultanées. Seuls les anciens packs portant le marqueur PieceMaker sont retirés.

`catleg` et ses dépendances restent dans le Python partagé (`config.json` › `pythonPath`). Aucun environnement Python distinct n'est créé.

### Construction et première livraison

La recette actuelle ne contient aucune empreinte d'archive publiée. L'installateur signale donc `indisponible`. Le contrôle de livraison refuse cette recette. Il ne faut pas publier l'app avant ces étapes :

1. Exécuter le workflow `piecemaker-catala-pack.yml` sur la branche choisie, après autorisation. Les runners macOS arm64 et Windows x64 construisent les mêmes outils et exécutent les contrôles.
2. Récupérer les archives et leurs fichiers `verification.json`. Chaque contrôle installe l'archive dans un chemin accentué, puis exécute les outils sans opam ni compilateur dans le `PATH`.
3. Après validation et autorisation de publication, attacher les deux archives et leurs bilans à une release dédiée au pack.
4. Exécuter `node desktop-bootstrap/composants/catala-archive.mjs pin --tag <tag-du-pack>`. La commande refuse les bilans absents ou associés à d'autres octets ou à une autre recette.
5. Relire et commiter `catala-pack.json`. Construire ensuite l'app par la procédure de release habituelle.

Sous Windows, la compilation utilise OCaml MinGW et Python Cygwin pour Z3. Les DLL non système sont regroupées dans `bin/`. Sous macOS, les dépendances Mach-O sont relocalisées dans l'archive et signées localement après modification. Les contrôles refusent une dépendance dynamique externe résiduelle.

Le workflow utilise les options Windows de l'action officielle [setup-ocaml](https://github.com/ocaml/setup-ocaml), épinglée sur un commit.

Les archives téléchargées passent par le même contrôle SHA-256 que les autres composants. La signature locale macOS ne constitue pas une notarisation Apple. Le parcours d'installation réel Windows reste à exécuter.

## Fichiers lus par l'interface

`<racine>/catala/status.json` :

```json
{ "state": "pret | installation | en-cours | indisponible | echec", "id": "…", "step": "install", "error": "…", "updatedAt": "ISO 8601" }
```

`<racine>/catala/pack.json` : `id`, `platform`, `catala`, `version`, `prefix`, `bin` (un chemin par outil), `path`, `env`, `runtimePython`, `proof`, `installedAt`. Journal : `<racine>/catala/install.log`.

## Interface

L'onglet Catala montre :

- l'état du pack (`status.json`, `pack.json`) ;
- les programmes du dossier ;
- le dernier bilan de chaque programme : vérification (contrôles réussis et échoués, durée, date), preuve, vigueur catleg (date du contrôle, résultat par fichier) ;
- des liens qui ouvrent les fichiers `.catala_fr` et les journaux `resultats/*.log` dans l'éditeur.

L'onglet est en lecture seule. Le seul bouton, « Vérifier », lance `pm catala verifier --programme <nom>`. Il est inactif sans pack. L'agent ouvre l'onglet par `pm tab afficher catala`.

Routes serveur (`server/piecemaker/catala.ts`) : `GET /api/piecemaker/catala?projectPath=` renvoie l'état et les programmes ; `POST /api/piecemaker/catala/verify` (`projectPath`, `programme`) lance la vérification et renvoie l'état à jour. Une seule vérification à la fois par programme.

## Classement

Un programme vit dans `.piecemaker/catala/<nom>/` : un dossier avec `clerk.toml`, `<nom>` en minuscules, chiffres et tirets. Un dossier peut contenir plusieurs programmes ; `--programme <nom>` choisit le programme.

## Commandes

| Commande | Effet | Résultat |
| --- | --- | --- |
| `pm catala verifier --programme <nom>` | typecheck avec invariants, format, tests clerk, tests Python | `resultats/verification.json`, `tests.json` |
| `pm catala formater` | `catala-format --in-place` | fichiers réécrits |
| `pm catala preuve --scope <Champ> [--fichier F]` | `catala proof`, sans compilation OCaml | `resultats/preuve.json` |
| `pm catala expliquer --programme <nom> --fichier test_prime.catala_fr --scope Exemple` | Graphe des formules et conditions d’une exécution | `resultats/explication.dot`, `explication.json` |
| `pm catala catleg [--fichier F]` | vigueur des articles cités, identifiants PISTE de PieceMaker | `resultats/catleg.json` |
| `pm catala lister` / `env` | programmes et dernier bilan / pack, état, Python | sortie |
| `pm catala exec <outil> -- <args>` | lance un outil du pack (LSP, DAP, autres) | code de sortie |

Les tests passent par `clerk runtest --whole-program`, puis `clerk report --json`. Cette voie conserve le bilan sans compiler de modules OCaml.

`verification.json` : `started_utc`, `finished_utc`, `programme`, `passed`, `sources_sha256`, `checks[]` (`name`, `command`, `exit_code`, `seconds`, `passed`, `files`). Un journal `resultats/<contrôle>.log` par contrôle. `preuve.json` ajoute `fichier`, `scope`, `conflits`. `catleg.json` : `date_controle`, `passed`, `fichiers[]` (`fichier`, `exit_code`, `passed`, `messages`).

Une preuve réussit si `catala proof --debug` produit au moins une obligation, sort à 0, écrit « No errors found » et aucun `[WARNING]` : un chevauchement d'exceptions sort aussi à 0.

## Limites

- catleg contrôle la vigueur à la date du jour seulement.
- Une preuve porte sur le programme, pas sur les faits.
- Le lien avec les pièces passe par une table des sources que l'avocat construit.
- Windows : installation et preuve non exécutées sur ce Mac. La CI Windows doit réussir avant livraison.
- Les commandes OCaml de `clerk` exigent une chaîne de compilation absente du pack. `pm catala` utilise le compilateur Catala et `clerk runtest`, sans compilation OCaml locale.
- `catleg` n'est dans le Python partagé qu'après le prochain build CI de ce Python.
- Les contrôles LSP et DAP couvrent leur initialisation ; ils ne valident pas une session complète dans un éditeur.

## Explication d’une exécution

`pm catala expliquer --programme <nom> --fichier test_<module>.catala_fr --scope <Scenario>` lance le plugin officiel `explain`.

Le champ choisi doit avoir ses entrées fixées dans le scénario. Quand le programme contient un seul fichier, `--fichier` est facultatif.

La commande produit `resultats/explication.dot`, `explication.json` et `explication.log`. Le bilan identifie le fichier, le champ, les dates et l’empreinte des sources. Une exécution échouée retire le graphe précédent.

L’onglet Catala affiche le dernier graphe. Les flèches pointillées représentent les conditions appliquées. Le dessin utilise JavaScript, sans Graphviz et sans service externe. Les liens externes du DOT ne sont pas activés.

Le graphe explique une exécution précise. Il ne valide ni les faits, ni toutes les exécutions possibles, ni la fidélité au texte juridique.

La preuve refuse `--whole-program` : Catala 1.3 peut masquer des conflits avec cette option.

Catala 1.3 peut omettre des obligations avec des définitions globales. Le bilan positif porte seulement sur les obligations produites. Une preuve vide échoue.

La preuve couvre le champ choisi, sans couvrir les champs ou modules appelés. Lancez la preuve séparément sur chaque champ métier.
