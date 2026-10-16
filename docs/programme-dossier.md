# Programme exécutable du dossier

Le plugin **Raisonnement** ouvre un graphe dans le volet droit, à côté du chat. Le programme est proposé par le modèle dans `CITATIONS` en fin de tour, après les citations ordinaires. Le serveur ancre les extraits, applique la proposition puis calcule le dossier de base, les scénarios et les tests. Le tour suivant reçoit son état dans les instructions ; le SQL permet de récupérer les définitions et tous les résultats.

## Essayer en développement

Ouvrir `http://localhost:5173`, sélectionner un dossier puis l'onglet **Raisonnement** (éventuellement dans « Autres onglets »). L'hôte le place à droite. **Exemple fictif** charge un exemple calculé par le serveur, sans l'enregistrer dans le dossier. **Revenir au dossier** retrouve le programme réel.

Dans l'exemple, une facture fictive de 12 000 € et un versement contesté de 4 000 € produisent un solde indéterminé dans le dossier de base, 8 000 € sous l'hypothèse du versement et 12 000 € sous l'hypothèse d'aucun versement. Les valeurs du programme sont des centimes. L'onglet Scénarios compare ces résultats ; Tests affiche trois attentes explicites.

Le graphe permet sélection, déplacement des nœuds, déplacement du fond, zoom et centrage. Les flèches vont de la source ou prémisse vers ce qui en dépend. Une sélection ouvre la définition, les dépendances effectivement utilisées, les inconnues, les hypothèses et les extraits. Une citation ouvre la visionneuse existante. Les onglets Scénarios, Tests et Programme montrent les vues calculées et le JSON exécutable.

Pour essayer sur un dossier par le chat :

> Formalise une question précise de ce dossier en programme exécutable. Lis les pièces utiles, cite leurs passages, représente séparément les assertions contestées et les inconnues, propose deux scénarios et des tests. Ajoute l'objet program au bloc CITATIONS en fin de réponse. Ne prétends pas avoir déjà exécuté ce que tu proposes.

Puis au tour suivant :

> Récupère le programme et ses résultats par SQL. Compare les scénarios, indique l'inconnue qui empêche de conclure et la prochaine pièce utile à rechercher. Révise le programme si nécessaire.

## Contrat version 1

Le tableau `CITATIONS` habituel est conservé. Il accepte en plus un seul objet `kind:program`. Le vérifieur historique continue à traiter les citations ordinaires ; le programme est extrait séparément du même bloc complet. Aucune compilation pendant les deltas, ni en cas d'abandon. Le rechargement de l'historique n'ingère pas une nouvelle fois le programme.

Exemple entièrement fictif :

```json
[
  {
    "ref": 1,
    "kind": "document",
    "doc_id": "pieces/exemple.md",
    "quotes": [{"page": 1, "quote": "Le montant facturé est de 12 000 euros."}]
  },
  {
    "kind": "program",
    "version": 1,
    "nodes": [
      {"id": "F_montant", "kind": "fact", "label": "Montant facturé en centimes", "value": 1200000, "citations": [1]},
      {"id": "F_versement", "kind": "fact", "label": "Versement à déterminer en centimes", "state": "unknown"},
      {"id": "C_solde", "kind": "calculation", "label": "Solde documentaire en centimes", "expression": {"op": "subtract", "args": [{"ref": "F_montant"}, {"ref": "F_versement"}]}}
    ],
    "scenarios": [
      {"id": "S_versement", "label": "Hypothèse : versement de 4 000 euros", "assumptions": {"F_versement": 400000}}
    ],
    "tests": [
      {"id": "T_solde", "label": "Solde sous cette hypothèse", "target": "C_solde", "scenario": "S_versement", "expected": {"status": "known", "value": 800000}}
    ]
  }
]
```

Les identifiants commencent par une lettre, suivie de lettres ASCII, chiffres, `_` ou `-`, jusqu'à 80 caractères. Ils restent stables entre tours et ne contiennent pas de noms réels. Les nœuds, scénarios et tests se fusionnent par identifiant. Un nœud réémis remplace sa définition complète. `remove:["id"]` retire explicitement un nœud, scénario ou test ; il faut retirer ou adapter les tests et hypothèses qui visent un nœud supprimé.

Pour un nœud, `citations:[1,2]` désigne les références du **tour courant**, jamais des références d'un ancien message. Le serveur transforme ces numéros en identifiants de sources persistants. Réémettre un nœud sans `citations` conserve ses anciennes sources. Les champs de vérification et les identifiants de sources ne sont pas acceptés de l'IA : ils proviennent du harnais.

| Objet | Sémantique |
| --- | --- |
| `fact` avec `state:asserted` (défaut) | Assertion extraite et proposée, pas fait judiciairement établi. Une valeur renseignée exige une source vérifiée. |
| `fact` avec `state:disputed` ou `unknown` | Valeur indéterminée dans le dossier de base, même si une valeur candidate est enregistrée. |
| `rule`, `calculation`, `conclusion` | Expression calculable, éventuellement rattachée à des citations et accompagnée d'un `rationale`. Les choix d'interprétation restent ceux du modèle proposé. |
| `scenario` | Surcharge explicite de faits existants uniquement. Toutes les déductions qui utilisent ces surcharges portent leurs hypothèses. Aucun changement au dossier de base. |
| `test` | Comparaison d'un résultat à une attente explicite dans un scénario donné, ou `base` par défaut. Les attentes de l'IA ne sont pas un oracle juridique indépendant. |

Une expression est un scalaire JSON, `{"ref":"id"}`, ou `{"op":"…","args":[…]}`. `null` signifie inconnu. Les opérateurs acceptés sont `and`, `or`, `not`, `equal`, `greater`, `atLeast`, `less`, `atMost`, `add`, `subtract`, `multiply`, `divide`, `if`. Les opérations booléennes exigent des booléens ; les opérations arithmétiques et comparaisons ordonnées exigent des nombres. `equal` compare strictement les valeurs. `if` n'évalue que la branche sélectionnée lorsque la condition est connue. Une référence absente demeure inconnue ; les cycles et divisions par zéro produisent des erreurs explicites.

Les résultats ont quatre états :

- `known` : résultat calculé sous les assertions du modèle et les hypothèses indiquées ; ce statut n'établit pas la vérité de ses prémisses ;
- `unknown` : prémisse indéterminée ou absente, conservée dans `missing` ;
- `blocked` : source absente, non vérifiée, recalée ou remplacée, ou fait renseigné sans source ;
- `error` : cycle, opération invalide, mauvais type ou résultat numérique non représentable.

Une source recalée mécaniquement n'est pas suffisante pour réutiliser son interprétation. Le nœud reste à réexaminer, même si un autre tour cite exactement le passage. Il faut réémettre sa définition avec une référence exacte du nouveau tour.

Lorsqu'un nouveau tour cite le même document avec un contenu différent, ses anciens extraits sont marqués comme remplacés. Les nœuds qui en dépendent sont recalculés et le changement de résultat est conservé. La version du contenu est son empreinte ; un changement sur disque sans nouvelle lecture citée n'est pas détecté par ce mécanisme. Il ne s'agit pas d'une surveillance continue de tous les originaux.

## SQL et retour au modèle

Les tables utilisent `project_id` et la fonction `dossier()` existante :

```sql
SELECT snapshot_json FROM pm_reasoning_programs WHERE project_id=dossier();
SELECT scenario,node_id,status,value_json,missing_json,assumptions_json
FROM pm_reasoning_results WHERE project_id=dossier();
SELECT revision,snapshot_json FROM pm_reasoning_turns
WHERE project_id=dossier() ORDER BY revision DESC;
```

`pm_reasoning_programs` conserve le snapshot courant ; `pm_reasoning_results` les résultats de chaque nœud dans chaque scénario ; `pm_reasoning_turns` les versions appliquées, avec une identité idempotente propre à chaque tour réel. Les écritures SQL directes qui nomment ces tables sont refusées par l'outil SQL. Les modifications passent par `CITATIONS`. Le masquage SQL existant s'applique aux résultats.

Les instructions du tour suivant incluent le snapshot tant qu'il tient dans 48 000 caractères. Au-delà, elles incluent la révision, les changements et les requêtes pour récupérer l'état complet par SQL. L'écho utilisateur ne contient pas ces instructions. Les commandes slash conservent le comportement existant : elles ne reçoivent pas cette injection de chat supplémentaire.

Un bloc invalide conserve le programme précédent et publie le diagnostic au chat, dans le graphe et au tour suivant. Les écritures du programme et des résultats sont transactionnelles. Le graphe relit le snapshot toutes les 2,5 secondes. L'exemple fictif n'écrit aucune table du dossier.

## Périmètre et limites

Le moteur est un interpréteur déclaratif natif TypeScript. Catala et Blawx ne sont pas intégrés dans cette première version. Il n'exécute aucun code arbitraire et n'introduit aucune règle de droit préchargée. Il ne produit pas automatiquement un acte Word ni un jugement sur la valeur probante : le modèle peut représenter ces questions et leurs dépendances, mais le moteur ne valide pas leur interprétation.

Les calculs utilisent les nombres JavaScript. Les montants doivent être représentés en centimes entiers ; aucun arrondi monétaire n'est implicite. Les divisions peuvent produire des nombres décimaux. Ce moteur n'est pas un calculateur financier certifié ni un calculateur de délais procéduraux. Le premier contrat couvre des propositions scalaires et des dépendances explicites ; il n'exécute ni règles avec variables quantifiées, ni recherche exhaustive de qualifications juridiques.

Limites déclarées : 200 nœuds, 1 000 extraits, 16 scénarios, 200 tests, profondeur d'expression 20. Les scénarios concurrents sont ceux définis dans le programme ; le moteur n'invente pas toutes les variantes possibles. Les liens du graphe représentent les sources et dépendances du modèle proposé, sans prétendre démontrer sa complétude ou la vérité juridique.

## Fichiers et vérifications

- `shared/piecemaker-reasoning.ts` : contrat partagé ;
- `server/modules/piecemaker-reasoning/` : validation, interpréteur, persistance et routes ;
- `server/piecemaker/harness/{citation-turn,chat-harness,citation-instructions}.ts` : ingestion après vérification et retour au tour suivant ;
- `server/piecemaker/knowledge/sql-tool.ts` et outil MCP SQL : lecture des résultats et description du schéma ;
- `plugins/piecemaker-raisonnement/` : graphe et explorateur dans le volet droit.

Les tests ciblent notamment inconnues, scénarios, erreurs de calcul, sources remplacées ou recalées, idempotence, conservation du programme après rejet, compilation en fin de tour, absence d'ingestion d'un tour interrompu ou de l'historique et récupération par le véritable outil SQL. Le plugin suit la chaîne commune décrite dans [plugins.md](plugins.md).
