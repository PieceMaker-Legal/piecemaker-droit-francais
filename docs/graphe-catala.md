# Graphe du raisonnement : Catala et ajouts PieceMaker

Le graphe relie la conclusion d’un scénario à ses conditions, ses données, ses sources et ses points ouverts. Catala fournit le calcul. PieceMaker organise sa lecture et signale les justifications manquantes.

L’objectif vient de [05-map-law.md](recherche-memoire-raisonnement/05-map-law.md) : rendre chaque élément et son soutien consultables, puis montrer ce qui reste à rechercher.

## Ce qui vient de Catala

| Élément | Sortie native utilisée | Portée |
|---|---|---|
| Variables, valeurs et dépendances d’une exécution | `catala explain --whole-program --conditions --dot` | Décrit le scénario exécuté. |
| Formules et conditions rencontrées | Libellés et relations du DOT | Permet de suivre le calcul réellement produit. |
| Emplacement des règles et données | URL et numéro de ligne des nœuds DOT | Rattache le calcul au fichier Catala. |
| Contexte documentaire | Titres Markdown conservés dans les positions et explications | Catala conserve l’emplacement du texte associé ; il ne vérifie pas le fondement cité. |
| Scénarios et assertions | `#[test]`, `clerk runtest`, `clerk report --json` | Distingue test réussi et test en échec. |
| Passages exercés par les tests | `coverage.locations`, `reached_by` et `coverage.scopes` du rapport Clerk | Indique quels scénarios ont exercé le passage correspondant au nœud. |
| Inventaire des champs et dépendances statiques | `catala dependency-graph` | Sert au contrôle des champs métier par le vérificateur. Cette sortie ne dessine pas le graphe affiché. |
| Hiérarchie des exceptions | `catala exceptions` | Reste accessible par `pm catala exceptions`. Le volet ne reconstruit pas cet arbre complet. |
| Contrôle des conflits et erreurs | `catala proof`, avec Z3 dans les packs compatibles | Porte sur les obligations produites pour le programme. |
| Génération d’un scénario initial | `catala testcase generate` et `testcase write`, via `pm catala squelette` | Produit un point de départ. L’agent doit fixer les données et les assertions. |

Catala ne vérifie pas les faits du dossier. Un test réussi signifie que les assertions passent. Le résultat métier du test peut être `faux`.

## Ce que PieceMaker ajoute

| Ajout | Comportement |
|---|---|
| Graphe à nœuds partagés | Une donnée ou une source commune garde un seul nœud, avec plusieurs relations. |
| Lecture depuis la conclusion | Les relations conduisent vers les conditions, données et sources utilisées. |
| Groupes `ET`, `OU`, `NON` | PieceMaker lit les expressions booléennes simples présentes dans la trace pour expliciter les relations. |
| Conditions d’application | Les dépendances pointillées de la trace restent identifiées. Une négation `NON` reste distincte de la sélection d’une définition conditionnelle. Un lien pointillé ne prouve pas, à lui seul, une exception. |
| Sources visibles comme nœuds | Les pièces et fondements deviennent des appuis reliés aux éléments concernés. |
| Origine distinguée | Les nœuds séparent textes, jurisprudence, pièces et autres références. Une simple page web ne remplace pas un fondement juridique. |
| Valeur distincte de la preuve | `Vrai` reste « Vrai » et `Faux` reste « Faux ». Aucune de ces valeurs n’est renommée « Établi ». |
| Données sans pièce | Le graphe affiche « Hypothèse du scénario » et demande une justification. |
| États inconnus ou contestés | Les valeurs correspondantes restent visibles et créent un point ouvert. PieceMaker ne les remplace pas par un booléen. |
| Points ouverts | Une donnée sans pièce, un fondement absent, une citation à vérifier ou une recherche déclarée devient un nœud lié. |
| Remontée des manques | Un manque dans les appuis fait apparaître « Justification à compléter » sur les règles qui en dépendent. |
| Choix du scénario | Le volet charge les traces conservées lors de la vérification, sans relancer Catala à chaque sélection. |
| Test en échec visible | Le scénario reste dans la liste. Si Catala ne produit pas de trace valide, le volet annonce l’absence de graphe. |
| Inspection d’un nœud | La sélection montre le détail et atténue les éléments sans relation avec le nœud choisi. |
| Navigation dans les sources | Les pièces et références juridiques utilisent les lecteurs et contrôles de citation PieceMaker existants. |

PieceMaker dispose les nœuds en colonnes. Les relations sont dessinées en SVG et suivent les dimensions des cartes. Aucun Graphviz n’est nécessaire.

Le graphe est la vue initiale. La présentation écrite reste disponible dans le même volet.

## Rédaction nécessaire dans le programme

Les règles, calculs, conditions et exceptions restent du code Catala. Les explications et démarches restent du Markdown dans les mêmes fichiers.

Une section `Concerne : identifiant` rattache ses pièces et explications au nœud correspondant. Les champs facultatifs sont :

| Champ | Rôle dans PieceMaker |
|---|---|
| `Question : …` | Libellé de la question sur le nœud. |
| `Justification : …` | Explication rédigée par l’agent, visible dans le graphe et son détail. |
| `À rechercher : …` | Démarche nécessaire, affichée comme point ouvert. |
| `Démarche : …` | Démarche effectuée et résultat déclaré, conservés dans le détail. Plusieurs lignes sont possibles. |

Ces champs ne sont pas des instructions Catala. Ils ne changent pas le résultat du programme. Ils ne prouvent pas davantage l’exactitude des explications.

Les mentions `Source :`, `Citation :` et `Concerne :` sont des conventions PieceMaker. Catala permet de joindre les textes au code, sans imposer ces conventions.

La provenance complète demande un élément, une source, une citation exacte et une justification du lien. Le contrôle de citation vérifie le passage ; il ne valide pas cette justification.

Catala permet aussi de répartir un module entre des fichiers consacrés à des sources distinctes. La [documentation officielle](https://book.catala-lang.org/en/5-1-literate-programming.html) décrit cette inclusion textuelle et la conservation des titres. Le graphe ne choisit pas automatiquement quelle source fonde chaque condition d’une formule globale.

La [fiche de rédaction](../server/piecemaker/vendor/skills/catala/references/graphe.md) précise la décomposition attendue et donne un exemple fictif. Les notes d’un fichier de test sont utilisées seulement lorsque cette exécution utilise ce fichier.

Pour un fait inconnu, l’agent doit tester les hypothèses pertinentes ou coder explicitement cet état avec une énumération Catala. Il ne doit pas choisir `faux` par défaut.

## Fichiers produits et fraîcheur

`pm catala verifier` conserve les sorties dans `.piecemaker/catala/<nom>/resultats/` :

| Fichier | Contenu |
|---|---|
| `tests.json` | Rapport Clerk, couverture native et empreinte des sources ajoutée par PieceMaker. |
| `scenarios.json` | Rapports et graphes des scénarios identifiés dans le rapport Clerk. Ce regroupement appartient à PieceMaker. |
| `explication.dot` et `explication.json` | Trace principale, compatible avec la commande `pm catala expliquer`. |
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
- Construction du graphe partagé : `plugins/piecemaker-catala/src/reasoning-map.ts`.
- Relations SVG, sélection et détail : `plugins/piecemaker-catala/src/graph-view.ts`.
- Choix des scénarios : `plugins/piecemaker-catala/src/client.ts`.
- Vérification et conservation des traces : `server/piecemaker/vendor/skills/Skill-PieceMaker/scripts/catala.mjs`.
- Transmission des résultats actuels : `server/piecemaker/catala.ts`.

Les tests ciblés couvrent les libellés Vrai/Faux, les appuis partagés, les points ouverts, les notes, la couverture, le choix des scénarios et la fraîcheur des résultats.

Un essai local fictif sous Catala 1.3 a aussi exécuté trois scénarios avec typage, format, tests Clerk, tests Python et preuve réussis. Les contrôles de citations et de vigueur n’ont pas été validés sur cet exemple sans fondement juridique.
