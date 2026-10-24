# Docassemble : collecte à rebours et assemblage DOCX

## Résultat

Docassemble est un système libre d’entretiens guidés et d’assemblage de documents. Dans la révision [b821998ddd9442f80456ed1649f38afee0a3b877](https://github.com/jhpyle/docassemble/tree/b821998ddd9442f80456ed1649f38afee0a3b877), ses apports à PieceMaker sont la collecte à rebours des variables requises, l’invalidation des calculs après retouche et le rendu d’un modèle Word mis en page par le cabinet.

Ces fonctions ne constituent pas un raisonnement juridique vérifié. Docassemble est un moteur de flux et de génération : il exécute des blocs Python, recueille des réponses et insère des valeurs dans des modèles. Il ne vérifie pas qu’une règle est en vigueur, qu’une pièce prouve un fait, qu’une citation existe ou qu’un argument répond à une objection.

## Collecter les variables manquantes

Un entretien est un ensemble de blocs YAML définissant des variables, sans ordre nécessairement linéaire. Le programme exécute les blocs obligatoires ; si une variable manque, il cherche une question ou un bloc de code pour la définir, puis reprend le parcours. La documentation appelle cela « dependency satisfaction » et précise que les blocs peuvent repartir du début ([guide](https://docassemble.org/docs/logic.html), [source au commit étudié](https://github.com/jhpyle/docassemble/blob/b821998ddd9442f80456ed1649f38afee0a3b877/docassemble_base/docassemble/base/parse.py), `Interview.askfor`). `need` permet d’exiger des variables avant un bloc ; `mandatory` détermine les étapes de départ.

Dans PieceMaker, le vérificateur signale les éléments restant à établir ; l’agent complète l’objet, puis le moteur vérifie sa structure et ses dépendances. Dans docassemble, une variable absente déclenche la collecte. « Inconnue » signifie « aucune valeur définie dans l’entretien », ni statut juridique indéterminé, ni preuve manquante. Une réponse « non » est une valeur définie. Les branches Python expriment la logique de l’auteur du formulaire, pas une interprétation de la loi.

**Apport incrémental possible (inférence).** Pour une étape de collecte factuelle, une interface inspirée de docassemble pourrait présenter la prochaine question en fonction de ce qui est effectivement nécessaire pour un terme ou une valeur en suspens. Il faudrait toutefois garder les états PieceMaker (« non établi », « contredit », « fait prouvé », hypothèse) et les contrôles de citation comme autorité. Le mécanisme de questions ne déciderait ni de la qualification ni de la suffisance de la preuve.

## Dépendances et retouches

Docassemble propose `depends on`, `reconsider` et `on change`. `parse.py` croise variables lues et invalidations configurées, puis invalide récursivement les résultats en aval. `depends on` réagit à un changement de valeur, pas à la première définition ([guide](https://docassemble.org/docs/logic.html), [code](https://github.com/jhpyle/docassemble/blob/b821998ddd9442f80456ed1649f38afee0a3b877/docassemble_base/docassemble/base/parse.py), `Interview.cross_reference_dependencies` et `Interview.invalidate_dependencies`). `on change` traite les cas plus complexes, comme une liste dont la structure dépend d’une réponse.

Après retouche, docassemble invalide les calculs aval et les redemande ou recalcule au prochain parcours. PieceMaker recalcule déjà le raisonnement à la vérification ou simulation et lie le DOCX aux sections `acte`. Ce suivi par variables peut inspirer l’invalidation d’une vue après édition, mais ne remplace ni les identifiants de sections ni la fusion à trois voies. Les réponses sont enregistrées par session ; le bouton retour restaure un état antérieur ([stockage](https://docassemble.org/docs/external.html)).

## Rendu Word : riche, mais à sens unique

Le rendu DOCX s’appuie sur `python-docx-template`/Jinja2 : conditions et boucles dans les paragraphes, lignes de tableau répétées, texte riche ou inclusion d’un autre document. Word maîtrise la mise en page ; docassemble remplit les champs et fournit le DOCX ou PDF. `parse.py` rend `docx template file` ; l’exemple [`docx-jinja2-demo.yml`](https://github.com/jhpyle/docassemble/blob/b821998ddd9442f80456ed1649f38afee0a3b877/docassemble_base/docassemble/base/data/questions/examples/docx-jinja2-demo.yml) l’illustre. La documentation signale que concaténer plusieurs modèles peut faire perdre des fonctions ([guide](https://docassemble.org/docs/documents.html)).

Pour PieceMaker, c’est une référence pertinente pour composer des sections conditionnelles, tableaux et passages répétés tout en laissant Word gérer la présentation. La limite est le sens du flux : le modèle DOCX est une entrée de rendu, et le fichier produit est une sortie. Dans les sources examinées, je n’ai pas trouvé de mécanisme équivalent à l’acte canonique PieceMaker où la prose est stockée avec les termes qu’elle traite, contrôlée contre leurs citations, réimportée puis fusionnée paragraphe par paragraphe avec les retouches de l’avocat. C’est une comparaison des mécanismes documentés, pas l’affirmation que toute extension docassemble serait impossible.

## Maturité, licence et protocole proposé

À cette révision, le projet est publié sous licence MIT, maintenu depuis 2015 et comprend les paquets serveur et base, une très grande bibliothèque d’exemples ainsi que des tests de parcours et de génération ([dépôt](https://github.com/jhpyle/docassemble/tree/b821998ddd9442f80456ed1649f38afee0a3b877), [licence](https://github.com/jhpyle/docassemble/blob/b821998ddd9442f80456ed1649f38afee0a3b877/LICENSE.txt)). Le commit demandé, daté du 23 octobre 2026 UTC, met à jour la version 1.10.13 vers 1.10.14. Cela témoigne d’un produit vivant et étendu ; son domaine demeure l’automatisation d’entretiens et de documents, pas la vérification de raisonnements juridiques.

**Protocole proposé, fictif et non exécuté :** définir une demande d’acte pour « Personne A » et « Personne B », avec `condition_x`, une valeur dérivée `valeur_y` et un paragraphe DOCX conditionnel. Générer, modifier `condition_x`, puis inspecter si `valeur_y` est invalidée et si le paragraphe suit la nouvelle valeur. Comparer le DOCX à l’acte PieceMaker : styles conservés, mais pas de retour attendu vers `traite`, les citations ou la fusion sectionnée. L’essai porterait sur collecte, invalidation et mise en page, pas sur le droit, la preuve ou la qualification.

Sources code principales : [`parse.py` à la révision étudiée](https://github.com/jhpyle/docassemble/blob/b821998ddd9442f80456ed1649f38afee0a3b877/docassemble_base/docassemble/base/parse.py), [`docassemble` et sa documentation officielle](https://github.com/jhpyle/docassemble/tree/b821998ddd9442f80456ed1649f38afee0a3b877). Cette analyse est statique ; aucun code ni test n’a été exécuté.
