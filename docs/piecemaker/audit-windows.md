# Audit Windows PieceMaker

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
