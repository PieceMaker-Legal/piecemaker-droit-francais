# Ce que les cinq projets ajoutent au modèle PieceMaker

Comparaison du 25 octobre 2026. Cinq subagents Luna distincts (`gpt-6-luna`, effort `high`), un par projet : Doubt, SARA, Argdown, Arguebuf et MAP-Law. L'agent principal a relu les notes, contrôlé le code PieceMaker et fait corriger les écarts non établis. La demande porte sur une mémoire synthétique du raisonnement du LLM, enrichie avec le dossier et exigeant des justifications, sans remplacer ce raisonnement par un autre moteur.

La référence PieceMaker est `90ec4073c2bfb978cc85d8620b16e5e2c3178ac5`, dernier commit identifié du moteur et de l'acte, sur `feat/raisonnement-redaction`. La recherche est écrite sur `MAJ-continue`, qui ne contient pas cette fonctionnalité ; les fichiers ont été lus avec `git show`, sans fusion ni changement de branche. La confrontation de deux modèles décrite à `c96a6c356` reste une exploration. Aucun logiciel étudié n'a été installé ou exécuté, et aucun code applicatif n'a été modifié.

## Les écarts à retenir

| Projet et niveau de preuve | Ce qu'il apporte en plus dans le périmètre comparé | Limite pour le besoin exprimé |
| --- | --- | --- |
| **Doubt — code lu.** [Note Luna](01-doubt.md), [validateur](https://github.com/alsoleg89/doubt/blob/4bd97b12c6f0cac3d45ff69bf41bfa3189465c8e/src/contract.js) | Une explication textuelle obligatoire sur chaque lien ; des relations explicites de soutien, contradiction, nuance et manque ; un export HTML autonome de la carte et de ses sources. | La présence d'une note ne garantit pas sa pertinence. La carte cible une position unique ; ce contrat ne se transpose pas tel quel aux objectifs multiples de PieceMaker. |
| **SARA — publications, code public correspondant non retrouvé.** [Note Luna](02-sara.md), [article AAAI](https://ojs.aaai.org/index.php/AAAI/article/download/41425/45386) | Des objets distincts de prétention et de demande attribués aux parties, reliés aux preuves et à leur traitement dans la décision ; une vérification de couverture partant de cet inventaire du dossier. | PieceMaker connaît déjà personnes, pièces, objectifs et preuves. Le delta est leur relation explicite et le contrôle de ce qui a été laissé hors du raisonnement déclaré. L'implémentation des contrôles SARA n'est pas auditable ici. |
| **Argdown — modèle, documentation et outils publics.** [Note Luna](03-argdown.md), [syntaxe](https://argdown.org/syntax/) | Une proposition peut avoir plusieurs arguments identifiés séparément ; chaque étape d'inférence peut être détaillée, documentée et contestée ; une même analyse peut se présenter comme carte synthétique ou comme reconstruction détaillée. | Les conditions et sous-raisonnements existent déjà dans PieceMaker. Le delta est de faire de l'argument et de l'inférence des objets distincts de la proposition. Argdown n'impose pas une justification sourcée de chaque élément. |
| **Arguebuf — format et bibliothèques publics.** [Note Luna](04-arguebuf.md), [bibliothèque Python](https://github.com/recap-utr/arguebuf-python) | Une représentation portable des propositions et des inférences, avec création/manipulation de graphes et import/export de formats d'argumentation. | L'avantage propre est surtout l'interopérabilité. Le fichier JS actuel est déjà une représentation structurée persistante. Sérialiser en Protobuf n'ajoute pas un historique ni une obligation de justifier. |
| **MAP-Law — article et pilote, code public correspondant non retrouvé.** [Note Luna](05-map-law.md), [article v2](https://arxiv.org/html/2605.01486v2) | Une représentation explicite des buts et actions de recherche reliés aux éléments à compléter ; un contrôleur choisit la prochaine collecte et l'arrêt selon couverture et gain marginal. | PieceMaker signale déjà les manques et les faits décisifs. Le delta est de conserver et piloter ce qui a été recherché, pourquoi et avec quel résultat. Le pilote utilise des éléments prédéfinis et une couverture largement lexicale ; il ne valide pas la justesse juridique. |

Doubt possède aussi un reçu technique lié à l'état de la carte et des empreintes du contenu/extrait relu. C'est un écart **partiel** : le harnais PieceMaker conserve déjà des instantanés hashés et journalise les vérifications (`citation-store.ts`, `save`, `recordVerification`). Le reçu n'est pas une certification indépendante de la source ou de son interprétation.

Les formats de graphes d'Argdown et d'Arguebuf facilitent des échanges avec d'autres outils, tandis que PieceMaker imprime déjà l'acte DOCX et offre un graphe dans l'application. Ce sont des écarts de partage et d'outillage, pas l'absence de document ou de visualisation dans PieceMaker.

## Ce qui ne doit plus être présenté comme un apport nouveau

PieceMaker impose déjà un format déclaratif contrôlé, des références exactes aux sources et aux pièces, des contrôles de vigueur et d'applicabilité, des inconnues et contradictions, des hypothèses, des erreurs/manques localisés et une boucle d'enrichissement par le LLM. Le graphe, les objectifs, les obstacles, le lien avec la rédaction et la reprise des retouches Word existent également. Les cinq projets ne justifient pas de reconstruire ce socle.

La distinction utile est celle-ci : une citation répond à « où est le passage ? » ; une justification de relation répond à « pourquoi ce passage établit-il ou fragilise-t-il cette proposition ? ». L'applicabilité et les autres sous-raisonnements de PieceMaker apportent déjà des justifications structurées sur certains points. Ce qui manque dans le format lu est une explication explicite attachée à **chaque lien**, et non toute forme de justification.

## Croissance dans le temps : correction importante

Le fichier de raisonnement est persistant et le serveur conserve son état courant. Mais `pm_reasoning_programs` a une clé primaire `project_id` : `createReasoningService.verify` incrémente `revision` puis remplace la ligne par UPSERT. Ce compteur n'est pas un journal de toutes les versions.

L'historique Git du dossier existe, mais `server/piecemaker/folder-history/exclude.ts` exclut `.piecemaker/`, où se trouve `raisonnement.js`. Il ne faut donc pas déduire de cet historique une archive complète du raisonnement. Les mécanismes DOCX peuvent conserver des modèles ou bases de fusion selon le flux utilisé ; ils ne démontrent pas une conservation de chaque révision du fichier. Les réponses antérieures qui associaient sans réserve le raisonnement à l'historique Git étaient trop larges.

**Aucun des cinq projets n'a démontré, dans cette étude, tout le cycle d'une mémoire de dossier qui grandit pendant des mois, conserve les décisions et réouvre automatiquement les justifications affectées par chaque changement.** Doubt, Argdown et Arguebuf offrent des artefacts éditables ; SARA décrit un graphe d'affaire ; MAP-Law étudie une collecte sur plusieurs tours. Ce sont des briques, pas cette garantie complète.

## Ordre proposé pour des travaux ultérieurs

1. Examiner une justification explicite des relations, inspirée de Doubt, sans dupliquer les sources et contrôles existants.
2. Examiner une représentation distincte des arguments et étapes d'inférence, inspirée d'Argdown/Arguebuf, seulement là où une proposition peut recevoir plusieurs justifications ou objections.
3. Examiner l'inventaire des prétentions/demandes par partie et leur couverture, décrit par SARA.
4. Définir la conservation des révisions et de leurs motifs comme un besoin propre de PieceMaker ; ne pas l'attribuer à tort aux projets étudiés.
5. Envisager le journal de collecte MAP-Law, puis les exports, si ces besoins se confirment.

Ces propositions ne constituent ni une décision de migration de format ni une implémentation. Garder le JS déclaratif reste compatible avec les apports identifiés.
