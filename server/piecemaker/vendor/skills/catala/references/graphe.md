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
10. Consultez la couverture Clerk dans la vue Raisonnement. Un passage exercé ne prouve pas que toutes ses branches sont testées.
11. Pour examiner une autre exécution sans entrée, lancez `pm catala expliquer --fichier F --scope S`.
12. Si la preuve signale un conflit, contrôlez la hiérarchie avec `pm catala exceptions`.

## Annotation obligatoire et citation

Chaque définition ou règle doit porter son propre `#[doc]`. Chaque `#[doc]` doit contenir une balise `quote` non vide et un `titre`.
Le vérificateur produit une erreur localisée pour chacun de ces manques. Cette obligation couvre aussi les définitions des scénarios.

````catala
champ d'application Exemple:
  #[doc="titre: Vérifier la condition juridique\nsource: https://example.org/texte-fictif\nquote: « La condition requise est définie par ce texte fictif. »"]
  définition condition_juridique égal à donnée_observée
````

`#[doc]` appartient à Catala. Le contenu `titre: …`, `source: …` et `quote: « … »` suit la convention PieceMaker. Rédigez `titre` selon « Style des titres » de `SKILL.md`.
Écrivez le lien après `source:` sans crochets Markdown dans l’attribut : le formateur du pack refuse certains liens avec crochets.
Pour un fondement réel, indiquez le lien officiel et le passage exact. Pour un fait, indiquez le lien de la pièce et son passage exact.
Les liens fictifs de l’exemple ne constituent pas des références vérifiées.

La même annotation alimente le contrôle des citations et le graphe. Le graphe la rattache à la définition par sa position native.
Une annotation ne doit pas déborder sur la définition suivante. Les sources voisines et `Concerne` restent des solutions de compatibilité.
Une inclusion PDF native peut compléter le document ; elle ne remplace pas la source et `quote` dans `#[doc]`.

Placez chaque définition sous le texte ou la décision qui la fonde. Un même champ peut être défini par plusieurs blocs, répartis sous les différentes sources. Gardez les étiquettes et exceptions dans Catala.

Dans un scénario, définissez les faits comme des données intermédiaires sous les sections de leurs pièces, puis passez ces données au champ métier. La trace conserve ainsi leur origine. Une déclaration de champ donne seulement son contexte ; elle ne prouve pas l’origine factuelle de sa valeur.

Le graphe est un arbre lu de gauche à droite : la conclusion, ses conditions, leurs propres conditions, puis les faits et leurs pièces.
La couleur donne l’état de chaque case : vert pour validé, orange pour à établir ou à justifier, rouge pour non rempli.

Chaque carte réunit une condition ou une exception, son fondement juridique, le fait invoqué et sa pièce. Chaque définition garde son `#[doc]`. Le graphe affiche la source d’une condition seulement si elle diffère de celle de la règle. Le graphe signale une règle sans source et un fait sans pièce. Le résultat du scénario reste séparé. Les positions, définitions alternatives et traces natives restent dans la vue Raisonnement. Réservez `Concerne` aux liens transversaux que cette structure ne fournit pas.

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

L’objectif et la conclusion finale sont la même case du graphe. Écrivez une fois, hors section `Concerne`, l’objectif annoncé par l’avocat : `Objectif : Obtenir le paiement de l’indemnité`. Cette ligne titre la conclusion finale. N’en inventez pas : sans objectif annoncé, la conclusion garde son titre.

Quand un message contient `[Carte « titre »](chemin:12 "lignes 12 à 15")`, l’avocat vise cette case du graphe. Le lien donne le fichier Catala, relatif au dossier, et les lignes de la définition avec son `#[doc]`.

1. Lisez seulement ces lignes du fichier.
2. Lisez le reste du fichier seulement si la question porte sur d’autres règles.
3. Si le lien ne donne aucun fichier, retrouvez la définition par le `titre` de son `#[doc]`, ou par la ligne `Objectif`.

`Question` formule la question juridique ; elle sert de titre seulement si le `#[doc]` n’en donne pas. `Justification` explique la qualification. `À rechercher` crée un point ouvert relié au nœud.

Répétez `Démarche` pour conserver les démarches effectuées et leurs résultats. N’inventez aucune démarche ni aucun résultat. Actualisez `À rechercher` lorsque la collecte progresse.

Dans un fichier de test, ces notes concernent seulement les exécutions qui utilisent ce fichier. Placez les explications communes dans le module métier.

Le graphe signale les données sans pièce, les états inconnus ou contestés, les fondements absents et les citations non validées. Il ne décide pas de la valeur probante des pièces ni de la justesse juridique.
