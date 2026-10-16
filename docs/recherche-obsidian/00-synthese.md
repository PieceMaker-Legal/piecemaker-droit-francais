# Du dossier documentaire au raisonnement contrôlable

Recherche du 16 octobre 2026. Cinq rapports réalisés par cinq agents Luna distincts, puis synthèse transversale. Le cinquième rapport traite ensemble Tasks et Dataview, qui occupaient une même ligne dans la sélection initiale. « Brawx » est interprété comme Blawx. Aucun logiciel étudié n'a été installé ou exécuté : les constats reposent sur les sources publiques et une lecture statique du code. Les fonctionnalités proposées ci-dessous ne sont pas des fonctionnalités réalisées dans PieceMaker.

## La question à résoudre

Permettre à l'avocat de savoir, pour chaque conclusion importante : sur quoi elle repose, ce que ses sources établissent réellement, quelles règles et interprétations ont été retenues, quelles objections peuvent la faire tomber, et quels contrôles ont effectivement été effectués.

La donnée disponible et la citation exacte sont des conditions nécessaires. Elles ne suffisent pas à justifier le passage de la source à la conclusion. On peut citer exactement un témoin qui rapporte une rumeur, un courrier qui promet un paiement sans établir sa réalisation, ou une décision dont la solution ne couvre pas la question posée. Ces exemples sont fictifs et ne renvoient à aucun dossier.

L'exigence de qualité absolue se traduit en obligations de contrôle : aucune hypothèse décisive ne doit être présentée comme acquise ; chaque conclusion doit préciser son périmètre ; une absence d'information doit rester visible ; un changement doit rouvrir les conclusions affectées. On peut garantir une intégrité de version, un contrôle textuel ou le résultat d'un calcul défini. La vérité d'un récit, l'exhaustivité de toutes les sources pertinentes et l'appréciation judiciaire future ne deviennent pas garanties par un moteur.

La valeur d'une donnée dépend de ce qu'on cherche à établir. Il faut conserver séparément la fidélité de l'extraction, l'origine et l'intégrité de la source, l'identité de celui qui affirme, la portée exacte du passage, son contexte, ses corroborations indépendantes, ses contestations et la décision motivée de l'avocat sur son utilisation. Une note unique de confiance ferait disparaître ces différences.

## Ce que les projets apportent

| Projet et rapport | Apport constaté dans les sources | Limite déterminante |
| --- | --- | --- |
| [Counsel OS](01-counsel-os.md) | Sources versionnées, lectures et citations localisées, couverture technique et lacunes explicites | Ne démontre pas la vérité des faits ou la validité de toute inférence |
| [Case Forge / Family Court Strategist](02-family-court-strategist.md) | Registre canonique d'assertions, révisions, conflits et références contrôlées dans les exports | La validation enregistrée reste une décision déclarée ; matrices et étoiles ne sont pas des évaluations probatoires validées |
| [GroundLevel](03-groundlevel-obsidian.md) | Commandes dans l'éditeur et insertion rapide de références et gabarits | Les badges de risque et probabilités annoncées dérivent d'heuristiques lexicales, sans calibration juridique |
| [Judicex](04-judicex.md) | Contrat de réponse, états d'abstention et profils de revue des éléments d'un dossier | Lien vers une source et matching lexical ne prouvent pas l'implication ; le contrôleur numérique peut devenir silencieux après une erreur |
| [Tasks et Dataview](05-tasks-dataview.md) | Vues calculées sur des notes structurées et agrégation des actions | Une requête sans résultat ne prouve pas l'absence du fait dans le dossier ; une date de tâche n'est pas un délai juridiquement validé |

Obsidian apporte ici une forme de travail : notes lisibles, références stables, liens inverses et vues sur les mêmes données. Un graphe de documents montre surtout qui mentionne quoi. Pour la qualité du raisonnement, les liens utiles doivent avoir un sens explicite : telle source rapporte, soutient, contredit ou ne permet pas d'établir telle proposition ; telle proposition remplit telle condition d'une demande. L'absence de lien peut aussi signifier que la revue n'est pas terminée.

## Catala et Blawx : fonctions différentes, garanties conditionnelles

[Catala](https://github.com/CatalaLang/catala) permet d'encoder une spécification juridique avec conditions et exceptions et d'en exécuter le calcul. Sa documentation distingue la traduction du droit, qui requiert une expertise juridique, et l'exécution du programme. Ses [questions générales](https://book.catala-lang.org/en/4-1-general.html) expliquent que toutes les lois ne se prêtent pas utilement à cette formalisation et que la traduction automatique par LLM reste un problème de recherche. Les [conflits d'exceptions](https://book.catala-lang.org/en/2-2-conditionals-exceptions.html) peuvent être signalés au lieu d'être résolus silencieusement. La [certification documentée](https://github.com/CatalaLang/catala/blob/master/doc/formalization/README.md) porte sur une étape critique de compilation, avec ses limites ; ce n'est pas une certification générale des règles juridiques encodées ni des résultats d'un dossier.

[Blawx](https://github.com/Lexpedite/blawx) fournit un environnement de règles logiques, des explications et des scénarios hypothétiques fondés sur s(CASP). Il peut servir à explorer, dans un modèle donné, les conséquences de faits vrais, faux ou inconnus et les faits supplémentaires pertinents. Son README le présente comme un logiciel expérimental, pas comme un logiciel de production. Pour un dossier, l'intérêt proposé serait de rendre explicites les branches et hypothèses d'un raisonnement, plutôt que de masquer les inconnues dans une conclusion unique.

Un [retour expérimental public de PHACDataHub](https://github.com/PHACDataHub/privacy_rac_demo#experimental-results) montre un piège concret : l'agent a réintroduit une conclusion antérieure dans les faits d'une nouvelle question, obtenant une réponse incorrecte. Ce constat ancien documente un mode de défaillance de l'intégration LLM/moteur, pas une mesure des performances actuelles. Il impose une règle de conception : une conclusion dérivée ne peut pas devenir une nouvelle observation de la source. Une déduction peut dépendre d'autres déductions, mais le système doit conserver leur nature, leurs versions et leurs dépendances.

Le choix dépend donc du sous-problème : calculs bornés et formules pour Catala ; branches logiques, exceptions et exploration d'inconnues pour Blawx. Utiliser les deux sur chaque règle créerait deux modèles à maintenir et à réconcilier. Dans tous les cas, le résultat reste conditionnel à la justesse des entrées, à la fidélité du modèle et à son périmètre déclaré.

## Neuf pistes distinctes

### 1. Contrôler la fidélité du passage des originaux aux données

**Erreur visée :** une citation peut être exacte dans le Markdown tout en reproduisant une erreur d'OCR.

Conserver la correspondance avec la page de l'original, les pages manquantes, les tableaux tronqués et les champs à enjeu : montant, date, négation, identité de l'auteur. Les endroits déterminants non revus visuellement restent signalés. La consultation des originaux respecte le modèle de protection des pièces ; une vérification visuelle peut relever de l'avocat.

**Critère de succès :** une extraction volontairement altérée ne devient pas un fait utilisable sans avertissement. Ce contrôle porte sur la fidélité de la donnée, pas sur la sincérité de son auteur.

### 2. Tenir un registre des assertions et de leur évaluation probatoire

**Erreur visée :** transformer « la pièce affirme X » en « X est établi ».

Une assertion possède un identifiant stable, un auteur de l'affirmation, une source précise, un contexte, des appuis, des objections et une décision motivée d'utilisation par l'avocat. « Allégué par une partie », « directement constaté », « contesté », « hypothèse » et « retenu pour cette analyse » restent distincts. Plusieurs documents recopiant le même récit ne deviennent pas automatiquement plusieurs corroborations indépendantes.

**Critère de succès :** une promesse de paiement est enregistrée comme promesse ; la réalisation du paiement demeure une autre proposition à examiner. Les faits concurrents restent disponibles après validation d'un scénario.

### 3. Construire la matrice des conditions de chaque demande ou défense

**Erreur visée :** disposer de nombreuses pièces tout en oubliant une condition décisive.

Pour une question juridique circonscrite, un juriste valide les conditions à examiner, leurs alternatives, exceptions, questions de charge de preuve et sources applicables. La vue rapproche chaque condition des assertions pertinentes et montre les lacunes, les points contestés et le périmètre non traité. Un moteur peut exécuter les relations suffisamment formalisées ; le contenu de la grille ne doit pas être inventé au fil de la réponse.

**Critère de succès :** retirer un élément nécessaire d'un exemple de référence fait apparaître cette lacune. Un résultat vide est accompagné du périmètre réellement examiné.

### 4. Évaluer l'applicabilité de chaque autorité juridique

**Erreur visée :** une source authentique est citée exactement, mais utilisée hors de son domaine ou de sa portée.

À côté de l'extrait exact, conserver la version, les dates pertinentes, la question traitée, la place du passage dans la décision, les conditions de transposition au dossier et les raisons de retenir ou d'écarter cette autorité. L'IA propose le rapprochement ; les points d'interprétation décisifs sont explicitement revus. Une recherche peut enrichir ce registre, sans promettre l'exhaustivité jurisprudentielle.

**Critère de succès :** une référence exacte mais incompatible avec le scénario n'est pas présentée comme autorité applicable sur le seul fondement de son existence.

### 5. Produire des calculs et décisions circonscrits, rejouables

**Erreur visée :** l'IA applique approximativement un barème, une formule ou une chaîne d'exceptions.

Créer de petits modules validés, avec sources, version, périmètre, entrées typées, unités, arrondis et résultats attendus établis par un juriste. Le calcul conserve ses paramètres et la version du moteur. Catala est une piste pour des mécanismes calculatoires ; Blawx pour certaines conditions logiques. Une qualification laissée à l'appréciation humaine arrive comme entrée documentée ou comme hypothèse de scénario.

**Critère de succès :** mêmes entrées et même version produisent le même résultat ; les cas limites et exceptions du périmètre ont des résultats de référence validés. Ce caractère reproductible ne valide pas à lui seul le choix de la règle.

### 6. Soumettre la thèse à une épreuve de réfutation

**Erreur visée :** une conclusion n'est solide que parce que l'analyse a retenu les hypothèses favorables.

Examiner un scénario concurrent documenté : écarter une pièce contestée, changer un fait incertain, retenir une qualification alternative défendable. Montrer quelles conclusions résistent et lesquelles basculent. Dans les domaines formalisés, l'exploration peut identifier les inconnues susceptibles de modifier le résultat, et donc les questions ou pièces à rechercher en priorité. Dans les domaines ouverts, les objections de l'IA restent des propositions de revue, pas un inventaire complet.

**Critère de succès :** l'avocat voit l'hypothèse exacte dont dépend la conclusion, sans recevoir un pourcentage de succès non fondé. Cette piste éprouve une thèse ; la matrice précédente vérifie la couverture des conditions.

### 7. Encadrer la rédaction par des assertions autorisées

**Erreur visée :** une prose fluide ajoute un fait, une causalité, une qualification ou une certitude absents de l'analyse validée.

Les propositions importantes du livrable renvoient au registre, aux autorités et aux calculs. Un champ inconnu ne peut pas être rendu comme renseigné ; un statut contesté conserve sa réserve. Les données structurées permettent des contrôles mécaniques sur les montants, les dates, les identifiants et les dépendances. L'équivalence de sens d'une phrase libre avec ses sources demeure un point de revue ; un second LLM peut aider à repérer des écarts, sans certifier l'absence d'erreur.

**Critère de succès :** une assertion ajoutée sans support ou une réserve supprimée dans un exemple de référence est détectée ou explicitement soumise à validation. Les passages non encore validés restent identifiables.

### 8. Réouvrir les conclusions lorsque leurs dépendances changent

**Erreur visée :** une conclusion reste marquée comme utilisable après correction d'une pièce, d'un fait ou d'une règle.

Conserver un graphe de dépendances entre versions de sources, assertions, scénarios, calculs et paragraphes. Un changement rend les conclusions dépendantes « à réexaminer », montre le motif et préserve la version antérieure. Les conclusions nouvelles doivent être recalculées et, selon leur nature, revues ; une nouvelle pièce contradictoire ne doit pas être rejetée au seul motif qu'une assertion était déjà validée.

**Critère de succès :** modifier une entrée déterminante retire la validation courante des sorties touchées, et permet d'expliquer le changement entre deux versions.

### 9. Vérifier l'acte final dans sa forme effectivement remise

**Erreur visée :** l'analyse est correcte mais l'acte livré contient un montant divergent, une pièce mal numérotée, une note différente ou une demande oubliée.

Contrôler la correspondance entre le document final et les données approuvées : montants du corps et des demandes finales, références de pièces et bordereau, texte réel des notes et sources vérifiées, dates et désignations. Toute grille de contrôle procédural doit être adaptée et validée pour l'acte considéré. Le contrôle s'applique au fichier final après les retouches et l'export.

**Critère de succès :** une divergence injectée dans le livrable final est détectée. Ce contrôle cible les erreurs de livraison ; il ne remplace pas la validation du raisonnement.

## Ordre de travail et mesure de la qualité

Commencer par le registre d'assertions, la matrice des conditions et le lien avec la rédaction : ces éléments rendent visibles les sauts que les citations exactes ne contrôlent pas. Instrumenter dès l'entrée les lacunes d'extraction et de couverture. Ajouter ensuite un seul module de règles ou de calcul sur une question récurrente, suffisamment circonscrite pour que l'avocat puisse valider ses cas de référence et amortir le coût de maintenance.

La démonstration devrait comparer, sur des dossiers entièrement fictifs, le fonctionnement actuel et le prototype. Une revue juridique indépendante de la génération établit les défauts attendus : citation exacte mais hors sujet, récit rapporté pris pour observation, source primaire absente, répétitions dépendantes, condition manquante, mauvais jeu de règles, exception oubliée, hypothèse réinjectée et modification tardive du livrable. Mesurer les erreurs critiques non détectées, les faux blocages, le temps de revue et la capacité de rejouer une conclusion. Une couverture parfaite de ces exemples ne prouve pas une perfection générale ; elle permet de juger un gain réel sur des défauts définis.

L'indicateur produit utile serait une liste de vérifications accomplies et de réserves restantes, chacune avec son périmètre et son responsable. Un badge « vérifié » global ou une moyenne de confiance ne permettrait pas de comprendre ce qui reste fragile.

## Point d'ancrage dans PieceMaker

La [documentation du harnais](../harness-legal.md) décrit une vérification mécanique des extraits et des snapshots ; elle précise que le harnais annote la prose déjà diffusée. Elle mentionne aussi l'absence de contrôle garantissant que le texte d'une note Word égale l'extrait vérifié. La [documentation SQL](../outil-sql.md) décrit déjà les liens et citations des pièces. Ces capacités fournissent des points d'ancrage ; la représentation de l'évaluation probatoire, des conditions de raisonnement et des dépendances proposée ici demanderait un travail supplémentaire.

Ces deux documents internes ont été lus pour situer les propositions. Cette recherche n'est pas un audit du code actuel de PieceMaker et n'a modifié aucun comportement de l'application.
