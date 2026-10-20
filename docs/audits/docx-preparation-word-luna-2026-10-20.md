# Préparation des liens DOCX, modèle de référence et essais Word

> Évolution ultérieure : les nouveaux DOCX référencent maintenant le modèle externe
> du dossier, sans embarquer son code. Cet audit décrit l’étape précédente ; voir
> [la campagne de référence externe](docx-reference-externe-luna-2026-10-20.md).

## Décision mise en œuvre

Le modèle embarqué fait autorité pour son document. Le modèle du dossier reste une source indépendante pour préparer d’autres documents. Le contrôle automatique et `pm docx verifier` ne lisent pas ce fichier du dossier. `pm docx comparer` expose une différence exacte de code, sans la résoudre implicitement. `pm docx extraire` écrit une nouvelle copie du code embarqué ; aucune commande ne remplace le modèle d’un document existant.

`pm docx preparer` prend un DOCX ordinaire, le modèle déclaratif existant et un petit manifeste JSON : paragraphes cités, tags de clauses, texte des valeurs et variable correspondante. La commande ajoute les contrôles Word, les repères de fin et les métadonnées ; elle conserve le code littéral du modèle, le texte du document et les propriétés de mise en forme des segments. Le moteur de raisonnement n’est pas modifié.

Une clause doit être unique et ses paragraphes contigus dans un même parent. Les valeurs sont recherchées dans leur clause ; plusieurs segments de mise en forme peuvent composer une valeur. Les sélections ambiguës, chevauchements, variables calculées, révisions en attente et champs Word dynamiques sont refusés. La commande refuse un document déjà lié, afin de ne pas transformer silencieusement une retouche en nouvelle référence. Elle écrit toujours un nouveau fichier et demande son ouverture dans le volet Fichiers.

Les chemins réels sont confinés au dossier enregistré, y compris les liens symboliques. Les sorties existantes ne sont pas écrasées. Cette protection concerne les nouvelles commandes ; elle ne corrige pas le confinement seulement lexical de l’ancien routeur de l’éditeur.

## Essais réels Microsoft Word par Luna

Modèle des sessions : `gpt-6-luna`. Données entièrement fictives ; documents, captures et rapports conservés hors dépôt dans le dossier d’audit local `docx-preparation-luna-2026-10-20`.

Luna a ouvert le scénario dans Microsoft Word, effectué les modifications par l’interface et enregistré le fichier. Première variante : prix 18 000 EUR, taux journalier 0,2 %, retard de 20 jours, plafond de 10 %, avec remplacement de « une pénalité est due » par « aucune pénalité n’est due ». Le contrôle rend le statut « à revoir », désigne seulement la clause de pénalité et restitue son texte complet modifié. Le code embarqué reste identique. La commande autonome sort avec le code 2 et ne modifie pas les octets contrôlés.

Seconde variante : restauration de la clause initiale dans Word en conservant les nouvelles valeurs, puis nouvel enregistrement. Le contrôle rend « testé », sans erreur ni manque dans ce scénario, et recalcule 720. Les clauses normalisées et le code embarqué sont identiques à leurs références. Le contrôle laisse le fichier inchangé. Word a présenté un avertissement de compatibilité lors de l’enregistrement sous un nouveau nom ; aucune perte de texte n’a été constatée dans ce scénario.

Un troisième cycle utilise le nouveau préparateur : retrait des anciennes balises d’une copie fictive, manifeste complet, puis `runDocxReasoningAction(preparer)` depuis le DOCX ordinaire. Luna ouvre le résultat dans Word, remplace au clavier 12 000 par 18 000 EUR et sauvegarde. Le test hors ligne rend « testé », recalcule 540, sans erreur, manque ni fausse modification de clause. Le code embarqué correspond exactement à la source copiée. Le contrôle laisse le fichier inchangé. Word ajoute des propriétés de langue `fr-FR`, sans différence de police, taille ou gras détectée. Rapport externe : `preparer-word-cycle-proof.md`.

## Vérification et limites

Sous Node 24.11.1, Luna a exécuté :

- `npm run test:reasoning-docx` : 88 réussis, aucun échec ni test ignoré, dont les tests existants du moteur inchangé et les cycles LibreOffice.
- `DocxReasoningStatus.test.tsx` : 7 réussis.
- `conversion-client.test.mjs` : 4 réussis.

La première passe avait deux expirations LibreOffice lors de conversions concurrentes et un nouveau scénario sans valeurs mal formé. Le scénario a été corrigé, sans modifier le moteur. Le script exécute désormais les fichiers de tests l’un après l’autre (`--test-concurrency=1`) ; toutes les conversions ont réussi ainsi.

Les tests couvrent la préparation depuis un DOCX non lié, les valeurs scindées en segments avec styles, les sélections ambiguës, les champs dynamiques, les révisions, la comparaison après divergence du modèle du dossier, l’extraction exacte, le refus d’écrasement, les chemins et le routeur HTTP local. Les tests de commande vérifient la transmission des arguments et l’ouverture du résultat dans le volet.

Le test reste local, déterministe et sans appel LLM : son exécution consomme zéro token de modèle. La préparation du manifeste par l’agent a un coût variable ; aucune nouvelle mesure de tokens n’a été réalisée pour cette commande. Les sources externes, les parties et la fiabilité des pièces ne sont pas relues. Une clause réécrite demande une appréciation ; le programme ne déduit pas automatiquement sa nouvelle portée juridique.

Les faits booléens liés, les révisions explicites du modèle embarqué et son édition dans l’interface ne sont pas ajoutés. Des repères requis absents ou corrompus provoquent une alerte ou un refus tant que le modèle est présent. Si un logiciel supprime le modèle embarqué lui-même, le document devient non lié et le contrôle n’est plus disponible ; il n’est pas reconstitué automatiquement depuis le dossier. Les essais Word établissent le comportement des scénarios testés, sans garantir tous les templates, objets Word ou versions de bureautique.

Le contrôle TypeScript frontend retrouve les 13 erreurs préexistantes hors DOCX et le contrôle serveur conserve une erreur préexistante dans `library/codex-options.ts:19`, sans erreur dans les nouveaux fichiers. Le lint ciblé ne rapporte aucun défaut dans les nouveaux fichiers ; des avertissements déjà présents restent dans `index.ts` et les anciens tests du pont. Le code est sur la branche de travail, sans publication ni déploiement dans l’application installée. Aucun build n’a été lancé.
