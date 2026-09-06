---
name: "proofread"
description: "Relire le document importé pour en vérifier la qualité rédactionnelle, la cohérence interne et les erreurs matérielles."
license: "MIT"
metadata:
  workflow_type: "assistant"
  title: "Relire"
  version: "1.1.0"
  author: "Anna Guo"
  language: "French"
  mike-display-name: "Relire"
  mike-type: "assistant"
  mike-availability: "system"
  practice: "Opérations générales"
  jurisdictions: "Général"
---
# Relire

## Instructions

Relisez le document importé pour en vérifier la qualité rédactionnelle, la cohérence interne et les erreurs matérielles. Concentrez-vous sur les points qu'un avocat ou un relecteur devrait corriger avant la diffusion, la signature ou le dépôt du document.

Traitez cette tâche comme un audit forensique, et non comme une lecture rapide. Une numérotation incohérente, des renvois obsolètes, des définitions inutilisées, des métadonnées datées dans le futur et des hyperliens masqués ne sautent pas aux yeux lors d'une seule lecture. Ils nécessitent des passes délibérées, chacune avec un angle différent. **Objectif :** à la fin, un second relecteur ne devrait trouver aucun élément important que vous auriez manqué.

## Principes de travail

- **Inspectez l'artefact, pas seulement le texte.** Pour les fichiers bureautiques, examinez aussi la structure sous-jacente — notamment les hyperliens et leurs cibles, les polices, les styles, les commentaires et les modifications suivies — en plus du texte rendu lorsque les outils disponibles le permettent. Le texte rendu peut masquer des défauts tels qu'une cible `mailto:` pointant vers le mauvais domaine, une police incohérente ou une modification non acceptée. Si seul du texte brut ou du contenu collé est disponible, indiquez-le explicitement et précisez que les contrôles des hyperliens, polices, révisions, commentaires et métadonnées n'ont pas pu être effectués.
- **Construisez d'abord les cartes de référence.** Vous ne pouvez pas repérer un renvoi obsolète sans carte des sections, ni une définition inutilisée sans carte des termes définis. Établissez ces cartes avant d'examiner les défauts individuels.
- **Effectuez des passes séparées, chacune avec un seul angle.** Essayer de tout repérer en une seule lecture conduit à manquer des problèmes. Traitez chaque catégorie de relecture comme une passe distincte.
- **Signalez les erreurs, ne les corrigez pas silencieusement.** Présentez les défauts afin que le relecteur puisse décider. Ne réécrivez pas le document.
- **Séparez les erreurs des préférences de style.** Une erreur est sans ambiguïté, comme une faute d'orthographe, un renvoi vers une clause inexistante ou une date incorrecte. Une préférence de style n'est un problème que si elle est incohérente dans le document.

## Étape 1 : Extraire et inspecter

Pour les fichiers bureautiques, examinez à la fois le contenu rendu et la structure sous-jacente lorsque cela est possible, notamment le texte des paragraphes, les cibles des hyperliens, les polices, les styles de paragraphe, les commentaires et les modifications suivies. Pour les PDF, examinez le texte extrait ainsi que les pages rendues et la structure du document. Pour les documents hébergés dans le cloud, examinez le document rendu et sa mise en page. Si le fichier n'est pas disponible et que seul du texte est fourni, poursuivez mais indiquez que les contrôles des métadonnées et de la mise en page visuelle n'ont pas pu être effectués.

## Étape 2 : Construire les cartes de référence

Avant d'examiner les problèmes individuels, construisez trois cartes :

- **Carte des entités** — chaque nom utilisé pour chaque partie, avec sa casse, sa ponctuation et son orthographe exactes, ainsi que l'endroit où chaque forme apparaît. Plusieurs variantes d'une même dénomination peuvent indiquer une erreur.
- **Carte des sections et de la numérotation** — chaque titre et son numéro dans l'ordre. Utilisez-la pour repérer les numéros manquants, les sauts, les doublons et les niveaux hiérarchiques mélangés. Si une table des matières existe, établissez une carte distincte pour la comparer.
- **Carte des termes définis** — chaque terme introduit comme définition, l'endroit où il est défini et chaque utilisation ultérieure. Utilisez-la pour repérer les variations de casse, les termes commençant par une majuscule mais non définis et les définitions inutilisées.

## Étape 3 : Catégories de relecture

Effectuez chaque catégorie comme une passe séparée. Appliquez l'**heuristique de l'empreinte de collage** lorsque plusieurs anomalies se concentrent dans le même paragraphe ou bloc. Par exemple, une variation de police et un hyperlien défectueux peuvent indiquer qu'un texte a été collé depuis une source externe. Élargissez l'examen à ce bloc pour rechercher des défauts connexes tels que des noms incorrects, une juridiction erronée, des guillemets incohérents ou des espaces superflus. Considérez ce regroupement comme une raison d'examiner plus attentivement, et non comme une preuve de l'origine du contenu, et regroupez les défauts connexes lorsque cela améliore la clarté du signalement.

| Catégorie | Points à vérifier | Exemple |
| --- | --- | --- |
| Définitions | Utilisation cohérente des termes définis, y compris la casse ; tous les termes commençant par une majuscule sont effectivement définis ; absence de définitions doubles, contradictoires ou circulaires ; définitions inutilisées ; adéquation des termes définis avec les dispositions opératoires. | « Informations financières » est défini une fois mais n'est plus utilisé → le supprimer ou l'utiliser là où il était prévu. |
| Renvois | Chaque clause, section, annexe, pièce jointe et référence documentaire existe, pointe vers le bon emplacement, utilise la bonne numérotation et reste exacte après les modifications apparentes. | Le préambule dit « Conditions d'utilisation » tandis que la clause 4 dit « Conditions de service » pour le même document → confirmer le titre et en employer un seul. |
| Cohérence interne | Termes, sections, dates, parties, montants, seuils, délais de préavis, conditions, recours ou obligations qui se contredisent ou produisent des résultats incohérents, y compris les conflits de périmètre. | Les « Informations confidentielles » incluent les sociétés affiliées dans la clause 1 mais les excluent dans la clause 9 → harmoniser le périmètre. |
| Parties et dénominations sociales | Cohérence des noms, formes sociales, informations d'immatriculation, qualités, adresses, signataires et intitulés de rôle ; variantes différant d'une lettre, d'un espace ou de la casse ; conflits entre l'entité du préambule et celle des définitions. | « Acme Holdings, Inc. » dans le préambule mais « Acme Holdings LLC » dans les définitions → confirmer l'entité correcte. |
| Nombres, dates et calculs | Montants, pourcentages, dates, échéances, délais, préavis, taux d'intérêt, formules, annexes et cohérence entre nombres en chiffres et en toutes lettres ; métadonnées datées dans le futur qui peuvent être incorrectes. | « Moins de 16 ans (dix-sept) » → le chiffre et le mot divergent ; confirmer le seuil voulu. |
| Grammaire et coquilles | Orthographe, grammaire, ponctuation, mots manquants, articles ou prépositions, mots ou expressions répétés, temps, accord sujet-verbe, participes mal rattachés, phrases tronquées ou inachevées, fragments, possessifs manquants et ponctuation finale manquante. | « ...tel qu'un numéro de téléphone ou un) » → la phrase est tronquée et la disposition peut être incomplète. |
| Numérotation | Numérotation des clauses, sections, sous-clauses, annexes, pièces jointes et tableaux ; numéros sautés, doublés ou hors séquence ; titres non numérotés qui devraient l'être ; marqueurs hiérarchiques mélangés. Si une table des matières existe, vérifier que ses numéros, titres et niveaux correspondent exactement. | Les sections passent de 5 à 7 sans section 6, ou deux clauses portent toutes deux la mention (vii) → signaler le numéro manquant ou doublé. |
| Mise en forme | Titres, listes, retraits, espacements, polices, emphases, tableaux et annexes, cohérence de la casse des titres, mots composés et césures ; cibles d'hyperliens ne correspondant pas au texte visible ; variation de police ; commentaires ou modifications suivies résiduels ; anomalies d'espacement. | Le texte visible indique `privacy@acme.com` mais la cible `mailto:` intégrée est `privacy@acme.com.ph` → corriger la cible masquée. |

## Catégories à examiner

Passez séparément en revue les définitions, les renvois, la cohérence interne, les parties et dénominations sociales, les nombres et dates, la grammaire et les coquilles, la numérotation et la mise en forme. Appliquez l'heuristique de l'empreinte de collage lorsqu'une même zone présente plusieurs anomalies : elle justifie un examen élargi, sans prouver l'origine du contenu.

## Niveaux de gravité

- **Critique** — incohérence ou erreur pouvant modifier substantiellement les droits, obligations, parties, délais ou l'opposabilité, telle qu'une mauvaise entité, un hyperlien de notification juridique vers le mauvais destinataire, une métadonnée opératoire incorrecte ou une numérotation rompant le système de renvois. Ne diminuez pas la gravité parce que la différence visible est minime.
- **Élevé** — erreur susceptible de créer une ambiguïté, une difficulté de négociation ou un risque de mise en œuvre, telle qu'une phrase tronquée, un conflit numérique, une définition importante inutilisée ou un défaut grammatical qui modifie le sens.
- **Moyen** — problème de relecture ou de cohérence à corriger, peu susceptible de modifier l'effet juridique principal.
- **Faible** — coquille, problème grammatical, de mise en forme, de ponctuation ou de style mineur.

## Livrable

Produisez un tableau Markdown concis avec exactement les colonnes suivantes :

- Gravité
- Catégorie
- Emplacement
- Problème
- Correction recommandée

Pour chaque problème, indiquez l'emplacement disponible le plus précis. Dans le problème, expliquez le défaut et son importance. Dans la correction recommandée, donnez une correction concrète sans réécrire tout le document. Triez par gravité, les problèmes critiques en premier.

Après le tableau, ajoutez une courte section **Résumé des problèmes les plus critiques** listant les deux à cinq points à corriger en priorité.

## Ce qui ne constitue pas une erreur

Pour que les constatations restent crédibles, ne signalez pas :

- les choix de style cohérents avec lesquels vous n'êtes pas d'accord, comme la virgule d'Oxford, l'anglais américain plutôt que britannique ou une liste à puces plutôt que numérotée, sauf incohérence interne ;
- la longueur d'une phrase ou sa lisibilité, sauf si elle est réellement obscure ou incorrecte ;
- les formulations valables qui ne sont qu'une question de préférence ; ou
- un renvoi par le numéro de niveau supérieur d'une clause lorsque cette clause existe et est suffisamment précise dans le contexte.

En cas d'incertitude sur le caractère fautif ou stylistique d'un point, indiquez cette incertitude au lieu de le présenter comme certain.

## Avant de finaliser

Confirmez avoir examiné séparément les définitions, renvois, numérotation, mise en forme, parties et entités, nombres et dates, grammaire et cohérence interne. Si une table des matières est présente, vérifiez que ses numéros et titres correspondent au document. Si vous avez inspecté l'artefact, confirmez que la passe de métadonnées disponible, notamment les hyperliens, polices, commentaires et modifications suivies, a été effectuée. Si aucun problème important n'est trouvé, fournissez une seule ligne de tableau l'indiquant et précisez les limites de la relecture, par exemple lorsque seules des données textuelles ont été fournies. Gardez la réponse centrée sur les corrections exploitables.
