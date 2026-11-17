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
| `pm catala verifier --programme <nom> [--au today\|AAAA-MM-JJ]` | mise au format (`catala-format --in-place`), puis typage, tests Clerk/Python, preuves, Catleg, citations PieceMaker, explication | fichiers réécrits, `resultats/verification.json`, `tests.json` |
| `pm catala formater` | `catala-format --in-place` seul ; absent du skill | fichiers réécrits |
| `pm catala preuve --scope <Champ> [--fichier F]` | `catala proof` sur un seul champ, sans compilation OCaml ; absent du skill | `resultats/preuve.json` |
| `pm catala expliquer --programme <nom> --fichier test_prime.catala_fr --scope Exemple` | Graphe des formules et conditions d’une exécution | `resultats/explication.dot`, `explication.json` |
| `pm catala squelette --scope <Champ> [--fichier F]` | `catala testcase generate` puis `write -l fr`, dans un dossier temporaire avec la stdlib en `_build/libcatala` | test en sortie, entrées par défaut |
| `pm catala executer --scope <Scenario> [--fichier F]` | `catala interpret --whole-program --trace --stdlib` | trace en sortie (200 lignes), `resultats/execution.log` |
| `pm catala exceptions --scope <Champ> --variable <v> [--fichier F]` | `catala exceptions` | arbre en sortie, `resultats/exceptions.log` |
| `pm catala catleg [--au today\|AAAA-MM-JJ] [--fichier F]` | vigueur des articles cités, identifiants PISTE de PieceMaker ; absent du skill | `resultats/catleg.json` |
| `pm catala section --fichier F --source <ID> --extrait "…" [--titre "Article 1224"]` | ajoute à la fin du fichier `## <titre> \| <ID>`, l'extrait « » vérifié mot pour mot (normalisation des citations du Harness) et le texte officiel coupé à 80 colonnes ; titre par défaut : numéro de l'article en cache, titre de la décision ; texte lu dans le cache local (`articles/`, `decisions/`), article absent téléchargé par catleg s'il y a Python et identifiants PISTE ; aucun bloc ```` ```catala ```` | fichier complété, ligne de la section en sortie |
| `pm catala lister` / `env` | programmes et dernier bilan / pack, état, Python | sortie |
| `pm catala exec <outil> -- <args>` | lance un outil du pack (LSP, DAP, autres) | code de sortie |

Le typage passe `--message-format=gnu` au compilateur : une ligne par erreur, mots-clés français et correction proposée. Un avertissement du compilateur (`[WARNING]`, par exemple une variable inutilisée) fait échouer le typage : il signale souvent une condition oubliée. Le contrôle de documentation refuse un bloc mal ouvert (` ``` catala`, ` ```Catala`, ` ```catala-fr`) : Catala l'ignore sans erreur. Un test sans `assertion` échoue : il réussirait toujours. Le bilan affiche au plus 8 lignes d'erreur sous chaque contrôle en échec, et les tests faux sous la forme `fichier:ligne › Scenario : message`. `verifier` formate les fichiers avant tout contrôle et signale les fichiers réécrits (« reformatés ») ; le contrôle `format` échoue seulement si `catala-format` échoue. Il reste bloqué tant que le typage échoue, pour ne pas répéter les mêmes erreurs. Le skill présente trois groupes : contrôler (`verifier`), comprendre un échec (`executer`, `exceptions`, `expliquer`), écrire (`squelette`).

Le skill renvoie aux pages françaises du livre Catala copiées dans `references/livre/` (CC BY 4.0, attribution dans `references/livre/SOURCE.md`). `references/format.md` donne un modèle vérifié. `references/pieges.md` garde seulement les erreurs dont le message ne donne pas la correction (bloc ignoré, `catala-metadata`, cas d'une énumération importée, module et champ de même nom, date de fin de mois, arrondi de l'argent, conflit d'exceptions). Le skill admet que l'agent choisisse la règle qui l'emporte dans un conflit d'exceptions, à condition de justifier ce choix en commentaire `#` et de le signaler à l'avocat. Le site catala-lang.org peut être inaccessible à l'agent.

### Règles du vérifieur

Le code reste du Catala natif, sans attribut propre. `pm catala verifier` renvoie une erreur, avec fichier et ligne, quand une source manque :

| Règle | Message |
|---|---|
| 1. Ancrage juridique : toute définition ou règle hors tests, métadonnées comprises, dont le titre le plus proche est `## … \| LEGIARTI…` (JORFARTI, JURITEXT, CETATEXT, CONSTEXT) suivi d'un extrait « » ; un parent ancré ne suffit pas. Sont aussi refusés : un titre `LEGITEXT`/`JORFTEXT`, un identifiant mal formé (préfixe sans 12 chiffres), un identifiant cité sans section propre, une `> Inclusion:` hors du programme, une étiquette `article_N` sans texte (`article_2_code_civil`) | `règle sans source juridique : placez-la sous un titre ## Article N \| LEGIARTI… (JORFARTI) ou ## Décision \| JURITEXT… (CETATEXT, CONSTEXT), suivi de l'extrait exact entre « ».` |
| 2. Forme : titre `##` de 2 à 7 mots, sans `_` ni `?` ; `#[doc]` sans `titre:`, `source:`, `quote:` | `titre « … » : écrivez 2 à 7 mots, sans identifiant de variable ni « ? ».`, `#[doc] contient « source: » : le titre va dans ## texte court, la source juridique dans le titre de section.` |
| 3. Tâche : `type` et `date_vigueur` | `type de tâche inconnu : écrivez litigation, transactional.`, `date_vigueur absente : écrivez today ou AAAA-MM-JJ.` |

La fixture `docs/tests/raisonnement-indemnite-instruction-maj/` suit ce modèle ; `catala.test.mjs` y vérifie chaque règle.


Les tests passent par `clerk runtest --whole-program`, puis `clerk report --json`. Cette voie conserve le bilan sans compiler de modules OCaml.

`verification.json` : `started_utc`, `finished_utc`, `programme`, `passed`, `sources_sha256`, `checks[]` (`name`, `command`, `exit_code`, `seconds`, `passed`, `status`, `message`, `files`). Un journal `resultats/<contrôle>.log` par contrôle. `preuve.json` ajoute `fichier`, `scope`, `conflits` (exceptions qui se chevauchent), `vides` (variable sans définition applicable), `non_couvertes`. Le message de chaque défaut porte la variable, la ligne et le contre-exemple du solveur. `catleg.json` : `date_controle`, `passed`, `fichiers[]` (`fichier`, `exit_code`, `passed`, `messages`).

Une preuve réussit si `catala proof --debug` produit au moins une obligation, sort à 0, écrit « No errors found » et aucun `[WARNING]` autre que « The translation to Z3 failed » : un chevauchement d'exceptions sort aussi à 0. Une variable que Z3 ne sait pas traduire n'est pas un échec : le contrôle la nomme (« variable(s) non couverte(s) par Z3 ») et `preuve.json` la compte (`non_couvertes`). Tout échec de preuve porte son motif dans le bilan : champ, texte de l'avertissement ou « aucune obligation produite ».

## Limites

- Catleg lit les identifiants des titres. Pour chaque article, il compare le numéro du titre au numéro officiel, la vigueur à la date retenue et le texte intégral (`catleg diff`, NOTA compris, après masquage des extraits « » ; un écart d'espaces seul est ignoré ; git système requis). Une version passée est admise quand la section porte des dates littérales `|AAAA-MM-JJ|` égales aux bornes officielles. Un contrôle vide échoue. La date de vigueur vient de `--au`, sinon de `date_vigueur` dans `tache.json` : `today` ou AAAA-MM-JJ. Sans date, `verifier` et `catleg` s'arrêtent aussitôt sur une erreur, avant tout contrôle. `catleg.json` porte `origine_date` (`--au` ou `tache.json`). Le résultat dépend de la période officielle de chaque article, même abrogé depuis, lue par `catleg lf article` ; `catleg.json` porte `dates_reference`. Le volet affiche « Droit apprécié au : » suivi de cette date et signale une vigueur à vérifier. Cette comparaison ne détermine pas l’applicabilité juridique.
- Une preuve porte sur le programme, pas sur les faits.
- Le lien avec les pièces passe par une table des sources que l'avocat construit.
- Windows : installation et preuve non exécutées sur ce Mac. La CI Windows doit réussir avant livraison.
- Les commandes OCaml de `clerk` exigent une chaîne de compilation absente du pack. `pm catala` utilise le compilateur Catala et `clerk runtest`, sans compilation OCaml locale.
- `catleg` n'est dans le Python partagé qu'après le prochain build CI de ce Python.
- Les contrôles LSP et DAP couvrent leur initialisation ; ils ne valident pas une session complète dans un éditeur.

## Explication d’une exécution

`pm catala verifier --programme <nom>` produit aussi le graphe après une vérification réussie. Le scénario précédent est conservé s’il existe encore ; sinon, le premier scénario réussi est choisi. Les résultats de tests officiels de clerk désignent ce scénario. Un échec d’explication est signalé séparément des contrôles. Quand `catala explain` échoue sur un scénario dont le test réussit, le contrôle donne le scénario, la ligne, l’erreur du compilateur et la correction ; Catala 1.3 plante ainsi sur une `condition` que le scénario ne remplit pas, d’où `règle calcul.<condition> non rempli` pour chaque condition fausse.

`pm catala expliquer --programme <nom> --fichier test_<module>.catala_fr --scope <Scenario>` reste disponible pour choisir une autre exécution.

Le champ choisi doit avoir ses entrées fixées dans le scénario. Quand le programme contient un seul fichier, `--fichier` est facultatif.

La commande produit `resultats/explication.dot`, `explication.json` et `explication.log`. Le bilan identifie le fichier, le champ, les dates et l’empreinte des sources. Une exécution échouée retire le graphe précédent.

Le volet présente le raisonnement à l’avocat, sans contrôle du code. Il sépare deux onglets : Graphe (par défaut) et Raisonnement. Une seule barre, sur une ligne, porte les onglets, le scénario, le programme s’il y en a plusieurs, le zoom du graphe et les boutons « Rédiger » et « Vérification ». Elle défile horizontalement dans un volet étroit. Le volet se recharge seul après `pm catala verifier`. Un seul avertissement : « Raisonnement à recalculer » quand les sources ont changé, « Aucun raisonnement calculé » sans exécution. Le graphe occupe tout le reste du volet. Les bilans de typage, format, tests, preuve et catleg restent dans le CLI et ses journaux.

Cibler une carte : le bouton souris de l’en-tête du volet (`PanelPickButton`, événements `piecemaker:panel-pick` et `piecemaker:panel-pick-state`) active le ciblage. Un clic sur une carte émet `piecemaker:catala-card-pick` (`titre`, `fichier` relatif au dossier, `debut`, `fin` : lignes de la définition appliquée, `#[doc]` compris ; `identifiant`, `valeur` et `scenario` affiché). Échap annule. Le module `src/modules/piecemaker-chat-picks/` (voir `docs/ciblage-chat.md`) affiche la carte en pastille au-dessus du champ du chat, retirable. À l’envoi, elle ajoute au message ``[Carte « titre »](chemin:ligne "lignes N à M") — `identifiant` = valeur, scénario S`` : l’avocat lit le titre, l’agent reçoit le fichier, les lignes, l’identifiant et la valeur. Le skill `catala` dit à l’agent de lire seulement ces lignes, de retrouver l’identifiant avec `grep` si elles ont bougé, et de ne pas ouvrir les JSON de `resultats/` (cache du volet) : pour une valeur, `pm catala executer` puis `grep "≔"` sur `resultats/execution.log`. Après le ciblage, le volet émet `piecemaker:panel-picked` : sur petit écran (`isMobile`), l’hôte ferme le volet et montre le chat avec la pastille. Limite : une pastille seule, sans texte, s’envoie par Entrée, pas par le bouton d’envoi.

Le Raisonnement écrit le fil de la réflexion : il part des faits et monte jusqu’à la conclusion. Chaque règle est une « Étape N », la conclusion vient en dernier, et chaque étape indique ce qu’elle sert à établir. Chaque carte suit le même ordre : « La règle » (le fondement officiel — article et code, décision — puis les conditions en clair), « Projection au scénario » (Vrai ou Faux et la raison), « Justification » (les faits et règles retenus, avec leur valeur et leurs pièces). Les identifiants Catala s’affichent sans tirets bas, avec les accents usuels. Les points à examiner (fait contesté ou non établi, règle sans article ni décision, citation non retrouvée) sont réunis sous le bouton « Vérification » de la barre, avec une bulle rouge qui en donne le nombre. Un clic ouvre le résultat : la date d’analyse, Recalculer, puis la liste en clair ou « Aucune erreur » : « Règle sans source », « Titre manquant ». « Demander la correction » place la demande en pastille dans le chat ; l’avocat l’envoie lui-même. La date à laquelle le droit est apprécié reste en tête de l’onglet. Une section « Autres sources citées » regroupe les références non rattachées.

Le graphe place les prémisses à gauche, puis les règles selon leurs dépendances, et la conclusion à droite ; les flèches vont de la prémisse vers la conclusion. Chaque nœud montre son titre, sa valeur et ses sources. Une exception apparaît en pointillés, sous la forme « Sauf … ». Un clic sur un nœud estompe ce qui ne le concerne pas, sans ouvrir de panneau. Le zoom, le déplacement et l’ajustement restent disponibles.

Un programme correspond à une tâche (jeu de conclusions, contrat). `tache.json`, à la racine du programme, porte `tache`, `type`, `date_vigueur` et `raisonnements` (`champ`, `objectif`, `rang`). `type` vaut `litigation` ou `transactional` ; `date_vigueur` est obligatoire (`today` ou AAAA-MM-JJ). La route `/api/piecemaker/catala` le renvoie dans le champ `tache` du programme. Avec plusieurs raisonnements, la barre ajoute une liste « Raisonnement » ; la liste des scénarios se limite alors aux tests dont la déclaration nomme le champ du raisonnement choisi. L’`objectif` titre la conclusion. La liste des programmes affiche le nom de la tâche. « Rédiger » envoie tous les raisonnements de la tâche, chacun avec son premier scénario réussi. Sans lui, le volet se comporte comme avant, mais `pm catala verifier` échoue. Le contrôle `documentation` de `pm catala verifier` signale ses défauts (`tache.json:1: …`).

« Rédiger » liste les documents du tableau du skill `style-redaction-cabinet` (lus par la route `/api/piecemaker/catala`, champ `styles`), sauf ceux dont le fichier de style porte le frontmatter `type: regle-generale` et « Autre document ». Un choix émet `piecemaker:panel-new-chat` : `PanelPickButton` ouvre un nouveau chat (`src/piecemaker/chat/usePanelNewChat.ts`). Le volet y place une pastille « Rédiger : <document> ». À l’envoi, elle ajoute la consigne de charger le skill et sa règle `styles/<document>.md`, puis le raisonnement du scénario affiché (faits, étapes, conclusion, sources et citations). L’avocat envoie lui-même. Le bouton est inactif sans raisonnement calculé. Le texte Markdown au-dessus des blocs Catala est facultatif ; seul le titre d’article lu par catleg reste requis.

Chaque article, décision ou pièce cité est un lien. Un clic l’ouvre dans le volet de l’éditeur, depuis les deux vues, sans changer d’onglet. Les pièces locales s’ouvrent au passage cité, avec des chemins limités au dossier. Les sources Légifrance et Judilibre passent par le lecteur interne et son contrôle de citation. Les autres liens HTTP(S) ne s’ouvrent pas.

Rattachement des sources. Les références écrites entre le bloc ` ```catala ` précédent et le bloc d’une règle fondent cette règle ; les blocs ` ```catala-metadata ` n’interrompent pas ce rattachement. Une ligne `Concerne : id1, id2` dans une section rattache ses références aux faits ou règles nommés. Le volet ne lit pas les pièces. Une référence déclarée ne constitue pas une vérification de son contenu. Le DOT seul ne contient pas le texte documentaire ; le serveur transmet aussi le contenu des fichiers Catala.

Les états explicitement nommés `Indéterminé` ou `Disputé` sont signalés. Leur absence ne prouve pas que le dossier est complet. Les alertes juridiques et les scénarios alternatifs ne sont pas déduits de la trace.

Après la commande, le CLI notifie le serveur local par `/api/piecemaker/local/catala-updated`. Seuls les dossiers connus et la boucle locale sont acceptés. Le serveur transmet un événement léger sur le WebSocket déjà ouvert. Le pont PieceMaker du workspace le relaie au volet actif, qui relit le bilan. Le bouton Recalculer utilise le même mécanisme. Aucun watcher, flux supplémentaire ou interrogation périodique n’est ajouté. Ouvrir le volet charge le dernier résultat ; Actualiser permet une relecture manuelle. Une empreinte différente masque le graphe périmé. Une reconnexion recharge le résultat.

Le graphe explique une exécution précise. Il ne valide ni les faits, ni toutes les exécutions possibles, ni la fidélité au texte juridique.

La preuve refuse `--whole-program` : Catala 1.3 peut masquer des conflits avec cette option.

Catala 1.3 peut omettre des obligations avec des définitions globales. Le bilan positif porte seulement sur les obligations produites. Une preuve vide échoue.

La preuve couvre le champ choisi, sans couvrir les champs ou modules appelés. Lancez la preuve séparément sur chaque champ métier.

Les sources Légifrance citées dans Catala utilisent le lecteur interne existant. L’API vérifie leur présence dans le programme, consulte le MCP Légifrance avec les identifiants PISTE existants et contrôle l’extrait déclaré. Sans extrait, aucun statut de citation vérifiée n’est attribué. Le Markdown `Citation : « passage exact »` suit le lien ; les pièces locales transmettent cet extrait au lecteur pour le surlignage.


## Vérification regroupée

`verifier` rend un bilan unique. Chaque contrôle porte un état : `passed`, `failed`, `blocked` ou `missing`.
Catleg et le contrôle existant des citations PieceMaker tournent en parallèle avec les outils de compilation.
Les commandes qui utilisent `_build` restent séquentielles. Un échec ne bloque que les contrôles dépendants.
Catala fournit les champs à prouver via `dependency-graph`. Chaque champ des fichiers métier reçoit sa propre preuve.
Le graphe reste disponible lorsqu’un scénario réussit, même si une autre vérification échoue.

Le contrôle des citations utilise les mêmes références que le graphe et les connecteurs PieceMaker existants.
Un renvoi sans lien (« articles 1352 à 1352-9 ») placé dans le texte officiel recopié sous un titre `| LEGIARTI…` ou `| JORFARTI…`, que catleg compare, n'exige pas de lien de source. Le même renvoi écrit ailleurs reste signalé « Lien de source absent ».
Les sources officielles passent par le MCP Légifrance et les identifiants PISTE de l’utilisateur.
Un fait du dossier est un `contexte` du programme. Dans un scénario, chaque fait (`règle cas.x rempli`, `définition cas.x égal à …`) porte juste au-dessus `## okf:/_premises/<fiche>.md` ; le contrôle `documentation` refuse un fait sans ce lien, sauf une constante d'énumération (hypothèse du scénario). Le contrôle des citations compare la valeur du fait à celle de la prémisse et avertit quand le lien de la pièce a été posé par l'avocat. Ce lien renvoie à sa prémisse, jamais à une pièce : le contrôle développe la prémisse en ses pièces citées et vérifie chaque citation (`docs/okf.md`). Les pièces passent par le lecteur existant du dossier. Aucun extrait absent ou introuvable ne vaut validation. Un extrait qui ne diffère du texte que par la ponctuation, les espaces, la casse ou les accents est réécrit dans le fichier avant l'empreinte des sources, sans erreur. Une décision frappée d'un recours (historique du MCP) porte la mention « Non rendue en dernier ressort, voir <juridiction>, <date> » ; dans le volet, « juridiction, date » ouvre la décision de recours dans la visionneuse (`parent` de la route `/citation`). JORFARTI est accepté.
`citations.json` conserve les résultats et les jetons du lecteur interne. Le graphe affiche les erreurs sur leurs références.
Une citation Légifrance ou Judilibre validée mot pour mot est gardée dans `.piecemaker/catala/citations-validees.json` du dossier (clé : identifiant et extrait, avec le jeton du lecteur). Le contrôle suivant la reprend sans interroger la source, tant que son jeton existe. Une citation échouée ou corrigée est toujours revérifiée ; les pièces aussi. Exception : une décision de moins de cinq ans, ou sans date lisible dans son titre, est toujours relue sur la source, pour suivre son historique de recours. Supprimer le fichier force une nouvelle vérification.
Le lecteur réutilise ces résultats tant que le programme reste inchangé. Aucun contrôle sémantique supplémentaire n’est ajouté.
La commande CLI joint le serveur local pour ce contrôle ; serveur absent, le bilan signale l’indisponibilité.

## Graphe du raisonnement

Le volet ouvre le graphe en premier. Il relie conclusion, conditions, données, sources et points ouverts, avec des nœuds partagés. Les valeurs Vrai/Faux décrivent le scénario et ne valent pas preuve. La vérification conserve les traces des scénarios Clerk ; le volet permet de choisir entre ces scénarios sans nouveau calcul.

Détail des sorties natives Catala, des ajouts PieceMaker, de la rédaction et des limites : [graphe du raisonnement](graphe-catala.md).
