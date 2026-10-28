# Audit de la branche raisonnement

Audit du 20 octobre 2026, demandé par le propriétaire du dépôt. Version examinée : `feat/plugin-raisonnement`, commit `c47e2170a20bcf85840830432f70ea22cbe30ca5`. Le worktree `piecemaker-raisonnement-test` contient les évolutions de `feat/raisonnement-acte` et deux commits supplémentaires. Aucun correctif fonctionnel n’a été appliqué pendant cet audit.

## Conclusion

La branche n’est pas prête à être considérée comme vérifiée pour un usage métier sans réserve. Les tests du moteur réussissent, mais cinq défauts ont été reproduits : calcul financier incorrect, corruption du fichier lors d’une correction de citation, perte d’une édition concurrente, simulation autorisée malgré une erreur de citation, et indisponibilité du registre non transmise dans les alertes de l’agent. Les essais Luna contrat et contentieux sont détaillés plus bas.

P1 désigne ici un défaut à corriger avant de se fier au résultat ou de laisser le vérificateur réécrire un dossier de travail ; P2 désigne un défaut de signalement ou de garde du parcours.

## Défauts reproduits

### P1 La réécriture peut perdre une modification de l’avocat

Emplacement : `server/modules/piecemaker-reasoning/program.ts:649-673`, particulièrement l’écriture à la ligne 669. Le service lit le fichier, attend les connecteurs, puis écrit sa copie canonique sans contrôler que le fichier courant correspond encore à celui qu’il a lu.

Reproduction : bloquer la résolution d’une source, modifier le texte de l’objectif sur disque, puis libérer le connecteur. La vérification efface la modification. Le test utilise une base SQLite en mémoire et un dossier temporaire, sans serveur ni document réel.

Correction proposée : sérialiser les vérifications par dossier, vérifier l’identité du contenu avant remplacement et refuser un conflit explicite. Une écriture atomique seule évite un fichier partiel mais ne suffit pas à préserver une édition concurrente.

### P1 Une correction de citation peut rendre le fichier illisible

Emplacement : `server/modules/piecemaker-reasoning/program.ts:568-569`. Les corrections sont injectées par substitution globale après impression du littéral, sans nouvel échappement JavaScript.

Reproduction : l’extrait `l obligation etablie est due` est rapproché de la source fictive `l'obligation établie est due`. Le script reprend exactement l’algorithme de rapprochement du connecteur de production et appelle ses fonctions de vérification et de passage voisin. Le premier passage ne signale aucune erreur, mais écrit `citation: 'l'obligation établie est due'`. La lecture suivante échoue à la ligne 11. Le connecteur de transport est simulé ; aucun texte de droit n’est inventé pour ce test.

Correction proposée : appliquer les corrections aux nœuds de l’objet, réimprimer avec le sérialiseur puis reparcourir le résultat avant toute écriture. La substitution globale peut également modifier une autre chaîne contenant le même extrait.

### P1 Les arrondis intermédiaires faussent les taux calculés

Emplacement : `server/modules/piecemaker-reasoning/engine.ts:112-136`. Le moteur arrondit à deux décimales le résultat de chaque opération arithmétique, y compris un quotient utilisé comme taux.

Reproduction : `10000 × (128 / 1000)` donne `1300` au lieu de `1280`. Le quotient `0.128` est arrondi à `0.13` avant la multiplication. Ce test ne dépend d’aucun connecteur ni d’une règle juridique.

Correction proposée : conserver la précision des intermédiaires et réserver l’arrondi à une opération explicite ou au montant terminal selon la règle retenue. Ajouter des tests de taux et d’opérations imbriquées, sans imposer arbitrairement un régime d’arrondi juridique.

### P2 Une simulation répond acquis malgré une erreur de citation

Emplacements : `server/modules/piecemaker-reasoning/program.ts:570-581,693-697` et `server/modules/piecemaker-reasoning/engine.ts:156-157`.

Reproduction : vérifier un raisonnement qui cite un passage absent de la source ; le moteur signale correctement une erreur. Appeler ensuite `service.simulate` avec le fait requis à vrai renvoie un objectif `acquis`. La simulation ne refuse pas les erreurs et sa réponse ne contient pas les alertes qui permettraient de comprendre cette réserve.

La simulation du droit en faisant abstraction des faits est un choix du mode hypothèses ; le défaut relevé est l’absence de garde contre les erreurs déjà constatées et d’avertissement dans la réponse de simulation.

Correction proposée : refuser la simulation en présence d’erreurs bloquantes, ou retourner explicitement sa non-validation et les erreurs, avec une présentation cohérente dans le volet.

### P2 Une panne du registre disparaît des alertes de l’agent

Emplacement : `server/modules/piecemaker-reasoning/program.ts:539`, puis `describeReasoning` à partir de la ligne 719.

Reproduction : pour une société cliente fictive, le connecteur registre lève une exception. Le bilan conserve bien « vérification impossible », mais `issues` reste vide ; la sortie à l’agent dit « Aucune erreur, aucun manque ». Le BODACC n’est pas consulté après cette exception. Il s’agit d’une panne simulée, pas d’un constat d’indisponibilité réelle du service externe.

Correction proposée : produire un manque visible et une entrée de journal d’alerte ; distinguer société absente, service indisponible et contrôle non effectué.

## Tests exécutés

83 tests existants ont été exécutés : 80 réussis et 3 en échec.

| Périmètre | Réussis | Échecs |
| --- | ---: | ---: |
| Moteur raisonnement, harness Legal Code et résolution du dossier | 36 | 0 |
| Outil SQL et protection des tables du raisonnement | 28 | 0 |
| CLI pm et serveur MCP PieceMaker | 16 | 3 |

Les trois échecs concernent l’inventaire MCP qui attend encore `volets_ouverts`, le test qui attend une erreur pour `afficher` sans cible alors que l’implémentation liste les volets, et le test CLI qui utilise encore `raisonnement fait` alors que seule la commande `verifier` est acceptée. Ces divergences montrent des tests d’intégration désynchronisés ; elles ne prouvent pas à elles seules trois nouveaux défauts fonctionnels. Le contrat public et les tests doivent être rapprochés avant validation de la branche.

Commandes, depuis la racine du worktree, avec Node 24 et les dépendances déjà installées :

```sh
npx --no-install tsx --tsconfig server/tsconfig.json --test server/modules/piecemaker-reasoning/tests/*.test.ts server/piecemaker/legal-code/tests/legal-code-harness.test.ts server/piecemaker/session-dossier/tests/session-dossier-routes.test.ts
npx --no-install tsx --tsconfig server/tsconfig.json --test server/piecemaker/knowledge/tests/sql-tool.test.ts
node --test server/piecemaker/vendor/skills/Skill-PieceMaker/scripts/pm.test.mjs server/piecemaker/vendor/mcp/piecemaker/server.test.js
npx --no-install tsx --tsconfig server/tsconfig.json scripts/piecemaker/audit-raisonnement.mts /tmp/audit-raisonnement
```

Le dernier script reproduit les cinq défauts sur cette version figée et sauvegarde `reproductions.json`. Ses assertions confirment les comportements défectueux actuels : ce n’est pas une suite de non-régression à conserver telle quelle après correction.

## Essais Luna

Deux sessions distinctes `gpt-6-luna`, effort high, ont été lancées, une pour un contrat fictif et une pour un contentieux fictif de recouvrement. Elles ont reçu les instructions applicatives sans explication préalable des contrôles du vérificateur. Les dossiers de test et les DOCX sont conservés hors dépôt.

Contentieux : après quatre passes (7, 3, 0, 0 erreurs), le résultat final est de 0 erreur, 1 manque, 4/4 contrôles et 2/2 hypothèses conformes. La réception conforme reste contestée et l’objectif de recouvrement reste à établir ; le décompte arithmétique est de 9 000 EUR. Le DOCX est une note d’analyse fictive, pas un acte prêt à signifier. Le moteur a utilisé les pièces locales et des connecteurs simulés sur des extraits officiels collectés par l’agent. La récupération MCP réelle n’a pas été testée.

Contrat : le DOCX fictif a été créé et validé au format OOXML. Après correction du contrôle de validité et nouvelle boucle de six passes, le dernier résultat est de 0 erreur, 50 manques et 4/4 hypothèses conformes. La boucle n’a pas résolu les manques de sources et d’applicabilité ; ce résultat ne valide pas le mode contrat. La relecture parent avait relevé un fait de signature prouvé par une citation disant que le dossier n’est pas signé ; Luna a retiré cette preuve et conserve la signature comme hypothèse. Cette inversion sémantique provenait de la transcription de l’agent ; le vérificateur vérifie l’existence de l’extrait et ne peut pas en garantir la pertinence. Le projet de contrat reste un livrable de test non validé. Le script pm installé ne reconnaît pas la commande raisonnement ; celui de la branche la reconnaît, mais le serveur local est absent.

Les deux sessions ont utilisé le modèle demandé ; leur sortie ne doit pas être confondue avec une décision juridique validée par l’avocat. Le prix du contrat reste proposé en deux variantes fictives, 12 000 ou 18 000 EUR. Le contentieux conserve son désaccord sur la réception au lieu de fabriquer une preuve pour supprimer le manque.

## Limites et suite recommandée

Aucun serveur n’écoute sur 3003 ou 5173 au moment des essais. La commande `pm raisonnement verifier` ne peut donc pas traverser le serveur local ; les essais de raisonnement passent directement par `verifyReasoning`. Aucun parcours dans le navigateur, aucune injection d’instructions par le fournisseur et aucun rendu interactif du plugin n’ont été validés de bout en bout. Les connecteurs de transport sont simulés pour les reproductions ; cela ne constitue pas une vérification réelle de Légifrance, du registre ou du BODACC.

Les tests ne prouvent pas que le moteur contrôle la pertinence juridique d’une citation ni que le raisonnement est exhaustif. Ils contrôlent la structure, l’existence des passages, les calculs et la propagation des états déclarés. Priorité : préserver le fichier, corriger la sérialisation et la précision des calculs, puis sécuriser la simulation et les alertes des connecteurs ; enfin rejouer les deux parcours dans PieceMaker démarré.
