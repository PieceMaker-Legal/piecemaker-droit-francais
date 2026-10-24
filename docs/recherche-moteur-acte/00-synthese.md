# Projets utiles au moteur de raisonnement et à l'acte

Recherche du 24 octobre 2026 avec Luna. Neuf projets retenus, une analyse individuelle par projet, puis relecture et synthèse par l'agent principal. Les propositions ci-dessous sont des pistes d'expérimentation, pas des fonctionnalités réalisées. [Périmètre, commits PieceMaker lus et versions publiques contrôlées](10-perimetre-et-versions.md).

Le meilleur apport immédiat paraît être **Accord Project pour la structure de l'acte**, et **Arg2P ou Carneades pour expliciter la confrontation des arguments**. Catala et OpenFisca fournissent surtout des références de contrôle des calculs et de leur évolution. Cette priorité est une appréciation d'architecture fondée sur les sources et le modèle PieceMaker, pas un classement de performance mesurée.

## Sélection et apport propre

| Projet identifié | Ce qui mérite examen pour PieceMaker | Limite et priorité proposée | Analyse Luna |
| --- | --- | --- | --- |
| [Accord Project](https://github.com/accordproject/template-engine), avec Concerto et markdown-transform | Représentation documentaire structurée, variables typées et transformations de la prose | Prioritaire pour l'acte ; ni preuve juridique ni fusion Word équivalente à celle déjà présente | [01](01-accord-project.md) |
| [Blawx / s(CASP)](https://github.com/Lexpedite/blawx) | Recherche d'ensembles d'hypothèses compatibles et explication des modèles | À éprouver sur un sous-ensemble ; distinguer le vieux dépôt public du service actuel | [02](02-blawx.md) |
| [Carneades 4](https://github.com/carneades/carneades-4) | Propositions, arguments favorables/contraires, attaque d'une inférence, questions disputées | Prioritaire comme modèle de confrontation ; pondérations non calibrées et maintenance peu récente | [03](03-carneades.md) |
| [Catala](https://github.com/CatalaLang/catala) | Détection d'exceptions concurrentes, types de calcul et contrôles aux frontières | Inspiration ciblée ; conserver la sémantique actuelle de `si`/`sauf` | [04](04-catala.md) |
| [Arg2P](https://github.com/tuProlog/arg2p-kt) | Argumentation structurée ASPIC+, attaques et priorités explicites | Prioritaire pour un essai de confrontation, sans arbitrage juridique automatique | [05](05-arg2p.md) |
| [docassemble](https://github.com/jhpyle/docassemble) | Collecte des informations nécessaires, invalidation des dépendances et assemblage Word riche | Référence de collecte et de rendu ; ne remplace pas l'acte canonique ni la fusion des retouches | [06](06-docassemble.md) |
| [OpenFisca Core](https://github.com/openfisca/openfisca-core) | Calculs organisés par périodes, paramètres versionnés, variantes de règles et traçage | À approfondir pour des calculs récurrents ; spécialisé socio-fiscal | [07](07-openfisca.md) |
| [L4, dépôt actuel Legalese](https://github.com/legalese/l4-ide) | Distinction qualification/obligation, obligations dans le temps, plans de questions et explications | Référence de conception ; migration vers un nouveau langage coûteuse | [08](08-l4.md) |
| [Nomos](https://github.com/sboghossian/nomos) | Frontière entre extraction LLM et évaluation de règles typées et datées | Veille expérimentale ; lire le code plutôt que déduire des garanties de sa présentation | [09](09-nomos.md) |

## Ce que les commits récents changent dans la comparaison

PieceMaker calcule déjà ses conditions et exceptions, montre les faits décisifs, teste des hypothèses, contrôle les citations et l'applicabilité, calcule montants et délais, et relie les sections de l'acte au raisonnement. L'objet JS déclaratif est lu sans exécuter son code, puis interprété par le moteur. Un autre projet qui possède des règles, des scénarios ou un graphe ne justifie donc pas à lui seul une nouvelle dépendance.

Le commit `90ec4073c` va plus loin que le simple remplissage d'un gabarit : la prose de l'acte vit dans le raisonnement, et les retouches Word reviennent par fusion à trois voies. Ni Accord ni docassemble ne démontrent, dans les sources étudiées, un remplacement complet de ce cycle. Leur intérêt porte sur la structure du document, le typage des insertions et la richesse du rendu. La liaison `traite` assure une couverture déclarée et des contrôles de citations ; elle ne prouve pas que chaque phrase libre dit exactement ce que le modèle établit.

La confrontation décrite au commit `c96a6c356` reste exploratoire. Elle préserve deux modèles et rapproche les occurrences de sources, puis les propositions. Arg2P et Carneades apportent ici une distinction utile : attaquer un fait, contester une conclusion ou contester le passage des prémisses à cette conclusion sont des opérations différentes. Une source commune ne démontre toujours pas que les deux auteurs expriment la même proposition.

## Trois expériences circonscrites à envisager

1. **Projection contradictoire de deux raisonnements existants.** Conserver chaque objet intact et ses chemins ; aligner manuellement quelques propositions fictives ; représenter les soutiens et les différentes attaques. Comparer les concepts d'Arg2P et de Carneades avant de choisir une dépendance. Réussite : la vue distingue opposition sur un fait, opposition sur une règle et contestation d'une inférence ; elle ne fusionne pas des sources de versions différentes et garde les points indécis.
2. **Insertion typée dans l'acte.** S'inspirer d'Accord pour désigner explicitement les quelques valeurs calculées insérées dans une section, en gardant le texte libre et les identifiants actuels. Réussite : une retouche qui change un montant dans le DOCX signale la divergence avec la valeur calculée ; une modification de prose sans incidence ne devient pas un conflit artificiel. Cela demande un prototype, car le modèle actuel ne fournit pas cette garantie sémantique.
3. **Calcul daté avec cas de frontière.** Sur une règle entièrement fictive, s'inspirer de Catala et d'OpenFisca pour fixer types, période, version des paramètres, arrondis et résultats attendus. Réussite : seuil égal/inférieur/supérieur, changement de période et règles concurrentes ont un résultat explicite, rejouable, avec provenance. Le calcul ne choisit pas tout seul une interprétation juridique.

Blawx pourrait ensuite servir à comparer la recherche de modèles compatibles à la recherche actuelle des faits décisifs. docassemble et L4 peuvent inspirer l'ordre des questions utiles. Le gain à mesurer est une explication plus précise ou une collecte plus courte sur les mêmes exemples, et non la seule présence d'une interface différente.

## Portée de la recherche

La série repose sur recherche web et lecture statique des sources primaires. Aucun logiciel étudié n'a été installé ou exécuté ; les protocoles proposés ne sont pas des résultats de tests. Le code de l'application n'a pas été modifié. Les licences et dates de commits sont documentées pour situer la réutilisation, sans audit des dépendances. Les incertitudes restantes sont précisées dans chaque note. Aucun projet étudié ne dispense de vérifier les sources ni de faire valider l'interprétation décisive par l'avocat.
