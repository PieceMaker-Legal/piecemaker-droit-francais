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

`pm catala verifier --programme <nom>` produit aussi le graphe après une vérification réussie. Le scénario précédent est conservé s’il existe encore ; sinon, le premier scénario réussi est choisi. Les résultats de tests officiels de clerk désignent ce scénario. Un échec d’explication est signalé séparément des contrôles.

`pm catala expliquer --programme <nom> --fichier test_<module>.catala_fr --scope <Scenario>` reste disponible pour choisir une autre exécution.

Le champ choisi doit avoir ses entrées fixées dans le scénario. Quand le programme contient un seul fichier, `--fichier` est facultatif.

La commande produit `resultats/explication.dot`, `explication.json` et `explication.log`. Le bilan identifie le fichier, le champ, les dates et l’empreinte des sources. Une exécution échouée retire le graphe précédent.

L’onglet Catala affiche les règles à gauche, les conditions au centre et les données du scénario à droite. Les cartes reprennent les couleurs du volet Raisonnement : règles bleues, calculs monétaires violets, conditions et états ouverts dorés, données vertes ou rouges, résultat du champ turquoise. Les valeurs restent celles de Catala. Les identifiants sont affichés avec des espaces.

Le volet sépare deux onglets, Graphe et Vue écrite, comme le volet Raisonnement. Chaque étape porte un seul titre numéroté. Son objectif reste à gauche ; sa décomposition se développe vers la droite, selon la profondeur des dépendances, même imbriquées. La numérotation suit les dépendances ; elle ne prétend pas dater les branches indépendantes. Le déroulé révèle l’objectif, puis chaque colonne de dépendances, avant de passer à l’étape suivante. Il affiche le détail et recentre la vue sur la colonne révélée. La sélection, les dépendances et usages, l’ouverture du programme, le zoom, le déplacement et la légende restent disponibles.

Les bilans globaux de typage, format, tests et preuve apparaissent une seule fois après les étapes. Ils ne sont pas reliés artificiellement à chaque règle. La preuve indique le nombre d’obligations produites. Une carte présente les scénarios des tests ; son détail conserve le rapport complet et la couverture. Chaque contrôle montre son résultat et sa date ; les journaux disponibles s’ouvrent depuis les cartes. Les badges des articles ouvrent le contrôle catleg de leur fichier. Les sources restent reliées directement aux règles ou conditions dont la section Catala les cite. Les traits de bilan restent distincts des dépendances de calcul. Les messages des contrôles échoués et les erreurs des scénarios apparaissent dans le graphe. Le détail conserve les journaux complets. Les cartes de contrôle restent accessibles si la trace est absente ou périmée. Les références des sections non exécutées apparaissent sans dépendance inventée.

Les articles affichent la date et les messages du contrôle catleg de leur fichier. Ce bilan concerne le fichier, sans verdict individuel ajouté par l’interface. Une date de contrôle ne constitue pas une date d’entrée en vigueur. La version applicable à la date des faits reste signalée comme non contrôlée. Un contrôle absent reste visible.

Les alertes visibles sur les cartes distinguent donnée non établie, fait contesté, résultat dépendant de ces manques, lien absent et version juridique applicable non contrôlée. Elles indiquent l’action attendue. Un état faux reste une valeur calculée ; il ne devient pas automatiquement une erreur.

La Vue écrite regroupe les mêmes étapes et la réponse finale. Elle contient aussi les contrôles, bilans, fichiers et journaux, même sans graphe valide. Le volet conserve l’onglet choisi lors d’une actualisation.

Les fichiers Catala peuvent documenter les pièces et les sources en Markdown. Le volet retrouve la section et les sections parentes correspondant à la position source de la trace. Il conserve leur texte dans le détail et la Vue écrite, y compris quand plusieurs blocs de code partagent la même section.

Les liens Markdown, liens par référence, URL et identifiants Légifrance deviennent des cartes Pièce citée, Article ou Référence, reliées aux éléments concernés du graphe. Les références communes à une même section sont partagées. Un article ou numéro de pièce sans lien reste visible, avec la mention « Lien absent du programme ». Un titre d’article contenant son identifiant officiel devient un lien unique. Les cartes proposent un bouton d’ouverture dans les deux vues, pour les pièces, articles et jurisprudences. Les pièces locales s’ouvrent dans l’éditeur, avec des chemins limités au dossier ; les liens HTTP(S) s’ouvrent dans un nouvel onglet. Le volet ne lit pas les pièces. Une référence déclarée ne constitue pas une vérification de son contenu. Le DOT seul ne contient pas le texte documentaire ; le serveur transmet aussi le contenu des fichiers Catala.

Chaque carte conserve le libellé complet de Catala, ses expressions, valeurs, position source et contexte documentaire dans son détail et la Vue écrite. Les éléments sans étape consommatrice restent visibles. Les opérateurs logiques `et` et `ou` prennent la forme de pills dans les conditions, sans modifier les parenthèses, identifiants ou chaînes de caractères.

Les états explicitement nommés `Indéterminé` ou `Disputé` sont signalés. Leur absence ne prouve pas que le dossier est complet. Les alertes juridiques, décisions sur la fiabilité des pièces et scénarios alternatifs du vérificateur YAML ne sont pas déduits de la trace.

Après la commande, le CLI notifie le serveur local par `/api/piecemaker/local/catala-updated`. Seuls les dossiers connus et la boucle locale sont acceptés. Le serveur transmet un événement léger sur le WebSocket déjà ouvert. Le pont PieceMaker du workspace le relaie au volet actif, qui relit le bilan. Le bouton Vérifier utilise le même mécanisme. Aucun watcher, flux supplémentaire ou interrogation périodique n’est ajouté. Ouvrir le volet charge le dernier résultat ; Actualiser permet une relecture manuelle. Une empreinte différente masque le graphe périmé. Une reconnexion recharge le résultat.

Les flèches pointillées représentent les conditions appliquées. Le dessin utilise JavaScript, sans Graphviz et sans service externe. Les liens externes du DOT ne sont pas activés ; seuls les fichiers locaux du programme peuvent être ouverts.

Le graphe explique une exécution précise. Il ne valide ni les faits, ni toutes les exécutions possibles, ni la fidélité au texte juridique.

La preuve refuse `--whole-program` : Catala 1.3 peut masquer des conflits avec cette option.

Catala 1.3 peut omettre des obligations avec des définitions globales. Le bilan positif porte seulement sur les obligations produites. Une preuve vide échoue.

La preuve couvre le champ choisi, sans couvrir les champs ou modules appelés. Lancez la preuve séparément sur chaque champ métier.
