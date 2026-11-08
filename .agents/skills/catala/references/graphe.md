# Écrire pour le graphe Catala

1. Formulez la question juridique avant de coder sa réponse.
2. Décomposez la réponse en qualifications, conditions et exceptions nommées. Gardez les liens dans les expressions Catala.
3. Séparez les données observées des qualifications. Une entrée `vrai` ou `faux` décrit seulement un scénario.
4. Rattachez chaque règle à son texte et chaque donnée à sa pièce, avec une citation exacte.
5. Si un fait reste inconnu ou contesté, conservez cet état. Utilisez une énumération Catala quand le calcul doit traiter cet état.
6. Si le programme attend un booléen, testez les deux hypothèses. Ne remplacez jamais un fait inconnu par `faux`.
7. Écrivez un scénario `#[test]` pour chaque branche utile : conditions remplies, condition absente, exception applicable, hypothèse différente.
8. Ajoutez des assertions aux résultats attendus. Un test réussi peut confirmer une conclusion négative.
9. Lancez `pm catala verifier`. Le volet propose les scénarios du rapport Clerk et leurs graphes Catala.
10. Consultez la couverture Clerk dans le détail des nœuds. Un passage exercé ne prouve pas que toutes ses branches sont testées.
11. Pour examiner une autre exécution sans entrée, lancez `pm catala expliquer --fichier F --scope S`.
12. Contrôlez la hiérarchie avec `pm catala exceptions`. Contrôlez les conflits avec `pm catala preuve`.

Pour expliquer un nœud, ajoutez une section Markdown dans le fichier Catala. Les champs suivants restent du texte pour Catala :

```markdown
## Réception de la demande

Concerne : demande_reçue
Question : La demande a-t-elle été reçue ?
Justification : La réception doit être distinguée de l’envoi.
À rechercher : Obtenir un justificatif de réception.
Démarche : 2026-11-08 | demande de pièce | vérifier la réception | réponse attendue

[Pièce 1, envoi](../../../pieces/envoi-fictif.md)
Citation : « Extrait fictif établissant seulement l’envoi. »
```

`Concerne` rattache les sources et ces explications à un identifiant. Employez des identifiants distincts pour des notions distinctes dans un programme.

`Question` nomme le nœud. `Justification` explique la qualification. `À rechercher` crée un point ouvert relié au nœud.

Répétez `Démarche` pour conserver les démarches effectuées et leurs résultats. N’inventez aucune démarche ni aucun résultat. Actualisez `À rechercher` lorsque la collecte progresse.

Dans un fichier de test, ces notes concernent seulement les exécutions qui utilisent ce fichier. Placez les explications communes dans le module métier.

Le graphe signale les données sans pièce, les états inconnus ou contestés, les fondements absents et les citations non validées. Il ne décide pas de la valeur probante des pièces ni de la justesse juridique.
