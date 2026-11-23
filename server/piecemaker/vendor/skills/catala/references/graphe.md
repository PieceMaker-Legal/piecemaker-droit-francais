# Écrire pour le graphe Catala

1. Formulez la question juridique avant de coder sa réponse.
2. Décomposez la réponse en qualifications, conditions et exceptions nommées. Gardez les liens dans les expressions Catala.
3. Une entrée est un fait typé (date, montant, durée, texte d’une clause), jamais une question. La règle le qualifie.
4. Rattachez chaque règle à son texte, avec une citation exacte. Rattachez chaque fait à une ou plusieurs pièces, chacune avec sa citation exacte.
5. Établissez chaque fait par les pièces. Un fait que les pièces ne prouvent pas est écarté, faute de preuve, au détriment de la partie qui le supporte (art. 1353 C. civ.). Ne le laissez pas inconnu.
6. Une notion à apprécier (délai raisonnable, faute grave) est une définition argumentée, sourcée par le texte ou la jurisprudence, pas une entrée.
7. Écrivez un scénario `#[test]` du dossier, avec les faits établis. Ajoutez un scénario seulement quand un fait contesté change l’issue.
8. Ajoutez des assertions aux résultats attendus. Un test réussi peut confirmer une conclusion négative.
9. Lancez `pm catala verifier`. Le volet propose les scénarios du rapport Clerk et leurs graphes Catala.
10. Consultez la couverture Clerk dans la vue Raisonnement. Un passage exercé ne prouve pas que toutes ses branches sont testées.
11. Pour examiner une autre exécution sans entrée, lancez `pm catala expliquer --fichier F --scope S`.
12. Si la preuve signale un conflit, contrôlez la hiérarchie avec `pm catala exceptions`.

## Titre, source et citation

Suivez le modèle de `format.md`. Le titre `## texte court` au-dessus d'une définition ou d'une entrée nomme la case du graphe. Rédigez-le selon « Style des titres » de `SKILL.md`. Une règle tient sa source de sa position, sous le titre de son article.

Un fait est un `contexte` du champ (`format.md`, « Faits du dossier »). Dans le scénario du dossier, fixez les faits établis par les pièces : `règle calcul.mise_en_demeure rempli`, `définition calcul.prix égal à 12 000 €`.

Les liens fictifs de l’exemple ne constituent pas des références vérifiées. Gardez les étiquettes et exceptions dans Catala.

Juste au-dessus de la ligne qui fixe un fait, écrivez une ligne par pièce : `## [Contrat](../../../pieces/contrat.md) « Le prix est de 12 000 €. »`. Le graphe montre ces pièces sous le fait ; `pm catala verifier` contrôle l'extrait.

Le graphe est un arbre lu de gauche à droite : la prétention, avec sa conclusion dessous, ses conditions, leurs propres conditions, puis les faits et leurs pièces.
La couleur donne la valeur du scénario : vert pour rempli ou vrai, orange pour indéterminé, rouge pour non rempli. L’état de la preuve est une étiquette à part (« Pièce à rattacher », « Pièce citée »). La conclusion liste les réserves.

Chaque carte réunit une condition ou une exception, son fondement juridique, le fait invoqué et sa pièce. Chaque définition garde son titre `##`. Le graphe affiche la source d’une condition seulement si elle diffère de celle de la règle. Le graphe signale une règle sans source et un fait sans pièce. Le résultat du scénario reste séparé. Les positions, définitions alternatives et traces natives restent dans la vue Raisonnement.

Écrivez la justification d'un nœud en commentaire `#` au-dessus de sa définition. Pour suivre la collecte d'un fait, ajoutez une section Markdown dans le fichier Catala. Les champs suivants restent du texte pour Catala :

```markdown
## Réception de la demande

Concerne : demande_reçue
Question : La demande a-t-elle été reçue ?
À rechercher : Obtenir un justificatif de réception.
Démarche : 2026-11-08 | demande de pièce | vérifier la réception | réponse attendue
```

`Concerne` rattache ces notes à un identifiant ; il ne sert jamais à rattacher une source ou une citation. Employez des identifiants distincts pour des notions distinctes dans un programme.

L’objectif titre la prétention, la case de gauche du graphe. Écrivez une fois, hors section `Concerne`, l’objectif annoncé par l’avocat : `Objectif : Obtenir le paiement de l’indemnité`. N’en inventez pas : sans objectif annoncé, la prétention garde son titre. Quand `tache.json` décrit le raisonnement, son `objectif` remplace cette ligne.

Quand un message contient ``[Carte « titre »](chemin:12 "lignes 12 à 15") — `identifiant` = Vrai, scénario Test``, l’avocat vise cette case du graphe. Le lien donne le fichier Catala, relatif au dossier, et les lignes de la définition avec son titre `##`. La suite donne l’identifiant Catala, sa valeur dans le scénario affiché et le nom de ce scénario.

1. Lisez seulement ces lignes du fichier.
2. Si le contenu de ces lignes ne correspond pas, retrouvez la définition avec `grep -n` sur l’identifiant.
3. Lisez le reste du fichier seulement si la question porte sur d’autres règles.
4. Si le lien ne donne aucun fichier, retrouvez la définition par l’identifiant, par son titre `##`, ou par la ligne `Objectif`.

`Question` formule la question juridique ; elle sert de titre seulement si la définition n’a pas de titre `##`. `À rechercher` crée un point ouvert relié au nœud.

Répétez `Démarche` pour conserver les démarches effectuées et leurs résultats. N’inventez aucune démarche ni aucun résultat. Actualisez `À rechercher` lorsque la collecte progresse.

Dans un fichier de test, ces notes concernent seulement les exécutions qui utilisent ce fichier. Placez les explications communes dans le module métier.

Le graphe signale les données sans pièce, les fondements absents et les citations non validées. Il ne décide pas de la valeur probante des pièces ni de la justesse juridique.

## Contrat

Pour un contrat (`"type": "transactional"` dans `tache.json`), le graphe montre la stipulation, son effet, les conditions de la clause, les dérogations et les hypothèses du cas de figure. Suivez `format.md`, « Contrat ».
