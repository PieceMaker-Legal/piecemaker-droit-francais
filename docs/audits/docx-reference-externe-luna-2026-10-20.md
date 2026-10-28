# Modèle de raisonnement externe référencé par le DOCX

## Choix adapté à l’usage dans PieceMaker

Les nouveaux documents préparés par `pm docx preparer` conservent le modèle dans le dossier, par défaut `.piecemaker/raisonnement.js`. Le DOCX contient une métadonnée de version 2 : chemin relatif du modèle, SHA-256 exact, correspondances des valeurs, balises des clauses et empreintes du texte de référence. Le code du modèle n’y figure plus. Le moteur, ses instructions et le modèle fictif existant ne sont pas modifiés.

La vérification lit le fichier sans l’exécuter, contrôle son empreinte, injecte en mémoire les valeurs actuelles du DOCX et utilise le moteur existant. Une référence absente, une autre version du modèle, un chemin sortant du dossier ou un lien symbolique sortant empêchent le contrôle. Le fichier modèle et le DOCX restent inchangés par cette opération. Le code est lu à nouveau en fin de test afin de refuser une modification survenue pendant la vérification.

Le contrôle est toujours local et sans appel LLM : zéro token de modèle pour son exécution. L’agent peut encore consommer des tokens pour préparer le manifeste ou examiner une clause réécrite. Aucun gain chiffré supplémentaire de tokens n’est attribué à l’externalisation ; le contrôle embarqué précédent était déjà sans LLM.

## Événements et version du modèle

L’ouverture, la sauvegarde et la modification externe du DOCX gardent leurs déclencheurs existants. Le sondage de version suit aussi l’empreinte du modèle externe. Un changement de modèle invalide l’ancien résultat et relance le contrôle sans recharger le DOCX. Une retouche avec sauvegarde différée conserve son minuteur ; le nouveau contrôle intervient sur les octets sauvegardés.

La référence du DOCX est mise en cache par version du document, avec une limite de 64 entrées. Le sondage lit et hache le fichier modèle ; il ne rejoue pas le moteur à chaque seconde. Un résultat exécuté est associé à l’empreinte attendue du modèle effectivement testé, pour que le sondage détecte un changement survenu juste après le test.

Renommer ou déplacer le DOCX dans son dossier garde sa référence. Déplacer le dossier complet avec le modèle fonctionne aussi, car le chemin reste relatif. Copier le DOCX seul ailleurs ne suffit plus pour le vérifier. Le script autonome accepte `--dossier DOSSIER` si le document est dans un sous-dossier.

## Compatibilité et limites

Les anciens documents de version 1 restent lisibles avec leur modèle embarqué. Ils ne sont ni migrés ni réécrits implicitement. `preparer` refuse toujours un document déjà lié. Aucune commande d’adoption automatique d’une nouvelle version du modèle n’est ajoutée : même une simple remise en forme de son code change son empreinte et impose un réexamen explicite. Restaurer le fichier exact rétablit le contrôle.

`comparer` compare l’empreinte enregistrée avec celle du fichier actuel. `extraire` écrit une nouvelle copie exacte de la version liée si elle est disponible ; il refuse de copier silencieusement une autre version. Les sorties existantes ne sont pas écrasées. Pour les anciennes versions, l’extraction conserve son comportement sur le modèle embarqué.

Les sources externes, les parties et la fiabilité des pièces ne sont pas relues par ce test local. Les clauses réécrites restent à examiner. Le modèle n’est plus autonome avec le DOCX : la conservation du dossier devient nécessaire. L’effacement des métadonnées rend le document non lié, sans reconstitution implicite. Les défauts historiques hors périmètre de l’éditeur et du moteur restent ceux des audits antérieurs.

## Essais

Une première campagne `gpt-6-luna` sous Node 24.11.1 a validé 91 tests DOCX/raisonnement, 7 tests de statut d’interface et 4 tests du client local. Elle couvrait notamment la préparation externe, l’absence de code embarqué, la référence et son empreinte, les modèles manquants ou modifiés et les chemins refusés. Les ajouts ultérieurs de tests de surveillance du modèle et les résultats finaux sont consignés ci-dessous après exécution.

Après une interruption temporaire par limite d’usage, les sessions Luna ont repris et terminé la campagne :

- `npm run test:reasoning-docx` : 95 réussis, aucun échec ni test ignoré.
- Tests frontend `DocxReasoningStatus` et `DocxDocumentViewer` : 24 réussis.
- Tests `conversion-client` : 4 réussis.

Les cas supplémentaires couvrent le changement de modèle sans modification du DOCX, la conservation d’une sauvegarde différée, l’absence de modèle lors de la sauvegarde, sa restauration, les métadonnées mixtes ou invalides, les empreintes fausses, les chemins Windows, le déplacement du document ou du dossier et une modification du modèle pendant la vérification. Une erreur du nouveau scénario HTTP provenait de l’emploi d’une fixture avec placeholders à la place des valeurs ; elle a été corrigée sans modifier le modèle ni le moteur.

Luna a aussi exécuté le nouveau cycle réel Microsoft Word sur un DOCX externe fictif. Préparation par l’API avec le modèle `modele.js`, métadonnées v2 sans code, ouverture Word, modification au clavier de 12 000 à 18 000 EUR, sauvegarde puis contrôle du fichier sur disque : statut `tested`, aucune alerte, montant calculé 540. Le modèle supprimé temporairement puis modifié par un saut de ligne provoque les erreurs attendues. Après restauration octet par octet, le contrôle réussit de nouveau. Le document et le rapport `rapport-preuve.md` sont conservés hors dépôt dans le dossier local d’audit `docx-reference-luna-2026-10-20`. La trace CUA contient l’état Word ; aucun PNG n’a été archivé dans le dossier. Le cycle concerne un scénario arithmétique fictif, sans validation juridique de fond.

Le lint ciblé est sans erreur ni avertissement. Les contrôles TypeScript globaux conservent 13 erreurs frontend et une erreur serveur dans des fichiers hors périmètre déjà signalés dans les audits précédents ; aucune erreur ne vise les fichiers de ce changement.

Le travail reste sur la branche, sans publication ni déploiement. Aucun build n’est utilisé pour la vérification.
