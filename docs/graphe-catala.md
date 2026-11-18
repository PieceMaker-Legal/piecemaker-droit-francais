# Graphe du raisonnement : Catala et ajouts PieceMaker

Le graphe relie la prétention d’un scénario, et la conclusion qui en découle, à ses conditions, ses données, ses sources et ses points ouverts. Catala fournit le calcul. PieceMaker organise sa lecture et signale les justifications manquantes.

L’objectif vient de [05-map-law.md](recherche-memoire-raisonnement/05-map-law.md) : rendre chaque élément et son soutien consultables, puis montrer ce qui reste à rechercher.

Le [tableau de rédaction et son exemple coloré](catala-redaction.html) détaillent les possibilités. Le violet distingue les ajouts PieceMaker.

## Ce qui vient de Catala

| Élément | Sortie native utilisée | Portée |
|---|---|---|
| Variables, valeurs et dépendances d’une exécution | `catala explain --whole-program --conditions --dot` | Décrit le scénario exécuté. |
| Formules et conditions rencontrées | Libellés et relations du DOT | Permet de suivre le calcul réellement produit. |
| Emplacement des règles et données | URL et numéro de ligne des nœuds DOT | Rattache le calcul au fichier Catala. |
| Contexte documentaire | Titres Markdown conservés dans les positions et explications | Catala conserve l’emplacement du texte associé ; il ne vérifie pas le fondement cité. |
| Scénarios et assertions | `#[test]`, `clerk runtest`, `clerk report --json` | Distingue test réussi et test en échec. |
| Passages exercés par les tests | `coverage.locations`, `reached_by` et `coverage.scopes` du rapport Clerk | Indique quels scénarios ont exercé le passage correspondant au nœud. |
| Inventaire des champs et dépendances statiques | `catala dependency-graph` | Sert au contrôle des champs métier et aux relations du graphe de repli JSON. |
| Hiérarchie des exceptions | `catala exceptions` | Fournit les définitions et conditions des variables rencontrées. Leurs positions et fondements restent dans le détail. |
| Contrôle des conflits et erreurs | `catala proof`, avec Z3 dans les packs compatibles | Porte sur les obligations produites pour le programme. |
| Génération d’un scénario initial | `catala testcase generate` et `testcase write`, via `pm catala squelette` | Produit un point de départ. L’agent doit fixer les données et les assertions. |

Catala ne vérifie pas les faits du dossier. Un test réussi signifie que les assertions passent. Le résultat métier du test peut être `faux`.

## Provenance native : vérification approfondie

Le volet exploite les positions et titres du pack Catala 1.3.0 pour relier les éléments à leur origine documentaire.

| Mécanisme natif | Précision obtenue | État dans le volet |
|---|---|---|
| Titres juridiques avec identifiant | Le compilateur reconnaît un titre suivi de `\| LEGIARTI…`, son niveau et son éventuel marqueur d’archive. | Les identifiants sont relus dans le Markdown. |
| Contexte du nœud DOT | Le fichier, la ligne et les titres parents accompagnent les nœuds. Les titres figurent dans les infobulles. | Le lecteur utilise le fichier, la ligne et les titres des infobulles. |
| Arbre des exceptions en JSON | Chaque définition conserve sa position complète et ses titres. Chaque condition conserve aussi sa position et son expression. | Le détail distingue les définitions appliquées, les autres définitions et les conditions. Une exception sélectionnée par Catala peut produire une relation « sauf ». |
| Trace d’exécution en JSON | Les événements portent valeurs, positions, titres, appels de champs et définitions sélectionnées. | La trace enrichit les origines du DOT. Si le DOT échoue, la trace et les dépendances natives fournissent le graphe. |
| Définitions réparties sous plusieurs sources | Une règle générale et ses exceptions peuvent définir la même variable sous des textes distincts. | Une formule globale ne permet pas cette précision. |

Les titres et positions sont natifs. L’extrait entre « » sous le titre d’un article est une convention PieceMaker écrite en Catala natif. PieceMaker ne lit aucun attribut propre.

Deux commandes natives permettent d’obtenir les informations structurées :

```sh
pm catala exec catala -- exceptions fichier.catala_fr -s Champ -v variable --output-format=json
pm catala exec catala -- interpret test_fichier.catala_fr -s Scenario --whole-program --trace=trace.json --trace-format=json
```

L’arbre des exceptions contient notamment `rules[].pos`, `condition_pos`, `condition_text`, `law_headings` et les exceptions imbriquées. La trace d’exécution contient notamment `element`, `pos`, `value` et les événements imbriqués dans `trace`.

Un exemple fictif a réparti trois définitions de la même variable sous deux textes et une jurisprudence. Deux données intermédiaires du scénario ont été définies sous deux sections de pièces. Les contrôles exécutables ont confirmé la hiérarchie, les positions des conditions et les titres des deux pièces dans la trace.

Sur cet exemple, `interpret` a réussi, tandis que `explain` a échoué avec une variable interne non définie. Le volet utilise alors la trace JSON et les dépendances Catala. Le détail signale ce repli.

Le lecteur rattache les sources trouvées aux positions des règles et des données. Une donnée définie sous une section de pièce peut donc retrouver sa pièce sans `Concerne`. Les noms de fichiers identiques dans des répertoires distincts ne suffisent pas à établir un rattachement.

La vue Raisonnement conserve, dans chaque carte, les positions et les sources natives. Les origines du compilateur ne deviennent pas des nœuds du graphe principal. Le graphe distingue une déclaration, qui donne le contexte du champ, de la définition qui fixe sa valeur. `Concerne` complète les liens transversaux ; il ne remplace pas une origine déjà fournie par Catala.

Références : [programmation littéraire](https://book.catala-lang.org/en/5-1-literate-programming.html), [méthode de rédaction avec les juristes](https://book.catala-lang.org/fr/3-5-lawyers-agile.html), code du compilateur au tag `1.3.0` : `compiler/surface/lexer_common.ml`, `compiler/desugared/print.ml` et `compiler/plugins/explain.ml`.

## Sources natives : précisions après contrôle du compilateur

Catala prévoit des mécanismes documentaires pour les fondements et documents. Ils ne rendent pas leur présence obligatoire.

| Mécanisme natif | Fonction | Limite |
|---|---|---|
| Titre avec identifiant | Conserve notamment les identifiants `LEGIARTI`, `JORFARTI` et `CETATEXT`. Le rendu HTML français génère le lien officiel reconnu. | Ne valide ni la référence ni son applicabilité. |
| `## texte court` (forme courte de `#[doc="…"]`) | Attache un titre à une déclaration, une entrée ou une définition. | Le graphe en fait le titre de la case. Il ne porte ni source ni citation. |
| `#[description="…"]`, `#[label="…"]` | Documente certains éléments du programme. | Ne constitue pas un contrôle des fondements. |
| `> Inclusion: annexe-fictive.pdf` | Reconnaît un PDF documentaire ; le rendu LaTeX prévoit son inclusion. | Le typage ne vérifie pas l’existence du PDF ni son lien probatoire. Le graphe ne lit pas encore cette directive comme une pièce rattachée. |
| Attributs d’extension | Le compilateur accepte les attributs préfixés d’un espace de noms. | PieceMaker n'en lit aucun. Aucun attribut natif `source` ou `citation` n’existe. |

Vérification : lecture du commit embarqué `e86fc2f5af14af40d80bfba655ef1d8cd6dee93c` et comparaison avec `master` au commit `9f2be04`. Les mécanismes examinés sont présents dans les deux versions.

Deux fichiers fictifs ont passé le typage du pack 1.3.0 : l’un avec annotations `doc` et inclusion d’un PDF absent ; l’autre sans source. Cela confirme que ces éléments restent facultatifs au typage.

Le code prévoit aussi une sélection de page pour le PDF. L’essai `@ p. 2` échoue avec `int_of_string` dans le pack testé. Aucune génération PDF complète n’a été exécutée.

Références : [structure documentaire](https://github.com/CatalaLang/catala/blob/e86fc2f5af14af40d80bfba655ef1d8cd6dee93c/compiler/surface/ast.mli#L282), [attributs et extensions](https://github.com/CatalaLang/catala/blob/e86fc2f5af14af40d80bfba655ef1d8cd6dee93c/compiler/desugared/name_resolution.ml#L221), [rendu des annexes PDF](https://github.com/CatalaLang/catala/blob/e86fc2f5af14af40d80bfba655ef1d8cd6dee93c/compiler/literate/latex.ml#L262).

## Obligation de rédaction

Le format est décrit dans `server/piecemaker/vendor/skills/catala/references/format.md`.

- Un article s’écrit `## Article N | LEGIARTI…`, une décision `## … | JURITEXT…` ou `CETATEXT…`. L’extrait exact suit le titre, entre « ». Le bloc ` ```catala ` placé dessous est rattaché à ce texte par sa position.
- Une entrée porte un titre `## texte court`.
- Un fait du dossier est un `contexte` ; sa prémisse OKF porte les pièces citées.
- Les justifications s’écrivent en commentaires `#`.

`pm catala verifier` produit des erreurs distinctes, avec fichier et ligne :

- `titre manquant pour cette entrée.` : une `entrée` sans `##`.
- les erreurs des règles 1 à 3 listées dans `docs/catala.md` (« Règles du vérifieur »).

Une définition sans titre n’est pas une erreur ; le graphe affiche alors la question ou le nom de la variable. Le vérifieur contrôle la longueur des titres ; le skill `catala` fixe leur forme.
Le volet affiche les erreurs de documentation. Le bilan ne peut pas être réussi si ces erreurs restent présentes.

Le même lecteur alimente les cartes du graphe et le contrôle des citations. Le graphe affiche sous une étape les pièces des prémisses que cite un lien `okf:`. La présence d’une citation ne valide ni le passage cité ni sa pertinence.

Implantation commune : `server/piecemaker/vendor/skills/Skill-PieceMaker/scripts/catala-documentation.mjs`.
Ce fichier est livré avec la commande `pm` ; le lecteur partagé `shared/piecemaker/catala-sources.ts` exploite ses positions.

## Ce que PieceMaker ajoute

| Ajout | Comportement |
|---|---|
| Graphe à nœuds partagés | Chaque règle ou fait est détaillé une seule fois. Ses autres emplois renvoient à cette case. |
| Lecture juridique | Un arbre de gauche à droite : la prétention et sa conclusion, ses conditions, leurs propres conditions, puis les faits et les pièces. |
| Groupes `ET`, `OU`, `NON` | PieceMaker lit les expressions booléennes simples présentes dans la trace pour expliciter les relations. |
| Conditions d’application | Les dépendances pointillées de la trace restent identifiées. Une négation `NON` reste distincte de la sélection d’une définition conditionnelle. Un lien pointillé ne prouve pas, à lui seul, une exception. |
| Sources attachées aux éléments | Chaque condition ou exception réunit son fondement juridique, le fait invoqué et sa pièce dans trois parties distinctes. |
| Origine distinguée | Les références distinguent textes, jurisprudence, pièces et autres références. Une simple page web ne remplace pas un fondement juridique. |
| Valeur distincte de la preuve | La couleur dit seulement la valeur du scénario. Une étiquette séparée dit l’état de la preuve : « Pièce citée », « Relevé par l’agent, à relire », « Relu par l’avocat », « Pièce à rattacher », « Citation introuvable dans la pièce », « Fondement à préciser ». Un fait vrai sans pièce reste vert. |
| Données sans pièce | L’étiquette indique « Pièce à rattacher ». Aucune erreur n’est comptée pour ce seul manque. |
| États inconnus ou contestés | Les valeurs correspondantes restent visibles et créent un point ouvert. PieceMaker ne les remplace pas par un booléen. |
| Points ouverts | Une donnée sans pièce, un fondement absent, une citation à vérifier ou une recherche déclarée est signalé sur sa carte. Aucun nœud technique supplémentaire n’est créé. |
| Remontée des manques | Un manque ne change pas la couleur des cases qui en dépendent. La case affiche « N points ouverts en amont », bouton qui mène au premier. La conclusion liste les réserves : faits indéterminés, preuves manquantes, pièces à relire, fondements à préciser, citations introuvables. |
| Principe écarté | Quand une exception s’applique, la case garde le principe écarté, barré, avec sa source. Une exception non retenue reste visible avec sa condition. |
| Autres résultats | Les résultats du programme qui ne fondent pas la prétention sont regroupés sous le graphe principal, dans « Autres résultats du programme ». |
| Choix du scénario | Le volet charge les traces conservées lors de la vérification, sans relancer Catala à chaque sélection. |
| Test en échec visible | Le scénario reste dans la liste. Si Catala ne produit pas de trace valide, le volet annonce l’absence de graphe. |
| Sélection d’un nœud | La sélection atténue les éléments sans relation avec le nœud choisi. Aucun panneau ne s’ouvre. Chaque article, décision ou pièce cité s’ouvre directement dans la visionneuse, au passage cité. |
| Navigation dans les sources | Les pièces et références juridiques utilisent les lecteurs et contrôles de citation PieceMaker existants. |

PieceMaker présente le raisonnement comme un arbre, lu de gauche à droite :

1. La prétention figure à gauche. Une flèche la relie à la conclusion, affichée dessous : « Prétention fondée », « Prétention non fondée », « Issue indéterminée », ou la valeur calculée (un montant, une date). La conclusion liste ses réserves, chacune cliquable.
2. Chaque colonne à droite décompose la case précédente en conditions, puis en conditions de ces conditions. Les expressions du code restent entières : conditions cumulatives, alternatives, négatives, calculs et exceptions imbriqués gardent leur profondeur.
3. Une branche se termine par un fait et sa pièce, avec la citation exacte.
4. Une case déjà détaillée ailleurs devient un renvoi vers cette case.

Chaque case indique son rôle (« Prétention », « Condition », « Exception », « Fait »), sa valeur, l’étiquette de sa preuve, puis ses sources. Un fait affiche « Oui », « Non », « Indéterminé » ou « Contesté » ; une condition « Remplie », « Non remplie » ou « Indéterminée ». Sous un fait, l’énoncé de sa prémisse OKF reprend ce que la pièce établit. Une condition affiche une source seulement si cette source diffère de celle de la règle. Un calcul simple affiche sa formule, sauf si la condition dessinée la montre déjà.

La couleur d’une case et de son trait donne la valeur du scénario, et elle seule :

| Couleur | Valeur |
|---|---|
| Vert | Condition remplie, fait vrai ou valeur calculée. |
| Orange, bord pointillé | Valeur indéterminée ou contestée. |
| Rouge | Condition non remplie, ou exception qui fait obstacle. |

La prétention est titrée par l’`objectif` de `tache.json` ou, à défaut, par la ligne `Objectif : …`. Des courbes relient chaque case à ses conditions. Pendant le défilement, chaque case reste à hauteur de lecture tant que ses branches sont à l’écran. Chaque source est cliquable : article, décision, doctrine, clause ou pièce s’ouvre dans la visionneuse interne, sur le passage cité. Le titre d’une pièce est son titre Markdown (`# …`) ; à défaut, son nom de fichier. Les URL ne sont pas affichées. Les dates s’écrivent en français (« 15 janvier 2024 »). Les autres contrôles restent dans `pm catala verifier`. Aucun Graphviz n’est nécessaire.

## Mode contrat

Quand `tache.json` porte `"type": "transactional"`, le volet présente le programme comme un contrat, et non comme un litige :

| Litige (`litigation`) | Contrat (`transactional`) |
|---|---|
| Prétention | Stipulation |
| Conclusion : « Prétention fondée » | Effet : « La stipulation joue », ou la valeur due |
| Condition | Condition de la clause |
| Exception | Dérogation |
| Principe écarté | Clause écartée |
| Fait, avec sa pièce | Hypothèse, sans pièce |
| Scénario | Cas de figure |
| Fondement à préciser | Clause à rattacher |

Une règle se rattache à une clause du contrat : un titre `## Article 5 — Pénalités de retard` suivi du texte exact de la clause entre « ». La clause apparaît comme source de la règle, avec le symbole ¶, et s’ouvre comme les autres sources. Une règle peut aussi rester sous un article de loi (`| LEGIARTI…`). Les hypothèses d’un cas de figure ne demandent pas de prémisse : le contrat se lit en hypothèses, non en faits prouvés. `pm catala verifier` applique les mêmes contrôles de rattachement, la clause valant source. Un contrat qui ne cite aucun article de loi passe `catleg` ; un article `| LEGIARTI…` qu’il cite reste contrôlé.

L’exemple [contrat-maintenance](tests/contrat-maintenance/README.md) modélise une clause de pénalités plafonnée et sa dérogation pour force majeure.

Le graphe est la vue initiale. La présentation écrite reste disponible dans le même volet. La présentation reprend celle du plugin Raisonnement : prétention et conclusion, règles et conditions, avec leurs appuis sur les cartes. Les lignes du compilateur, traces JSON et définitions alternatives restent dans un détail repliable. Les sources sans rattachement sont regroupées hors du dessin principal.

Un groupe ET, OU ou SAUF imbriqué forme une étiquette entre la condition et ses branches.

Une condition est marquée « Exception » seulement si Catala la rattache à une définition qui en écarte une autre (`exception`). Sans fait distinct, la carte indique « Aucun fait distinct renseigné ». Sans source précise, elle indique « Fondement à préciser » ou « Pièce à rattacher ».

Une entrée booléenne ne suffit pas à rédiger un fait. Le graphe utilise la donnée distincte ou la citation déclarée dans le programme.

## Rédaction nécessaire dans le programme

Les règles, calculs, conditions et exceptions restent du code Catala. Les explications et démarches restent du Markdown dans les mêmes fichiers.

Les justifications s’écrivent en commentaires `#` dans le code. Pour les anciens programmes, le graphe lit encore une section `Concerne : identifiant`, qui rattache ses pièces et explications au nœud correspondant, avec ces champs facultatifs :

| Champ | Rôle dans PieceMaker |
|---|---|
| `Question : …` | Libellé de la question sur le nœud. |
| `Objectif : …` | Objectif annoncé par l’avocat. Il titre la prétention du graphe ; sans cette ligne, la prétention garde son propre titre. Une seule ligne par programme ; elle n’a pas besoin de `Concerne`. |
| `Justification : …` | Explication rédigée par l’agent, visible dans la carte de la vue Raisonnement. |
| `À rechercher : …` | Démarche nécessaire, affichée comme point ouvert. |
| `Démarche : …` | Démarche effectuée et résultat déclaré, conservés dans la vue Raisonnement. Plusieurs lignes sont possibles. |

Ces champs ne sont pas des instructions Catala. Ils ne changent pas le résultat du programme. Ils ne prouvent pas davantage l’exactitude des explications.

L’extrait sous l’article est une convention PieceMaker. Catala permet de joindre les textes au code, sans imposer ces conventions.

La provenance complète demande un élément, une source, une citation exacte et une justification du lien. Le contrôle de citation vérifie le passage ; il ne valide pas cette justification.

Catala permet aussi de répartir un module entre des fichiers consacrés à des sources distinctes. La [documentation officielle](https://book.catala-lang.org/en/5-1-literate-programming.html) décrit cette inclusion textuelle et la conservation des titres. Le graphe ne choisit pas automatiquement quelle source fonde chaque condition d’une formule globale.

La [fiche de rédaction](../server/piecemaker/vendor/skills/catala/references/graphe.md) précise la décomposition attendue et donne un exemple fictif. Les notes d’un fichier de test sont utilisées seulement lorsque cette exécution utilise ce fichier.

Pour un fait inconnu, l’agent doit tester les hypothèses pertinentes ou coder explicitement cet état avec une énumération Catala. Il ne doit pas choisir `faux` par défaut.

## Fichiers produits et fraîcheur

`pm catala verifier` conserve les sorties dans `.piecemaker/catala/<nom>/resultats/` :

| Fichier | Contenu |
|---|---|
| `tests.json` | Rapport Clerk, couverture native et empreinte des sources ajoutée par PieceMaker. |
| `scenarios.json` | Rapports, graphes et provenance native des scénarios identifiés dans le rapport Clerk. Chaque provenance conserve trace, arbres des définitions, dépendances et indisponibilités. Ce regroupement appartient à PieceMaker. |
| `explication.dot` et `explication.json` | Trace principale et provenance native, compatibles avec `pm catala expliquer`. Le DOT peut être vide si le graphe utilise le repli JSON. |
| `citations.json` | Contrôle des citations par les services PieceMaker existants. |

Les calculs des scénarios restent séquentiels. Le choix d’un scénario dans le volet ne déclenche aucun calcul ni aucune recherche.

L’empreinte des fichiers Catala empêche d’utiliser les scénarios, citations et tests périmés après une modification. Les anciennes traces ne deviennent pas des preuves actuelles.

## Limites conservées

- La trace concerne une exécution. Le graphe ne représente pas toutes les branches possibles du droit ni du programme.
- La couverture Clerk indique des passages exercés. Elle ne démontre ni la couverture de toutes les combinaisons ni l’exhaustivité juridique.
- Le regroupement logique lit les expressions simples du DOT. Les expressions complexes restent des calculs avec leurs dépendances ; PieceMaker ne les résout pas.
- Un extrait retrouvé dans une pièce ne démontre pas que cette pièce établit le fait ou la qualification.
- Une source rattachée à une règle ne démontre pas que cette source fonde correctement la règle.
- Les points ouverts signalent les manques représentés. Ils ne mesurent pas une exhaustivité globale ni les indicateurs EC/EVC de MAP-Law.
- Les démarches sont rédigées dans les fichiers Catala. Aucun journal automatique des outils ni aucune archive complète des révisions n’est ajouté.
- PieceMaker ne lance aucune collecte à partir des nœuds. L’agent ou l’avocat choisit et effectue la démarche.
- Les noms utilisés par `Concerne` doivent distinguer les notions du programme. Des identifiants homonymes dans plusieurs champs restent ambigus.

## Implantation

- Lecture du DOT, sources et notes : `plugins/piecemaker-catala/src/graph.ts`.
- Lecture de la trace JSON et des arbres natifs : `plugins/piecemaker-catala/src/native-provenance.ts`.
- Regroupement condition, fondement et fait : `plugins/piecemaker-catala/src/condition-application.ts`.
- Construction du graphe partagé : `plugins/piecemaker-catala/src/reasoning-map.ts`.
- Sélection, zoom et ouverture des sources : `plugins/piecemaker-catala/src/graph-view.ts`.
- Choix des scénarios : `plugins/piecemaker-catala/src/client.ts`.
- Vérification et conservation des traces : `server/piecemaker/vendor/skills/Skill-PieceMaker/scripts/catala.mjs`.
- Transmission des résultats actuels : `server/piecemaker/catala.ts`.

Les tests ciblés couvrent la prétention et sa conclusion, la séparation entre valeur et preuve, le mode contrat, les libellés Oui/Non, les appuis partagés, les points ouverts, les notes, la couverture, le choix des scénarios et la fraîcheur des résultats. Ils vérifient aussi les origines natives des données, le choix de la définition appliquée, les exceptions, les chemins relatifs et le repli JSON lorsque le DOT échoue.

Un essai local fictif sous Catala 1.3 a aussi exécuté trois scénarios avec typage, format, tests Clerk, tests Python et preuve réussis. Les contrôles de citations et de vigueur n’ont pas été validés sur cet exemple sans fondement juridique.
