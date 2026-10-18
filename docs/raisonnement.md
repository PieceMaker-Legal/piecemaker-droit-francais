# Raisonnement du dossier

L’agent construit la théorie juridique du dossier pas à pas avec la commande `pm raisonnement` de la skill `piecemaker` (`server/piecemaker/vendor/skills/Skill-PieceMaker/`, même route locale que l’ancien outil MCP). Il n’écrit pas de code : chaque commande ajoute un élément, le serveur génère le programme Catala, l’exécute et renvoie un état court avec ce qui reste à faire. Le volet droit **Raisonnement** montre le graphe, le détail de chaque élément et le test. L’avocat valide ou écarte chaque élément : un élément décidé est verrouillé et l’agent ne peut plus le modifier.

## Concept

Le programme d’une question est un syllogisme juridique écrit en Catala ; le graphe, le test et le volet en suivent l’ordre.

1. **En droit** — le champ d’application de la question : chaque `règle` est une condition, fondée par `#[selon = …]` sur un texte, une décision ou une doctrine, et ne s’applique que si sa source est en vigueur à la `date_de_référence`.
2. **En fait** — le champ `Dossier` : chaque `définition` établit une `entrée` par une pièce (`#[selon]`, `#[force]`, `#[appréciation]`). Un fait non prouvé vaut inconnu.
3. **Conclusion** — le `résultat` combine les conditions (évaluation à trois valeurs) et se compare à `#[objectif]`.

L’instruction de chat ajoute une seule ligne : pour une analyse appliquée au dossier, utiliser `pm raisonnement` (`pm raisonnement etat` pour reprendre). Aucun code n’est injecté dans le prompt.

## Commandes

| Commande | Champs | Effet |
|---|---|---|
| `etat` | `question` facultatif, `vue` (`complete`) | Arbre de la réponse : conditions avec rôle, type, règle(s), valeur, faits dont elles dépendent, voies, « À faire », erreurs du programme, alertes du dernier test. `vue complete` ajoute les extraits cités, la vigueur, les pièces, la force probante et l’appréciation. |
| `question` | `texte`, `objectif` (`oui`/`non`), `date` (nom du fait date de référence), `question` pour modifier | Crée `Q1`, `Q2`… |
| `type` | `nom` (majuscule), `champs` (`montant contenu argent, …`) ou `cas` (`Amiable, Judiciaire contenu date`) | Déclare une structure ou une énumération ; `retirer --type Nom` la retire. |
| `condition` | `question`, `nom`, `libelle`, `regle`, `source`, `extrait`, `role` (`condition`, `fondement`, `moyen_adverse`, `assertion`), `a_la_date`, `type`, `parametres`, `etiquette`, `exception_de`, `etat`, `si`, `consequence` | `source` = `LEGIARTI…`, `JURITEXT…` (lus sur Légifrance par le serveur) ou chemin d’une note de doctrine ; l’extrait est recherché dans le texte, la période de vigueur et l’historique judiciaire sont relevés. Un nom inconnu dans `regle` devient un fait booléen à prouver ; `fait` refuse un nom qu'aucune condition n'utilise. |
| `fait` | `question`, `nom`, `type`, `valeur`, `piece`, `extrait`, `force`, `appreciation` | L’extrait est recherché dans la pièce (Markdown converti) ; introuvable, le fait reste non établi. |
| `retirer` | `question`, `nom` facultatif, `etiquette`, `etat` ; ou `type` | Retire une règle, un élément, toute la question ou un type. |
| `tester` | — | Exécute le test (ci-dessous), renvoie les alertes groupées par élément puis l’arbre. |

`regle` est une expression Catala complète (voir ci-dessous). Sans `type`, c’est la condition d’une `règle … conséquence [non] rempli` (`consequence non`) ; avec `type`, c’est la valeur d’une `définition` (`si` = condition facultative). `parametres` en fait une fonction (`dépendant de`), `etiquette`/`exception_de` (`base` = règles sans étiquette) des exceptions, `etat` des états successifs (dans un état, le nom désigne l’état précédent), `role assertion` une assertion vérifiée au test (source facultative). `q1.reponse` dans une règle de `Q2` appelle la question `Q1` comme sous-champ. Un fait peut être de type `liste de T`, structure ou énumération ; sa `valeur` est alors une constante Catala (`[Echeance { -- montant: 1 000 € -- payee: faux }]`, `Judiciaire contenu |2024-02-01|`). Une condition `fondement` mène à la réponse (`étiquette base règle reponse …`), un `moyen_adverse` l’écarte (`exception base … conséquence non rempli`).

Le modèle (questions, conditions, faits) est stocké dans `pm_reasoning_models` ; le Catala est régénéré à chaque commande, puis les verrous de l’avocat sont réappliqués.

## Test

Le test est l’exécution statique de la théorie avec tout ce qui est disponible dans le dossier (`POST /api/piecemaker/reasoning/test`, bouton « Lancer le test » ou commande `tester`) :

- **Programme** : réponse calculée et objectif, vigueur de chaque article à la date de référence, conditions sans fondement, faits à prouver.
- **Jurisprudence** : chaque décision citée est relue sur Légifrance ; une décision remise en cause par une décision supérieure ou un recours à examiner est signalé.
- **Pièces** : chaque extrait cité est recherché à nouveau dans sa pièce.
- **Personnes morales de la base SQL** (`piecemaker_nodes` de type `company`) : recherche au Registre Public par SIREN (sinon par nom) ; introuvable, radiée ou cessée est signalé ; avec un SIREN, les alertes BODACC (procédure collective, radiation) sont relevées.

La route répond en NDJSON : une ligne `{entry}` par étape du journal (`ReasoningLogEntry` : vérification en cours puis son résultat, sous la même clé ; puis le raisonnement en langage clair : fondement de chaque règle, vigueur, valeur de chaque fait, conclusion de chaque condition, réponse ; aucun code n’est affiché), et une dernière ligne `{snapshot}`. L’onglet Tests du volet regroupe ce journal en démonstration à mesure qu’il arrive (voir Volet). Le rapport (`ReasoningTestReport`, alertes d’abord, avec le journal final) est conservé dans l’instantané jusqu’à la commande suivante. Une vérification impossible (réseau, Légifrance) est une alerte, jamais un succès.

Langage pris en charge (`server/modules/piecemaker-reasoning/catala.ts`, vérification de types `checkTypes`, évaluation à trois valeurs dans `evaluate.ts`) : structures, énumérations, déclarations globales (constantes et fonctions) ; éléments `entrée`/`interne`/`résultat`/`contexte` (et `entrée résultat`, `contexte résultat`), `condition` ou `contenu T` (types de base, `liste de T`, structures, énumérations), `dépendant de`, `état` ; sous-champs `x champ S` / `x champ d'application S` ; `règle`/`définition` avec arguments, `état`, `étiquette`, `exception` avec ou sans étiquette, `assertion`, `date arrondi croissant|décroissant` ; expressions `et`, `ou`, `ou bien`, `non`, comparaisons, `+ - * /`, `++`, `contient`, `si … alors … sinon`, `soit … dans`, `selon … sous forme`, `sous forme Cas [de x et …]`, accès `x.champ`, littéraux de structure, constructeurs `Cas contenu e`, listes `[a; b]`, `nombre de`, `somme T de`, `maximum`/`minimum de … [ou si liste vide alors …]`, `existe … parmi … tel que`, `pour tout … parmi … on a`, `transforme chaque … parmi … en`, `liste de … parmi … tel que`, `contenu de … parmi … tel que … est maximum|minimum`, `combine tout … parmi … dans … initialement … avec`, appels `f de x` / `f de (a, b)`, `arrondi de`, `décimal de`, `argent de`, `accès_jour|mois|année de`, `premier_jour_du_mois de`, `dernier_jour_du_mois de`, `résultat de S avec { -- x: e }`, `30%`, `impossible` ; Markdown littéraire (blocs ```catala). Hors périmètre : modules (`> Module`, `> Usage de`), tuples, bibliothèque standard ; le compilateur officiel (OCaml) n’est pas utilisé.

## Vérifications statiques

- **Question** : valable si elle énonce `question`, un `résultat`, une `date_de_référence` (entrée de type date) et au moins une condition fondée, avec au moins un article cité.
- **Vigueur** : pour chaque article cité par une règle, la date de référence (ou `#[à_la_date = …]`) doit tomber dans la période `Validité` lue dans le résultat `consulter_article` (début inclus, fin exclusive). Hors période, la règle ne s’applique pas ; période inconnue, la condition est bloquée.
- **Fondement d’une condition** : chaque règle cite au moins une source dont l’extrait est retrouvé. Article = loi, décision = jurisprudence, document cité par une règle = doctrine. La force retenue est la plus haute (loi > jurisprudence > doctrine) ; une condition fondée sur la seule doctrine est signalée. Ce classement n’est pas annoncé au modèle.
- **Jurisprudence** : `consulter_decision` ajoute un contrôle `Historique: …` calculé par le MCP Légifrance (`controle_historique`, fil procédural de `Historique_Judiciaire`) : un recours qui a cassé, annulé ou infirmé la décision la rend « remise en cause » et elle ne fonde plus rien ; un recours sans solution lisible ou un relevé tronqué la laisse « à examiner ». Les décisions postérieures qui la citent sont listées sans interprétation.
- **Faits** : une entrée est établie par une définition dans `Dossier` dont la valeur est une constante du bon type, prouvée par au moins une pièce (document cité par le champ Dossier) dont l’extrait est retrouvé, avec une force probante (`acte_authentique`, `acte_sous_seing_privé`, `commencement_de_preuve`, `indice`, `sans_valeur`). Sinon elle est « non établie » et vaut inconnu ; sans pièce : « pièce à rechercher ».

L’évaluation est à trois valeurs (vrai, faux, inconnu). Une condition est remplie, non remplie, indéterminée ou bloquée (fondement manquant, période inconnue, écartée par l’avocat, erreur de type, conflit d’exceptions). Une question est bloquée si une condition dont elle dépend l’est.

## Objectif et argumentaire

`#[objectif = rempli]` (ou `non rempli`, en défense) déclare le résultat recherché pour le client. Chaque règle qui définit le résultat est une **voie** : celles dont la conséquence va dans le sens de l’objectif sont les moyens du client, les autres (en pratique des `exception` de conséquence contraire) les moyens adverses. Pour chaque voie, le serveur donne son état (ouverte, à établir, fermée, bloquée), son fondement le plus faible, les faits encore non établis qui l’alimentent et ses points faibles (doctrine seule, historique à examiner, pièce valant simple indice ou commencement de preuve). Les moyens du client sont classés (ouverts d’abord, puis par fondement, puis par nombre de faits à prouver) : le premier est le principal, les suivants subsidiaires. L’objectif est « atteint », « à établir » ou « hors d’atteinte » selon la valeur du résultat.

Charge de la preuve (art. 1353 C. civ.) : un fait qui alimente un moyen du client est à sa charge ; un fait qui n’alimente qu’un moyen adverse est à la charge de l’adversaire. Aucun calcul de combinaisons : l’analyse lit seulement les dépendances du programme.

## Décisions de l’avocat

Chaque condition et chaque fait se valide, s’écarte ou se modifie dans le volet (`POST /api/piecemaker/reasoning/review` et `/appreciation`). Une modification d’un fait (valeur, force probante, appréciation) est enregistrée avec l’auteur `avocat` et valide le fait. Le texte de l’élément est figé (`locked_json`) : toute commande de l’agent qui le vise est refusée. « Annuler la décision » rend l’élément à l’agent.

## Volet

- **Graphe** : sources du droit, conditions et réponse, faits. Un clic sur un nœud éclaire sa branche.
- **Détail** : la réponse en langage courant, ce qui reste à prouver, puis le détail du nœud choisi avec ses boutons de validation.
- **Tests** : bouton « Lancer le test » et journal animé présenté comme une démonstration :
  - **Ce que le test doit démontrer** : la question, l’objectif du client et, pour chaque voie, les conditions dont dépend la réponse ;
  - **1. En droit** : chaque condition avec son texte relu sur Légifrance, sa période de validité et sa vigueur à la date de référence ; une condition sans fondement est signalée ;
  - **2. En fait** : une fiche par condition, dans l’ordre des dépendances — les faits avec la pièce qui les prouve (extrait retrouvé), puis « Donc » ; Registre Public et faits sans condition (date de référence) sont listés avant ;
  - **3. Conclusion** : la réponse et un verdict (démontré, pas encore démontré faute de preuve, non démontrable faute de fondement), rapproché de l’objectif.

  Pendant le test, les vérifications tournent en parallèle mais la démonstration se déroule dans cet ordre, une ligne à la fois : chaque ligne apparaît « en cours », se valide quand ses vérifications sont terminées, puis la suivante démarre ; le compteur n’apparaît qu’à la fin et la vue suit la ligne en cours (sauf si l’avocat fait défiler). Un lien du journal éclaire l’élément dans le graphe sans quitter l’onglet ; un clic sur un nœud ouvre son détail, avec « ← Retour au test ». Un clic sur un fait ouvre sa fiche pour le renseigner ; le nombre d’alertes du dernier test s’affiche sur l’onglet. L’exemple fictif contient un journal de test simulé. Style repris du plugin piecemaker-dossier.

## SQL

Tables en lecture seule pour l’outil SQL :

```sql
SELECT code, snapshot_json FROM pm_reasoning_programs WHERE project_id=dossier();
SELECT item_id, kind, status, value_json, force, appreciation, author FROM pm_reasoning_items WHERE project_id=dossier();
```

Les tables des versions précédentes (`pm_reasoning_results`, `_nodes`, `_relations`, `_links`, `_theories`, `_tests`, `_turns`) sont supprimées au démarrage.

## Fichiers

- `shared/piecemaker-reasoning.ts` : contrat partagé.
- `server/modules/piecemaker-reasoning/` : commandes et génération du Catala (`commands.ts`), analyseur, évaluation, persistance, verrous, test, routes ; tests dans `tests/raisonnement.test.ts` (connecteurs fictifs).
- `server/piecemaker/reasoning-connectors.ts` : Légifrance (`consulter_article`, `consulter_decision`), pièces, Registre Public, BODACC.
- `server/piecemaker/vendor/mcp/piecemaker/server.mjs` : outil `raisonnement`, relayé à `POST /api/piecemaker/local/reasoning` (boucle locale seulement).
- `server/piecemaker/vendor/mcp/legifrance/tools/decision_history.py` : `controle_historique`, appelé par `consulter_decision`.
- `plugins/piecemaker-raisonnement/` : volet.

## Legal Code (beta)

Bouton « Legal Code » sous « Nouvelle session » (`src/piecemaker/legal-code/`) : ouvre une session vierge avec, sous « Choisissez votre assistant IA », un encart qui explique le fonctionnement. Rien n’apparaît dans le composeur : le premier message porte l’option `legalCode`, et `installLegalCodeHarness` (`server/piecemaker/legal-code/`) y ajoute `instructions.md` entre balises `<LEGAL_CODE_INSTRUCTION>`, retirées de l’écho et de l’historique. Un clic sur « Nouvelle session » ou l’ouverture d’une autre session annule le mode. Le reste de la session est une session classique.
