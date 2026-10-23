# Mistral Vibe 3 : reprise des sessions et mode plan

## Version et rupture de compatibilité

Vibe 3.0.2, publié sur PyPI le 22 octobre 2026, remplace le pin applicatif 2.25.0. Les métadonnées officielles demandent Python >=3.12 et proposent des wheels macOS ARM64, macOS Intel et Windows x64. Le socle commun PieceMaker reste CPython 3.12.

Le moteur Unified est désormais embarqué et obligatoire. Les options `--experimental-harness` et `--legacy-harness` ont disparu. L’échec de reprise constaté avec 2.25.0 sur une session créée par 2.26 ne justifie donc pas de modifier les journaux : il faut utiliser le moteur actuel.

Les sessions legacy 2.x sont importées officiellement dans une nouvelle session Unified à la reprise, sans modifier la source. PieceMaker conserve l’identifiant retourné par le fournisseur. Cela ne promet pas la prise en charge des historiques 1.x abandonnés par Mistral.

## Planification

Mistral a retiré l’agent `plan` et `exit_plan_mode` depuis 3.0.0. PieceMaker conserve `/plan` et le choix Plan : ils sélectionnent `ask` avec une liste d’outils de lecture (`read_file`, `grep`, `skill`), comme l’agent officiel d’exploration. La consigne demande d’analyser, de proposer un plan et d’attendre le prochain message. Aucun ancien flag de moteur ni agent supprimé n’est envoyé.

Cette restriction vise les outils disponibles, en plus de la consigne. La planification ne doit pas être présentée comme une simple promesse du modèle. Les permissions administrées par Mistral peuvent restreindre davantage les outils.

## Historique

Les sessions Unified ne sont plus des couples `meta.json` / `messages.jsonl`. Le fournisseur PieceMaker utilise le serveur officiel `vibe-app-server`, voisin du binaire Vibe sélectionné : initialisation JSON-RPC, notification `initialized`, puis `session/history/list` avec pagination. Il n’envoie ni reprise, ni démarrage de tour, ni lecture de configuration et ne contacte pas le modèle pour consulter l’historique.

La lecture des anciens journaux reste disponible. À l’import, la projection officielle omet les anciens appels d’outils, alors que le contexte du modèle les conserve. PieceMaker mémorise donc uniquement la correspondance entre nouvel identifiant Unified et ancien identifiant legacy, dans son propre répertoire. Tant que le journal original reste lisible, son historique normalisé remplace le préfixe officiel `imported-*` ; les nouveaux messages Unified sont ajoutés ensuite. Si la source ancienne manque, la projection officielle reste affichée. Les correspondances et les dates enregistrées par PieceMaker restent conservées à la désinstallation, avec la Bibliothèque ; les runtimes Python sont retirés. Aucun cache de transcription supplémentaire ni modification du journal propriétaire n’est créé.

Les événements Unified `effect` exposent aussi les outils en direct et après rechargement : entrée, résultat, échec ou refus. Ils étaient auparavant ignorés. Le lecteur dispose de deux minutes au démarrage à froid ; une première limite de trente secondes a été dépassée sur le banc.

## Dépendances communes

Les verrous macOS ARM64 et Windows x64 sont recalculés en conservant les versions précédentes sauf contraintes imposées par Vibe 3.0.2. Ils contiennent respectivement 197 et 200 paquets. Les deux résolutions réussissent avec des wheels, à l’exception connue de Jieba 0.42.1, construit avant distribution.

Vibe ajoute `croniter==6.2.4`, remplace SoundDevice par `miniaudio==1.71` et impose notamment AnyIO 4.15.1, GitPython 3.1.62, PyJWT 2.15.1, Soupsieve 2.9.2, Typing Extensions 4.16.0 et urllib3 2.8.0. Les versions GLiNER, MinerU, Torch et Transformers sont conservées. La sonde d’imports vise le lanceur actuel et le moteur Unified embarqué, au lieu du module programmatique Python retiré.

## Essai sur le Mac

Le banc Electron isolé du rapport précédent est réutilisé avec le serveur de la branche et Vibe 3.0.2 dans le Python commun. L’application habituelle et le terminal personnel 2.26.1 ne sont pas remplacés. Le runtime de contrôle est préparé avec le verrou macOS ; les imports communs, le chargement du moteur natif, le lanceur déplacé et `pip check` réussissent. Cela ne constitue pas encore une nouvelle archive de release distribuée.

- La conversation Unified créée avec Vibe 2.26 reprend avec succès sous 3.0.2. L’erreur « Unified Harness » n’est plus reproduite.
- L’API officielle restitue son ancien historique sans appel au modèle. Un démarrage à froid a pris environ 29 secondes ; une lecture suivante environ 13 secondes sur ce poste.
- En mode plan, une demande explicite de création d’un fichier est refusée : le fichier n’existe pas et le Word reste identique. Le plan restitue bien le montant lu dans le fichier texte fictif.
- Au tour suivant, l’application du plan hors mode lecture modifie effectivement le Word à 1 700 EUR. Le suivi des modifications reste actif, le commentaire est conservé et `docx validate` réussit.
- Microsoft Word ouvre le document rechargé sans réparation et montre les révisions jusqu’à 1 700 EUR ainsi que le commentaire. Une copie déjà ouverte gardait son ancien contenu en mémoire : elle a été fermée puis rouverte. Seule la fenêtre du document de contrôle est ensuite fermée.
- Après relancement du banc, un nouvel appel de lecture apparaît réellement dans le flux WebSocket avec son résultat. L’historique Unified rechargé contient également les appels d’outils.
- La conversation legacy 2.25 reprend par l’import officiel vers un nouvel identifiant. Les empreintes de ses deux fichiers d’origine restent identiques. Après rattachement de cette importation de contrôle à son origine, les 33 messages normalisés et les 19 outils d’origine sont conservés exactement, suivis des deux nouveaux messages, sans doublons. Le test du runtime vérifie que ce rattachement est enregistré avant la fin d’un tour d’import.

Les 40 tests Mistral ciblés réussissent, avec un test réseau optionnel ignoré. Les 19 tests des composants Python, les tests du retrait (dont exécution réelle du script Mac sur une arborescence fictive), la compilation serveur et le lint ciblé réussissent. Les preuves détaillées et les documents entièrement fictifs restent hors dépôt. Windows et macOS Intel ne font pas l’objet d’un essai fonctionnel dans ce parcours.

## Distribution native macOS

L’adaptation Mistral ne vaut pas qualification d’une nouvelle DMG distribuée. Le poste ne dispose pas d’identité Developer ID Application, les variables Apple ne sont pas fournies au processus et les secrets `CSC_*` / `APPLE_*` sont absents du dépôt GitHub lors du contrôle. Aucun secret n’est lu ou affiché.

Le manifeste CloudCLI désactive actuellement la notarisation. Une distribution normale exige donc un raccord de configuration explicite, une signature Developer ID, une notarisation et un contrôle du ticket Apple, puis un essai de mise à jour avec deux bundles distribuables. Le remplacement local et les mises à jour continues de l’interface déjà testés ne remplacent pas cette qualification. Le numéro de version de l’application n’est pas incrémenté, aucune publication n’est effectuée et le binaire personnel 2.26.1 reste en place.

## Sources officielles

- [Métadonnées PyPI de Vibe 3.0.2](https://pypi.org/pypi/mistral-vibe/3.0.2/json).
- [Changelog Vibe 3.0.2, 3.0.1 et 3.0.0](https://github.com/mistralai/mistral-vibe/blob/v3.0.2/CHANGELOG.md).
- [Agents officiels](https://github.com/mistralai/mistral-vibe/blob/v3.0.2/vibe/core/agents/models.py).
- [Serveur JSON-RPC officiel](https://github.com/mistralai/mistral-vibe/blob/v3.0.2/vibe/app_server/stdio.py).
