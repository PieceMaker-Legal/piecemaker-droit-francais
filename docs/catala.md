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
| `pm catala verifier --programme <nom> --au AAAA-MM-JJ` | mise au format (`catala-format --in-place`), puis typage, tests Clerk/Python, preuves, Catleg, citations PieceMaker, explication | fichiers réécrits, `resultats/verification.json`, `tests.json` |
| `pm catala formater` | `catala-format --in-place` seul ; absent du skill | fichiers réécrits |
| `pm catala preuve --scope <Champ> [--fichier F]` | `catala proof` sur un seul champ, sans compilation OCaml ; absent du skill | `resultats/preuve.json` |
| `pm catala expliquer --programme <nom> --fichier test_prime.catala_fr --scope Exemple` | Graphe des formules et conditions d’une exécution | `resultats/explication.dot`, `explication.json` |
| `pm catala squelette --scope <Champ> [--fichier F]` | `catala testcase generate` puis `write -l fr`, dans un dossier temporaire avec la stdlib en `_build/libcatala` | test en sortie, entrées par défaut |
| `pm catala executer --scope <Scenario> [--fichier F]` | `catala interpret --whole-program --trace --stdlib` | trace en sortie (200 lignes), `resultats/execution.log` |
| `pm catala exceptions --scope <Champ> --variable <v> [--fichier F]` | `catala exceptions` | arbre en sortie, `resultats/exceptions.log` |
| `pm catala catleg --au AAAA-MM-JJ [--fichier F]` | vigueur des articles cités, identifiants PISTE de PieceMaker ; absent du skill | `resultats/catleg.json` |
| `pm catala lister` / `env` | programmes et dernier bilan / pack, état, Python | sortie |
| `pm catala exec <outil> -- <args>` | lance un outil du pack (LSP, DAP, autres) | code de sortie |

Le typage passe `--message-format=gnu` au compilateur : une ligne par erreur, mots-clés français et correction proposée. Le bilan affiche au plus 8 lignes d'erreur sous chaque contrôle en échec, et les tests faux sous la forme `fichier:ligne › Scenario : message`. `verifier` formate les fichiers avant tout contrôle et signale les fichiers réécrits (« reformatés ») ; le contrôle `format` échoue seulement si `catala-format` échoue. Il reste bloqué tant que le typage échoue, pour ne pas répéter les mêmes erreurs. Le skill présente trois groupes : contrôler (`verifier`), comprendre un échec (`executer`, `exceptions`, `expliquer`), écrire (`squelette`).

Le skill fournit `references/syntaxe.md` : un modèle vérifié avec les pièges rencontrés (bloc `catala-metadata`, place de `#[test]`, `égal à`, `sous condition … conséquence`, module et champ de même nom qui cassent les tests Python, parenthèses entre `et` et `ou`, noms réservés). Le site catala-lang.org peut être inaccessible à l'agent.

Les tests passent par `clerk runtest --whole-program`, puis `clerk report --json`. Cette voie conserve le bilan sans compiler de modules OCaml.

`verification.json` : `started_utc`, `finished_utc`, `programme`, `passed`, `sources_sha256`, `checks[]` (`name`, `command`, `exit_code`, `seconds`, `passed`, `status`, `message`, `files`). Un journal `resultats/<contrôle>.log` par contrôle. `preuve.json` ajoute `fichier`, `scope`, `conflits`. `catleg.json` : `date_controle`, `passed`, `fichiers[]` (`fichier`, `exit_code`, `passed`, `messages`).

Une preuve réussit si `catala proof --debug` produit au moins une obligation, sort à 0, écrit « No errors found » et aucun `[WARNING]` : un chevauchement d'exceptions sort aussi à 0.

## Limites

- Catleg contrôle la vigueur des articles reconnus par son parseur natif. Un contrôle vide échoue. La date de vigueur vient uniquement de `--au AAAA-MM-JJ` ; la date du jour est admise. `pm catala catleg` sans `--au` échoue ; `pm catala verifier` sans `--au` marque Catleg « non effectué ». Le résultat dépend de la période officielle de chaque article, même abrogé depuis, lue par `catleg lf article` ; `catleg.json` porte `dates_reference`. Le volet affiche « Droit apprécié au : » suivi de cette date et signale une vigueur à vérifier. Cette comparaison ne détermine pas l’applicabilité juridique.
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

Le volet présente le raisonnement à l’avocat, sans contrôle du code. Il sépare trois onglets : Graphe (par défaut), Raisonnement et Acte. Une seule barre, sur une ligne, porte les onglets, le scénario, le programme s’il y en a plusieurs, le zoom du graphe et Recalculer ; la date d’analyse est l’infobulle de Recalculer. Elle défile horizontalement dans un volet étroit. Le volet se recharge seul après `pm catala verifier`. Un seul avertissement : « Raisonnement à recalculer » quand les sources ont changé, « Aucun raisonnement calculé » sans exécution. Le graphe occupe tout le reste du volet. Les bilans de typage, format, tests, preuve et catleg restent dans le CLI et ses journaux.

Cibler une carte : le bouton souris de l’en-tête du volet (`PanelPickButton`, événements `piecemaker:panel-pick` et `piecemaker:panel-pick-state`) active le ciblage. Un clic sur une carte émet `piecemaker:catala-card-pick` (`titre`, `fichier` relatif au dossier, `debut`, `fin` : lignes de la définition appliquée, `#[doc]` compris ; `identifiant`, `valeur` et `scenario` affiché). Échap annule. L’injection `src/composer.ts` (`piecemakerInjections`) affiche la carte en pastille au-dessus du champ du chat, retirable. À l’envoi, elle ajoute au message ``[Carte « titre »](chemin:ligne "lignes N à M") — `identifiant` = valeur, scénario S`` : l’avocat lit le titre, l’agent reçoit le fichier, les lignes, l’identifiant et la valeur. Le skill `catala` dit à l’agent de lire seulement ces lignes, de retrouver l’identifiant avec `grep` si elles ont bougé, et de ne pas ouvrir les JSON de `resultats/` (cache du volet) : pour une valeur, `pm catala executer` puis `grep "≔"` sur `resultats/execution.log`. Après le ciblage, le volet émet `piecemaker:panel-picked` : sur petit écran (`isMobile`), l’hôte ferme le volet et montre le chat avec la pastille. Limite : une pastille seule, sans texte, s’envoie par Entrée, pas par le bouton d’envoi.

Le Raisonnement écrit le fil de la réflexion : il part des faits et monte jusqu’à la conclusion. Chaque règle est une « Étape N », la conclusion vient en dernier, et chaque étape indique ce qu’elle sert à établir. Chaque carte suit le même ordre : « La règle » (le fondement officiel — article et code, décision — puis les conditions en clair), « Projection au scénario » (Vrai ou Faux et la raison), « Justification » (les faits et règles retenus, avec leur valeur et leurs pièces). Les identifiants Catala s’affichent sans tirets bas, avec les accents usuels. Les points à examiner (fait contesté ou non établi, règle sans article ni décision, citation non retrouvée) sont réunis sous une seule pastille « Erreurs » de la barre, avec une bulle rouge qui en donne le nombre. Un clic ouvre la liste, en clair : « Source manquante » (`#[doc]` absent), « Citation manquante » (`quote` absente), « Titre manquant ». « Demander la correction » place la demande en pastille dans le chat ; l’avocat l’envoie lui-même. La date à laquelle le droit est apprécié reste en tête de l’onglet. Une section « Autres sources citées » regroupe les références non rattachées.

Le graphe place les prémisses à gauche, puis les règles selon leurs dépendances, et la conclusion à droite ; les flèches vont de la prémisse vers la conclusion. Chaque nœud montre son titre, sa valeur et ses sources. Une exception apparaît en pointillés, sous la forme « Sauf … ». Un clic sur un nœud estompe ce qui ne le concerne pas, sans ouvrir de panneau. Le zoom, le déplacement et l’ajustement restent disponibles.

L’Acte affiche le texte rédigé : le Markdown des fichiers du programme, hors fichiers `test_` et hors directives `>`. Chaque bloc Catala y est un accordéon fermé, titré par les règles qu’il code et leur valeur dans le scénario (`src/acte.ts`). Le document final ne contient pas ces blocs. L’éditeur Eigenpal n’est pas intégré au volet : il n’ouvre que des `.docx`, en React, et ne replie rien ; il servira à ouvrir le document final exporté.

Chaque article, décision ou pièce cité est un lien. Un clic l’ouvre dans le volet de l’éditeur, depuis les deux vues, sans changer d’onglet. Les pièces locales s’ouvrent au passage cité, avec des chemins limités au dossier. Les sources Légifrance et Judilibre passent par le lecteur interne et son contrôle de citation. Les autres liens HTTP(S) ne s’ouvrent pas.

Rattachement des sources. Les références écrites entre le bloc ` ```catala ` précédent et le bloc d’une règle fondent cette règle ; les blocs ` ```catala-metadata ` n’interrompent pas ce rattachement. Une ligne `Concerne : id1, id2` dans une section rattache ses références aux faits ou règles nommés. Le volet ne lit pas les pièces. Une référence déclarée ne constitue pas une vérification de son contenu. Le DOT seul ne contient pas le texte documentaire ; le serveur transmet aussi le contenu des fichiers Catala.

Les états explicitement nommés `Indéterminé` ou `Disputé` sont signalés. Leur absence ne prouve pas que le dossier est complet. Les alertes juridiques, décisions sur la fiabilité des pièces et scénarios alternatifs du vérificateur YAML ne sont pas déduits de la trace.

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
Les sources officielles passent par le MCP Légifrance et les identifiants PISTE de l’utilisateur.
Les pièces passent par le lecteur existant du dossier. Aucun extrait absent ou introuvable ne vaut validation.
`citations.json` conserve les résultats et les jetons du lecteur interne. Le graphe affiche les erreurs sur leurs références.
Le lecteur réutilise ces résultats tant que le programme reste inchangé. Aucun contrôle sémantique supplémentaire n’est ajouté.
La commande CLI joint le serveur local pour ce contrôle ; serveur absent, le bilan signale l’indisponibilité.

## Graphe du raisonnement

Le volet ouvre le graphe en premier. Il relie conclusion, conditions, données, sources et points ouverts, avec des nœuds partagés. Les valeurs Vrai/Faux décrivent le scénario et ne valent pas preuve. La vérification conserve les traces des scénarios Clerk ; le volet permet de choisir entre ces scénarios sans nouveau calcul.

Détail des sorties natives Catala, des ajouts PieceMaker, de la rédaction et des limites : [graphe du raisonnement](graphe-catala.md).
