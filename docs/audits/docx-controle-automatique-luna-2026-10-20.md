# Contrôle automatique du raisonnement des DOCX liés

## Résultat

L’éditeur déclenche le contrôle local à l’ouverture, après sa sauvegarde automatique et lors du rechargement d’une modification externe. Une frappe invalide immédiatement l’affichage précédent ; seules les réponses correspondant encore au document courant peuvent être publiées. Le contrôle n’appelle aucun LLM et ne relit aucune source externe.

L’avocat voit le statut, les erreurs, les points à examiner et, dans les détails, les calculs ou les passages dont le texte a changé. Le bouton de relance reste désactivé pendant les retouches non sauvegardées ou un contrôle en cours. Un document ordinaire sans modèle embarqué ne présente pas ce panneau. Une erreur de liaison est indépendante du succès de l’écriture.

La sauvegarde calcule son résultat sur les octets écrits et retourne leur version. L’ouverture lit les octets et leur version depuis le même fichier ouvert. Les lectures lentes sont dédupliquées ; une ancienne lecture ne remplace pas un document ouvert ensuite. Les sauvegardes de l’éditeur sont sérialisées afin de préserver leur ordre.

Le modèle, ses règles, ses formules et ses hypothèses restent inchangés. Le moteur `server/modules/piecemaker-reasoning`, son instruction et la fixture de raisonnement n’ont aucune différence avec le commit de départ `23340925`. Le changement dans le lecteur DOCX distingue seulement l’absence de modèle d’une liaison invalide. Les ajouts frontend sont isolés dans le module `docx-reasoning` ; les fichiers partagés originaux de CloudCLI ne sont pas modifiés.

## Essais exécutés par Luna

Session `gpt-6-luna`, Node 24.11.1 :

- `npm run test:reasoning-docx` : 71 réussis, aucun échec ni test ignoré. Les six nouveaux tests HTTP utilisent Express et une base SQLite temporaires ; ils vérifient la sauvegarde, les valeurs actuelles, les clauses modifiées, l’absence de modèle, les erreurs du contrôle et le périmètre des chemins.
- `npx --no-install vitest run src/modules/docx-reasoning/tests/DocxReasoningStatus.test.tsx src/piecemaker/docx/tests/DocxDocumentViewer.test.tsx` : 22 réussis. Les cas couvrent notamment l’invalidation immédiate, les réponses périmées, l’ouverture et la sauvegarde, les modifications externes, le changement de fichier pendant une lecture, les lectures lentes et deux sauvegardes successives dont la première est retardée.
- `npm run test:client -- --maxWorkers=1` : 919 réussis, 19 échecs dans cinq fichiers hors DOCX. Ces 19 échecs ont été reproduits à l’identique sur `23340925` dans un worktree détaché temporaire, retiré après vérification.

Les cinq fichiers concernés sont `CitationPanel`, `editorLayoutSwitch`, `claudeSettingsFileRules`, `sessionBulkSelection` et `sidebarRowProps`. Les tests d’interface DOCX utilisent JSDOM et un éditeur simulé ; ils ne constituent pas un essai manuel de l’application complète.

Le lint ciblé réussit sans erreur ni avertissement. Les contrôles TypeScript globaux restent bloqués par 13 erreurs frontend et une erreur serveur dans des fichiers hors périmètre ; aucune erreur n’est rapportée dans les fichiers modifiés. Aucun build n’a été exécuté.

Les journaux complets restent hors dépôt dans le dossier d’audit local `docx-autocheck-luna-2026-10-20`.

## Limites

Le contrôle porte sur un DOCX déjà lié. Il ne crée pas les balises et ne synchronise pas son modèle avec celui du dossier. Les sources externes, les parties et la fiabilité des pièces restent signalées comme non relues. Une clause réécrite demande une nouvelle appréciation ; aucune interprétation juridique automatique ne remplace le modèle existant.

L’intégration est du code sur la branche de travail, sans publication ni déploiement dans l’application installée. Le cycle Microsoft Word a ensuite été validé par Luna, avec recalcul des valeurs et signalement d’une clause réécrite : voir [l’audit complémentaire](docx-preparation-word-luna-2026-10-20.md). Les essais de sauvegarde réels EigenPal/LibreOffice du prototype restent inclus dans la suite backend.
