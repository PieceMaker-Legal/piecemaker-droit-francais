# Audit Windows PieceMaker

## Contre-vérification après corrections — 2026-10-17

Sources vérifiées après le commit `3393b95f`. Dépôt et application affichent 2.0.48, mais leurs contenus diffèrent. Un agent Luna distinct a été affecté à chacun des huit bugs initiaux, puis deux autres au scan complémentaire. Les essais utilisent des données fictives et des répertoires temporaires. Aucun correctif applicatif, téléchargement de modèle, changement de configuration persistante ni redémarrage de l'application n'a été effectué pendant cette passe.

**Résultat : sept correctifs présents dans les sources, un correctif partiel (WIN-008), aucune des huit corrections retrouvée dans les chemins installés inspectés.** WIN-004 et WIN-005 restent des défauts conditionnels. Le pipeline Python corrigé réussit un essai avec GLiNER ; cela ne valide pas encore les parcours API et OCR complets.

### Vérification des huit bugs initiaux

| ID | Sources actuelles et preuves | Installation actuelle | Verdict |
| --- | --- | --- | --- |
| WIN-001 | Le build compile et embarque `node-shim/node.exe`, puis configure son PATH. Les trois tests du shim (ressource, exécution/arguments, arrêt) passent. | Sidecar absent ; helper absent de l'ASAR et aucun appel dans l'entrée principale installée. | Corrigé dans les sources ; persiste sur le poste. |
| WIN-002 | MinGit épinglé, SHA-256 vérifié, ressource embarquée et helper câblé. Quatre tests ciblés réussis. | `resources/mingit/cmd/git.exe` absent ; helper retourne `false`, puis lancement Git en `ENOENT`. | Corrigé dans les sources ; persiste sur le poste. |
| WIN-003 | `compact-package.mjs:61` décompresse désormais `electron/uninstallPlan.js`. Suites `place` et `compact-package` : 8 réussis, 1 ignoré. | Module absent de l'arbre physique ; import de `place.mjs` en `ERR_MODULE_NOT_FOUND`. | Corrigé dans les sources ; persiste sur le poste. |
| WIN-004 | `sessions.ts` résout PATH/PATHEXT et lance directement la cible Node des shims npm. Essai fictif : nom nu en `ENOENT`, cible Node directe réussie avec arguments et stdin. Vitest absent, suite dédiée non exécutée. | Ancien `spawn(command,args)` dans le plugin compilé ; chemins fournisseurs vides, donc noms nus utilisés. | Corrigé dans les sources pour le shim npm testé ; plugin installé ancien. Aucun fournisseur réel appelé. |
| WIN-005 | Les deux consommateurs utilisent `python` sous Windows, `python3` ailleurs. Test du repli sans interpréteur configuré réussi ; suite du lanceur : 4 réussis. Suite TypeScript bloquée par `better-sqlite3` absent. | Repli inconditionnel `python3` encore présent. L'interpréteur configuré existe sur ce poste. | Corrigé dans les sources ; ancien défaut conditionnel installé, sans échec actuel de cette condition. |
| WIN-006 | Le lanceur force `PYTHONIOENCODING=utf-8` et `PYTHONUTF8=1`. Essai indépendant avec parent forcé en CP1252 : enfant en UTF-8, mode UTF-8 actif. Test de régression réussi. | Même essai via le lanceur installé : CP1252, mode UTF-8 inactif ; variables correctrices absentes. | Corrigé dans les sources ; persiste sur le poste. |
| WIN-007 | Lecture par thread et file de résultats. Test READY réussi ; essais indépendants READY + réponse immédiate, sortie prématurée et timeout réussis. | Ancien `select.select` présent ; worker fictif écrivant immédiatement READY déclaré indisponible au timeout, puis tué. | Corrigé dans les sources ; persiste sur le poste. |
| WIN-008 | Deux tests réussissent lorsque les deux homonymes sont dans le même lot ; noms suffixés et contenus distincts préservés. Le lecteur et le renommage retrouvent les noms suffixés. Collisions résiduelles ci-dessous. | Pipeline sans `_source_digest` ni `markdown_stems_for_batch`. | Partiellement corrigé dans les sources ; défaut initial encore installé. |

### WIN-008 : collisions résiduelles reproduites

`markdown_stems_for_batch` (`convert_and_scan_pipeline.py:319`) ne considère que les fichiers du lot courant. Deux conversions successives de `a/exemple.txt`, puis `b/exemple.txt`, vers la même sortie choisissent toutes deux `exemple.md`. Reproduction réelle avec markitdown : deux conversions réussies, un seul Markdown conservé, contenant uniquement le marqueur fictif de la seconde pièce. `knowledge/pipeline.ts` permet explicitement une sélection de fichiers : les traitements séparés sont possibles.

Un original déjà nommé `exemple-<suffixe calculé>.txt` peut également entrer en collision avec le nom généré pour un homonyme `exemple.txt` dans le même lot. Collision reproduite sur la fonction de nommage actuelle ; aucune conversion de modèle nécessaire.

### Nouveaux bugs confirmés

| ID | Priorité | Bug et reproduction | Source | Statut |
| --- | --- | --- | --- | --- |
| WIN-009 | Haute | Contenu scanné perdu dans un PDF mixte. Un PDF fictif de deux pages, texte natif puis page raster, est orienté vers markitdown dès qu'une des trois premières pages contient assez de texte. La conversion garde le marqueur natif et perd celui de la page scannée ; GLiNER ne peut pas analyser le texte absent. | `server/piecemaker/vendor/websocket-server/scripts/smart_converter.py:168`, puis `inspect_file` | Reproduit sur les sources. |
| WIN-010 | Moyenne | Statut « non converti » pour les Markdown suffixés. Deux originaux fictifs et leurs Markdown suffixés : `markdownCounterpart` trouve les deux fichiers, mais `originalFilesOverview` retourne `converted:false`, `status:not-converted`. La liste compare encore les noms simples aux clés suffixées. | `server/piecemaker/vendor/piecemaker-plugin/scripts/lib/commits.cjs:617`, `:664` | Reproduit sur les sources ; incohérence avec WIN-008. |
| WIN-011 | Moyenne, validation | Test de repli OCR cassé par la nouvelle signature. Avec le Python configuré, premier test réussi, second en `TypeError: convert() got an unexpected keyword argument 'output_name'`. Le mock n'accepte pas le nouvel argument ; sans Python trouvé par la suite, le test est ignoré et masque cette régression. | `server/piecemaker/vendor/websocket-server/ocr-fallback.test.js:24`, appel dans `convert_and_scan_pipeline.py:2253` | Reproduit. Défaut du test, sans preuve que le repli OCR réel échoue. |
| WIN-012 | Haute, conditionnelle | Tabular Review accepte un Markdown extérieur au dossier via une jonction Windows locale. Fixture temporaire : `project/linked/fixture.md` pointe hors du projet, passe le même contrôle lexical de confinement, est reconnu comme fichier et son contenu externe est lu. L'import de documents utilise ce contrôle puis lit le fichier. | `plugins/piecemaker-tabular-review/src/server/documents.ts:43`, `paths.ts:45`, `reviews.ts:62` | Mécanisme reproduit avec les mêmes opérations et le même prédicat ; aucun fournisseur IA appelé. Nécessite une jonction déjà présente et un chemin demandé. |
| WIN-013 | Moyenne | Désinstallation depuis l'application refusée pour le répertoire installé actuel. `packagedApplicationRoot` exige un dossier nommé `PieceMaker`, alors que le bootstrap utilise ici `@piecemaker-legalpiecemaker-desktop`. Le calcul retourne `null` et `scheduleUninstall` lève « Dossier de l'application introuvable » avant planification. | `electron/uninstallPlan.js:19`, `electron/piecemakerUninstall.js:53`, `desktop-bootstrap/install.ps1:104` | Calcul reproduit sur le chemin installé ; aucune désinstallation déclenchée. |

Aucun de ces nouveaux bugs n'a été corrigé pendant l'audit.

### Autres pistes non confirmées de bout en bout

- Arrêt pendant le démarrage d'un plugin : `stopAllPlugins` ne parcourt que `runningPlugins`, alors que `startingPlugins` suit séparément les lancements en cours. Un démarrage tardif pourrait échapper à l'arrêt. Course identifiée dans le code, non reproduite.
- Arrêt normal du serveur Windows : `electron/localServer.js:552` utilise `child.kill('SIGTERM')`, tandis que le serveur compte sur son gestionnaire SIGTERM pour arrêter les services. Un processus fictif exécuté avec le runtime Electron installé ne reçoit pas son gestionnaire JS lors du SIGTERM testé. Survie des descendants après fermeture réelle non testée ; aucune fermeture de l'application utilisateur.
- Shims `.cmd` non npm : le repli conserve `shell:true`. Aucun problème d'échappement exploitable n'a été démontré.

### Vérifications de cette passe

| Périmètre | Résultat et portée |
| --- | --- |
| Packaging, shim Node/Git, ASAR, admission des travaux, renommage | 28 tests réussis, 3 ignorés : deux OCR faute de Python détecté, un réservé aux groupes de processus POSIX. |
| Installation, désinstallation, dépendances runtime, archives et publication | 18 tests réussis ; aucun installateur ou désinstallateur réel exécuté. |
| Repli OCR avec le Python configuré | 1 réussi, 1 en échec : WIN-011. Copie temporaire du test avec le seul chemin des scripts adapté à une jonction courte ; logique inchangée. |
| Python : formes juridiques, codes globaux, doublons, page d'entités fictives | 24 tests réussis, dont une inférence GLiNER vérifiant les entités, métadonnées et mapping attendus. |
| Python : homonymes et READY | 2 tests homonymes et 1 test READY réussis ; scénarios indépendants supplémentaires détaillés plus haut. |
| Pipeline Python actuel, texte fictif, modèles hors ligne | Sortie 0 en 18,1 secondes : Markdown, worker prêt, un événement MAPPING, index documentaire, état `converted`/`scanned`. UTF-8 forcé comme par le lanceur corrigé ; métadonnées désactivées pour isoler ce parcours. |
| Services installés | Aucun serveur en écoute sur 3002, 3003 ou 5173 au contrôle ; application non redémarrée. |

Les suites déléguées recouvrent parfois les sélections principales ; leurs comptes ne s'additionnent pas comme des tests distincts. Les suites TypeScript/Vitest complètes restent indisponibles faute de dépendances de développement. Les imports cassés par les longs chemins du workspace ont été contournés par une jonction temporaire courte, sans modification des sources ; ils ne sont pas comptés comme défauts supplémentaires de l'application.

Le succès Python ne valide pas l'enregistrement final par l'API dans SQLite, la protection après scan, les parcours visuels ni les fournisseurs IA. MinerU n'a pas fait l'objet d'une nouvelle inférence lourde : environ 3,7 Go étaient libres au contrôle intermédiaire. Sa conversion complète reste non validée ; l'arrêt mémoire de l'audit initial reste décrit ci-dessous.

## Archive : audit initial avant contre-vérification

Les constats et conclusions ci-dessous décrivent l'état initial. Pour les corrections et le statut actuel, se référer aux sections précédentes.

Date : 2026-10-17. Version installée et version du dépôt : 2.0.48.

Ce registre centralise les anomalies de l'installation locale et les défauts repérés dans le code. Aucun document métier n'est utilisé pour les reproductions. Aucun correctif n'a encore été appliqué.

## Bugs confirmés

| ID | Priorité | Anomalie | Preuve et impact | Source | Statut |
| --- | --- | --- | --- | --- | --- |
| WIN-001 | Haute | Exécutable Node embarqué absent | `resources/node-shim/node.exe` absent, aucun Node système trouvé ; le helper retourne `false` et le lancement de `node` échoue avec `ENOENT`. Le serveur de Tabular Review ne peut pas démarrer dans cet environnement. | `server/modules/plugins/plugin-process.service.ts:68`, `desktop-bootstrap/overlay/electron-piecemaker/embedded-node.js:4` | Reproduit ; origine de la perte au packaging non établie. |
| WIN-002 | Haute | Exécutable Git embarqué absent | `resources/mingit/cmd/git.exe` absent ; lancement de `git` reproduit avec `ENOENT`. Les opérations de clonage et mise à jour de plugins ne disposent pas de Git. | `server/modules/plugins/plugin-registry.service.ts:300`, `desktop-bootstrap/overlay/electron-piecemaker/embedded-git.js:4` | Reproduit ; origine de la perte au packaging non établie. |
| WIN-003 | Moyenne | Écran de fin d'installation et guide PISTE en échec | L'import de `place.mjs` échoue avec `ERR_MODULE_NOT_FOUND` pour `electron/uninstallPlan.js`, présent dans ASAR mais absent de l'arbre physique. Le journal de fin d'installation confirme l'erreur. Le bootstrap prévoit un lancement de secours de l'application. | `desktop-bootstrap/lib/place.mjs:7`, `desktop-bootstrap/lib/compact-package.mjs:61`, `desktop-bootstrap/install.ps1:125` | Reproduit. La préparation des certificats n'est pas démontrée en échec : son import réussit et son journal d'erreurs est vide. |
| WIN-006 | Haute | Le pipeline Python plante avec l'encodage Windows par défaut | Avec le Python installé, un document Word fictif et une base temporaire, le pipeline sort en code 1 sur `UnicodeEncodeError` dans `load_reserved_codes`, avant toute conversion. La sortie redirigée utilise `cp1252` et ne peut pas encoder le symbole de progression. Le lanceur ne force ni UTF-8 ni `-X utf8` ; aucun réglage équivalent n'a été trouvé dans l'environnement du poste. | `server/piecemaker/vendor/websocket-server/scripts/convert_and_scan_pipeline.py:433`, `server/piecemaker/vendor/websocket-server/originals-pipeline.cjs:217` | Reproduit sur l'application installée. Avec UTF-8 explicitement forcé, le convertisseur Word réussit. |
| WIN-007 | Haute | Le parent ne reconnaît jamais le worker GLiNER prêt sous Windows | `select.select` n'accepte pas le pipe stdout d'un sous-processus Windows. Son exception est ignorée et le parent attend jusqu'au timeout sans lire `READY`. Un enfant fictif qui écrit immédiatement `READY` est néanmoins déclaré indisponible après un timeout de test d'une seconde. La production prévoit deux attentes de 500 secondes. | `server/piecemaker/vendor/websocket-server/scripts/convert_and_scan_pipeline.py:187`, `server/piecemaker/vendor/websocket-server/scripts/convert_and_scan_pipeline.py:2272` | Reproduit avec le Python installé et la fonction source inchangée ; ne nécessite aucun modèle. Le scanner peut être fonctionnel indépendamment de ce dialogue cassé. |
| WIN-008 | Haute | Collision des Markdown de pièces portant le même nom | Deux documents fictifs `a/exemple.docx` et `b/exemple.docx` produisent tous deux `exemple.md` dans le dossier commun. La seconde conversion écrase le contenu de la première. La collecte des sources utilise ensuite le chemin Markdown comme clé, ce qui peut également mélanger l'attribution du scan. Les originaux restent intacts. | `server/piecemaker/vendor/websocket-server/scripts/smart_converter.py:266`, `server/piecemaker/vendor/websocket-server/scripts/convert_and_scan_pipeline.py:2227` | Écrasement reproduit sur le convertisseur installé : deux conversions réussies, un seul Markdown conservé avec le second contenu. Non spécifique à Windows. |

## Défauts conditionnels

| ID | Priorité | Condition et conséquence | Preuve | Source | Statut |
| --- | --- | --- | --- | --- | --- |
| WIN-004 | Moyenne | Dans Tabular Review, un fournisseur résolu par un nom nu et disponible uniquement via un shim `.cmd` ne démarre pas avec le lancement natif sans shell. | Une commande fictive `.cmd` dans un dossier temporaire reproduit `ENOENT` lorsqu'elle est appelée par son nom nu. Le code active le shell seulement si le nom contient déjà l'extension `.cmd` ou `.bat`. | `plugins/piecemaker-tabular-review/src/server/sessions.ts:133` | Mécanisme reproduit ; pas d'appel à un fournisseur IA réel. |
| WIN-005 | À préciser | Le repli vers `python3` peut échouer sur Windows lorsque l'interpréteur configuré et les environnements attendus sont absents. | Le code utilise ce repli ; sur le poste audité, l'interpréteur configuré existe. | `server/piecemaker/knowledge/pipeline.ts:150`, `server/piecemaker/vendor/websocket-server/originals-pipeline.cjs:41` | Non reproduit sur la configuration actuelle. |

## Observations à investiguer

- Aucun serveur ne répondait sur les ports 3002, 3003 et 5173 pendant les contrôles ; cause non établie. Des processus PieceMaker étaient présents.
- Les certificats locaux sont lisibles et valides à la date de l'audit. L'autorité enregistrée localement n'a pas été retrouvée dans le magasin Root de l'utilisateur ; le contexte de consentement reste à vérifier.
- Le bootstrap vérifie le SHA-256 de l'installateur mais n'impose pas une vérification Authenticode avant exécution. Aucune compromission n'a été constatée.
- L'environnement du dépôt ne contient pas ses dépendances de développement. Les échecs dus à `openssl`, `jsdom` ou aux dépendances TypeScript absentes ne sont pas des preuves de défaut de l'application installée.

## Vérifications réalisées

| Périmètre | Résultat |
| --- | --- |
| Plugins intégrés | Cinq manifestes présents et conformes ; cinq plugins déclarés activés, dont Tabular Review. |
| Contrat et synchronisation des plugins | 4 tests réussis ; 1 test ignoré faute de dépendances de construction. |
| Démarrage simulé et interface d'installation | 16 tests réussis après configuration des modules VM et utilisation d'un répertoire temporaire pour le bootstrap. |
| Protection et historique | 9 tests réussis ; ce résultat ne valide pas toutes les opérations Git réelles. |
| SQLite installé | Création, écriture et lecture dans une base temporaire réussies. |
| bcrypt installé | Hachage et comparaison réussis. |
| Terminal natif installé | Lancement de PowerShell et réception du marqueur de test réussis. |
| Python installé | Python 3.12.15 ; imports `pypdf`, `docx` et `markitdown` réussis. |
| Pipeline : formes juridiques, codes réservés et doublons | 16 tests Python réussis sur les sources du dépôt avec le Python installé. |
| GLiNER : configuration et progression | 4 tests Python réussis, dont une inférence locale comparant les entités obtenues avec et sans remontée de progression. |

## Audit du pipeline MinerU et GLiNER

### État des composants

- GLiNER2 2.1.0 est installé, avec l'API attendue ; les cinq fichiers du snapshot épinglé sont présents. L'absence de l'ancien paquet `gliner` ne signifie pas que GLiNER2 est absent.
- MinerU 4.0.11 et `mineru-llama-cpp` 0.1.3 sont installés. Les deux répertoires de modèles attendus sont présents ; cela ne valide pas encore une conversion complète.
- Les étapes d'installation 03 et 04 sont enregistrées comme terminées.
- La conversion Word vers Markdown fonctionne avec UTF-8 explicitement forcé ; elle conserve le texte fictif attendu.
- Le worker GLiNER a réellement chargé le modèle local sur CPU puis scanné un court Markdown fictif, avec UTF-8 forcé et sans accès réseau. Résultat en 20 secondes, chargement compris : sortie 0, protocole `READY` puis réponse `ok`, fichier de détections présent ; quatre entités finales, de catégories personne, organisation, lieu et courriel. Les métadonnées documentaires étaient désactivées pour isoler cette inférence. Ce test valide le worker, pas son intégration au parent défectueuse sous Windows (WIN-007), ni la qualité sur un corpus réel.
- Un essai du pipeline sur un PDF fictif sans couche texte a atteint MinerU, puis a été arrêté par sa protection de mémoire libre. Un autre test de modèle tournait pendant cette mesure : elle ne permet pas de conclure sur une conversion MinerU isolée.
- Un second essai MinerU isolé, sans autre modèle lancé par l'audit, a utilisé un PDF raster d'une page contenant uniquement des données fictives. Sur les 16 Go du poste, environ 2,7 Go étaient disponibles au départ. Le moteur llama.cpp s'est chargé, puis le superviseur a arrêté le traitement après 16,7 secondes pour mémoire libre inférieure au seuil de 5 %, soit environ 0,8 Go. Aucun Markdown n'a été produit. Cela démontre l'échec dans l'état de charge observé, pas une corruption du modèle ni un défaut de la protection mémoire.

### Conclusion sur le pipeline

Le pipeline Windows ne peut pas être considéré comme fonctionnel de bout en bout : WIN-006 empêche son démarrage dans l'environnement par défaut ; même avec UTF-8 forcé, WIN-007 empêche le parent de reconnaître le worker prêt. La conversion Word et le scanner GLiNER fonctionnent séparément. MinerU démarre mais n'a pas terminé la conversion du scan fictif sous la charge mémoire observée. WIN-008 compromet en outre les résultats de pièces homonymes. La fusion finale en SQLite et la protection après un scan complet ne sont donc pas validées par ces essais.

### Écart documentaire

Les documents d'installation annoncent une préparation automatique de GLiNER et MinerU à l'ouverture. Les chemins inspectés installent les composants de base puis proposent des tâches déclenchées depuis les réglages des modèles. Aucun téléchargement automatique des deux modèles au lancement n'a été identifié. Ce point doit être rapproché du comportement réel de l'interface avant de le qualifier de défaut fonctionnel.

## Limites

Les parcours visuels, les suites frontend et TypeScript complètes, ainsi que les appels aux fournisseurs IA n'ont pas été validés de bout en bout. Aucun redémarrage de l'application, téléchargement de modèle ou changement de configuration n'a été effectué pour l'audit initial.
