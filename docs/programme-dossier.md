# Raisonnement cumulatif du dossier

Le volet droit **Raisonnement** représente un modèle qui s’enrichit à chaque tour : les sources lues, les règles de droit, les faits et relations entre entités, puis les théories juridiques proposées. Le modèle est interrogeable par l’outil SQL existant. Le serveur compile les annotations finales et exécute les expressions ; le modèle récupère l’état et les diagnostics au tour suivant.

Le moteur est un interpréteur déclaratif natif. Il ne compile pas Catala et ne possède pas toutes ses fonctionnalités. La traduction d’un texte en règle, le soutien d’une proposition par un extrait et la valeur probatoire des documents restent des interprétations à examiner. La vérification des citations établit une correspondance textuelle, pas la validité de ces interprétations.

## Trois couches

- **Droit** : règles réutilisables, paramètres, conditions, conséquences et exceptions, avec justification, sources et période de validité obligatoire.
- **Faits et relations** : assertions atomiques et liens entre les entités du dossier. Une relation peut être contractuelle, alléguée ou contestée ; son prédicat est libre. Le statut de l’assertion ne signifie pas vérité judiciairement établie.
- **Théorie juridique** : argumentaire exécutable associant les règles datées et les faits, avec ses dépendances, hypothèses, objections et tests.

Une collecte de sources sans propositions est explicitement signalée comme **raisonnement non formalisé**. Elle ne produit aucun résultat exécutable. Les anciens objets `kind:program` restent lisibles pour préserver les dossiers existants ; les nouvelles instructions utilisent `kind:reasoning`.

## Contrat CITATIONS

Conserver un seul bloc JSON strict en fin de réponse. Les citations ordinaires restent inchangées. Elles peuvent recevoir des liens vers des propositions :

```json
[
  {
    "ref": 1,
    "kind": "document",
    "doc_id": "pieces/piece-fictive.md",
    "quotes": [{ "page": 1, "quote": "La somme convenue est de douze euros." }],
    "links": [{ "target": "F_montant", "relation": "supports" }]
  },
  {
    "kind": "reasoning",
    "version": 1,
    "facts": [{
      "id": "F_montant", "label": "Somme convenue en centimes", "value": 1200,
      "state": "asserted",
      "relation": {
        "subject": "entite_exemple_a", "predicate": "montant_convenu",
        "object": "entite_exemple_b", "context": "obligation_exemple", "unit": "centime",
        "eventDate": "2024-06-15", "documentDate": "2024-06-16"
      }
    }]
  }
]
```

Les valeurs et identités de cet exemple sont fictives. Les identifiants des personnes reprennent ceux de `piecemaker_nodes` lorsqu’ils existent. `context` distingue l’obligation ou l’événement : deux paiements différents ne doivent pas être fusionnés. L’annotation est liée à toutes les citations du même numéro dans le tour ; privilégier une citation et une proposition atomiques. Les liens `reports` maintiennent un fait à l’état rapporté, sauf s’il existe aussi une annotation `supports` dans le tour.

`citations:[1]` sur une proposition reste accepté. Sans `citations` ni nouvelle annotation, une proposition existante conserve ses sources. Chaque proposition réémise remplace toute sa définition. Les collections sont fusionnées par identifiant, les éléments non mentionnés restent présents. `remove:["id"]` retire explicitement une proposition, un scénario, un test ou un lien. L’historique conserve les versions. Deux assertions incompatibles doivent recevoir des identifiants distincts ; remplacer une assertion conserve son historique mais ne crée pas automatiquement une opposition active avec son ancienne version.

## Règles de droit et application datée

Une entrée de `law` est une règle avec `id`, `label`, `parameters`, `expression`, `validity`, `rationale` et ses citations. L’expression utilise les paramètres par leurs noms. Une entrée de `theories` fournit `kind` (`rule`, `calculation` ou `conclusion`), `id`, `label`, `expression`, `rationale`.

```json
{
  "apply": "R_regle",
  "bindings": { "condition": { "ref": "F_condition" } },
  "at": { "ref": "F_date_pertinente" }
}
```

Le serveur exige tous les paramètres et une date ISO connue. Une référence directe à la règle ne l’applique pas. Une règle seule est affichée comme une définition à appliquer. Les applications imbriquées sont acceptées ; les cycles sont des erreurs.

Les périodes sont représentées par `{"from":"2024-01-01","to":"2025-01-01"}` : début inclus, fin exclusive. `to:null` représente une version sans fin connue. Les dates du résultat intégral `consulter_article` sont capturées par le serveur ; l’agent ne peut pas inventer le statut de vérification ni les bornes de la source. Une règle peut restreindre cette période, jamais l’élargir. Une source d’article sans période reconnue ou une date hors période bloque l’application. Les bornes proviennent du champ `Validité` du connecteur ; une autre présentation n’est pas devinée. Les dispositions transitoires et le choix de la date pertinente doivent être formalisés par le modèle : le contrôle d’intervalle ne décide pas à lui seul du droit applicable. Les périodes proposées pour d’autres sources que les articles ne sont pas certifiées par des métadonnées du connecteur.

Expressions : scalaires JSON, `{"ref":"id"}`, application datée, ou `{"op":"...","args":[...]}`. Opérateurs : `and`, `or`, `not`, `equal`, `greater`, `atLeast`, `less`, `atMost`, `add`, `subtract`, `multiply`, `divide`, `if`. Pas de code arbitraire. Un fait inconnu, rapporté ou contesté reste indéterminé. Une source absente, périmée, non vérifiée ou recalée bloque la proposition. Les hypothèses d’un scénario peuvent fixer les faits, en restant signalées.

## Preuve des faits, charge de la preuve et pièces attendues

Une pièce est une preuve ; un fait est **prouvé** ou **non établi**. Un fait est prouvé par une citation vérifiée qui le soutient (`supports`) ou par la décision de l’avocat. Un fait rapporté, sans source, sans valeur ou écarté par l’avocat est non établi ; contesté, il reste « contesté ». `burden` nomme la partie qui supporte la charge de la preuve : un fait booléen (ou une exigence de preuve) non établi vaut alors `false`, et le résultat garde la liste `unestablished` des faits dont il dépend.

`evidence:{"nature":["relevé bancaire"],"mentions":["entity:CODE"],"from":"2024-06-15","to":"2025-01-01"}` décrit la pièce attendue. À chaque lecture (volet, tour suivant), le serveur cherche par une requête fixe les pièces du dossier de cette nature, dans cet intervalle de `doc_date`, mentionnant toutes ces entités (`piecemaker_nodes`, `piecemaker_links`) : aucune → « pièce à produire » ; au moins une → « preuve à examiner » (pièces candidates, sans conclure) ; la citation vérifiée de la pièce, ou « Retenir » de l’avocat, rend le fait prouvé. Une pièce ajoutée puis scannée réévalue donc le dossier et les théories touchées sont signalées « à réexaminer ». La nature d’une pièce est devinée par le scan sur son en-tête : une exigence par mentions seules évite de manquer une pièce mal classée.

## Décisions de l’avocat

Dans le détail d’un fait, d’une règle, d’une conclusion ou d’un test : **Retenir**, **Écarter**, **Annuler la décision**, avec un motif (`POST /api/piecemaker/reasoning/review`). Un fait retenu est prouvé ; un élément écarté bloque ce qui en dépend ; un test retenu est compté « validé par l’avocat ». Un élément décidé est verrouillé : l’agent ne peut ni le redéfinir ni le retirer, sa proposition est ignorée et signalée.

## Durées, dates, exceptions et bibliothèque

Les comparaisons acceptent deux dates ISO. `addDuration:[date,n,"days|months|years"]` ajoute des jours calendaires, ou des mois/années au même quantième (dernier jour du mois à défaut, art. 641 CPC) ; `daysBetween:[début,fin]`. Une règle peut porter `exceptions:[{id,label,when,then}]` : une exception active remplace l’expression, deux exceptions actives sont un conflit, une exception indéterminée laisse le résultat indéterminé. `conditions:{"param":{"label","burden"}}` nomme les conditions affichées dans la matrice.

La bibliothèque (`library.ts`) contient des règles écrites une fois, testées et non redéfinissables par l’agent, injectées dès qu’une théorie les applique : `LIB_prescription_2224` (paramètres `connaissance`, `action` ; vrai si l’action est postérieure au dernier jour du terme de cinq ans). Sont hors module : délais spéciaux, report du point de départ, suspension, interruption antérieure et dispositions transitoires. Le module reste à valider par l’avocat.

## Matrice des conditions et contrôle de rédaction

Chaque théorie affiche, sous le graphe conservé, une matrice : condition de chaque règle appliquée, faits, preuves citées et candidates, charge de la preuve, statut (prouvé, non établi, preuve à examiner, contesté, indéterminé, bloqué) et objections (`contradicts`). L’onglet **Rédaction** contrôle un projet d’acte du dossier (`.docx`, `.md`, `.txt`) : montants et dates absents du raisonnement, et réserves (faits non établis, contestés ou à examiner) à ne pas présenter comme acquis. Ce contrôle est mécanique ; il ne vérifie pas le sens des phrases.

## Liens, conflits et chronologie

`links` contient des objets avec `id`, `from`, `to`, `relation`, `rationale`. Relations : `supports`, `contradicts`, `reports`, `depends_on`, `qualifies`, `precedes`. Les liens de citation utilisent `target` à la place des extrémités et leur identifiant est attribué par le serveur.

Le serveur relève :

- des valeurs différentes pour le même sujet, prédicat, objet, contexte, unité et date d’événement ;
- les contradictions explicitement annotées ;
- une chronologie inversée par rapport à un lien `precedes`, à partir des dates des événements.

Ce sont des conflits potentiels. Les propositions concernées sont bloquées dans la base ; des scénarios permettent d’examiner les variantes. Aucun rapprochement sémantique automatique de noms ou d’assertions n’est effectué. Le serveur ne peut pas découvrir une contradiction jamais annotée si ses objets, périmètres ou dates sont absents ou différents. `documentDate` reste distinct de `eventDate` ; la seule différence entre les deux n’est pas une anomalie.

## Réutilisation SQL et autres données

L’agent consulte les données existantes avec SQL, les pièces et les résultats de tabular review, puis rattache les assertions aux sources. Un résultat d’IA ne remplace pas une pièce. Les relations du raisonnement sont projetées dans une table dédiée ; elles ne remplacent pas les liens documentaires existants.

Un fait peut porter une liaison scalaire surveillée :

```json
{
  "input": {
    "table": "piecemaker_nodes",
    "where": { "id": "entite_exemple_a" },
    "column": "data_json",
    "path": "$.montant"
  }
}
```

Tables permises : `piecemaker_nodes`, `piecemaker_links`, `piecemaker_citations`. `where` identifie exactement une ligne ; le serveur impose le dossier courant. `path` est facultatif. La valeur doit correspondre à celle de la proposition sourcée. Le serveur vérifie la liaison à l’ingestion puis à la lecture du raisonnement (interface ou prochain tour). Un changement ou une ambiguïté bloque la proposition et ses dépendances, crée une révision et actualise les résultats SQL. Il ne réécrit pas silencieusement le fait sourcé. Les autres données, notamment les tabular reviews conservées en fichiers, sont intégrées comme assertions sourcées par l’agent ; elles ne sont pas réinterrogées automatiquement par le moteur. Aucune requête SQL libre ne s’exécute depuis CITATIONS.

```sql
SELECT snapshot_json FROM pm_reasoning_programs WHERE project_id=dossier();
SELECT * FROM pm_reasoning_nodes WHERE project_id=dossier();
SELECT * FROM pm_reasoning_relations WHERE project_id=dossier();
SELECT * FROM pm_reasoning_links WHERE project_id=dossier();
SELECT * FROM pm_reasoning_theories WHERE project_id=dossier();
SELECT * FROM pm_reasoning_results WHERE project_id=dossier();
SELECT revision,snapshot_json FROM pm_reasoning_turns WHERE project_id=dossier();
```

`pm_reasoning_nodes` expose les couches, définitions et bornes temporelles. `pm_reasoning_relations` expose les extrémités, prédicat, contexte, unité, dates, valeur, état et sources. `pm_reasoning_links` expose les liens argumentatifs. `pm_reasoning_theories` expose les points d’entrée, faits requis, règles appliquées, tests et état de chaque programme de théorie. Les conflits sont dans `snapshot_json.conflicts`. Les écritures SQL directes qui nomment les tables gérées sont refusées par l’outil SQL ; toutes les modifications passent par CITATIONS. Le masquage SQL existant s’applique.

## Lecture du résultat

Le volet démarre sur **Théories** : chaque conclusion est le point d’entrée d’un programme, avec ses faits d’entrée, les règles datées appliquées, son résultat et ses tests. Les statuts distinguent programme incomplet, non testé, tests en échec et tests du modèle réussis. Les attentes des tests doivent porter une justification (`rationale`) ; leur absence maintient la théorie incomplète. Une conclusion attendue indéterminée peut avoir des tests réussis sans devenir un fait établi. La répartition des couches, les inconnues, blocages et conflits restent visibles sous les programmes. Le graphe propose des filtres par couche et par conclusion. Les relations contradictoires sont pointillées et colorées. Les sources sans lien sont masquées lorsqu’un raisonnement existe ; une collecte seule reste explicitement identifiée. Le détail montre les dates, le contexte relationnel, les hypothèses et les raisons du blocage. Une source réparée conserve aussi l’extrait initial proposé. Les simulations sont signalées dans le détail et dans le chat.

**Scénarios** compare les variantes ; **Tests** expose les attentes et résultats ; **Programme** expose la représentation compilée. Les tests proposés par l’IA évaluent son modèle et ne certifient pas le droit ni les faits. L’exemple fictif n’est pas enregistré dans le dossier. Il comporte une règle datée, un paiement contesté, un programme de théorie et sept tests, dont les variantes contradictoires et une application à la borne d’expiration.

## Limites et fichiers

200 propositions, 1000 sources, 1000 liens, 16 scénarios, 200 tests ; profondeur d’expression 20. Le graphe utilise un placement par forces jusqu’à 300 nœuds. La compilation attend la fin d’un tour complet ; une réponse interrompue n’est pas ingérée, l’historique ne rejoue pas les écritures. L’identité du tour est distincte du contenu pour permettre une révision identique à une ancienne version.

- `shared/piecemaker-reasoning.ts` : contrat partagé.
- `server/modules/piecemaker-reasoning/` : compilation, validations, interpréteur, conflits, entrées SQL et persistance.
- `server/piecemaker/harness/citation-{instructions,turn,store}.ts` : instructions, capture des sources et branchement en fin de tour.
- `server/modules/piecemaker-reasoning/{evidence,library,draft}.ts` : exigences de preuve, bibliothèque, contrôle de rédaction.
- `server/modules/piecemaker-reasoning/tests/banc-essai.test.ts` : banc d’essai fictif à défauts injectés (promesse prise pour un paiement, pièce absente puis ajoutée, décision de l’avocat, durées, prescription, conflit d’exceptions, rédaction).
- `plugins/piecemaker-raisonnement/` : volet droit.
