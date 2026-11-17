# Projection Catala — indemnité de départ du directeur général

Le corpus est entièrement fictif. La projection repose sur les six pièces du dossier.

## Résultat du dossier

Le montant contractuel est de 480 000 euros bruts. Le droit au paiement reste inconnu avec les seules pièces du dossier.
Une condition inconnue reste inconnue ; un obstacle confirmé suffit à écarter la conclusion.
Les scénarios font varier des hypothèses ; leurs valeurs ne constituent pas des preuves nouvelles.

## Points non établis

- La non-participation du dirigeant à la délibération du conseil du 15 mars 2022 n’est pas prouvée. L’absence de participation au vote de l’assemblée ne suffit pas.
- Les documents ne permettent pas de qualifier l’effet de l’indemnité sur l’équilibre financier. Le rapport au capital de 1,2 % ne tranche pas cette question.
- La pièce 2 prouve un vote sur la politique de rémunération. Elle ne prouve pas, à elle seule, un vote individuel ex post distinct.
- Le régime du vote reste discuté : thèse contractuelle sans vote, vote individuel initial selon Versailles, ou vote après le départ soutenu par la société.

## Correction de l’attribution jurisprudentielle

L’arrêt de la cour d’appel de Versailles du 3 juin 2025, RG 23/06335, n’impose pas un nouveau vote après le départ. Il exige un vote ex post individuel initial et juge qu’un nouveau vote après le départ n’est pas nécessaire.
Il concernait une présidente de directoire : son raisonnement est discuté pour le directeur général du corpus, sans transformer cette transposition en fait établi.
La thèse doctrinale excluant tout vote ex post est exposée dans cet arrêt ; la cour ne l’adopte pas.
L’argument de la société ne doit donc plus être nommé « lecture de Versailles ».
L’arrêt de Lyon de 2002 est discuté ; il ne devient pas une interdiction universelle codée.

## Délais et limites

Le délai contractuel de trente jours après le 19 décembre 2022 expire le 18 janvier 2023.
Le modèle examine la prescription à la date de remise du dossier, le 21 octobre 2026. Cette remise ne constitue pas un acte interruptif.
La borne prudente part de l’exigibilité du 18 janvier 2023. Si cette borne est dépassée, le modèle conserve une inconnue sur la connaissance exacte et les éventuelles causes de suspension ou d’interruption.
Le programme n’affirme donc pas une prescription acquise à partir de la seule date portée sur la lettre de refus.

## Sources et exécution

Les articles 1103 et 2224 du code civil, L. 22-10-8, L. 22-10-34 et R. 22-10-14 du code de commerce ont été consultés par le MCP Légifrance.
La version de L. 22-10-8 du 1er janvier 2021 au 1er octobre 2025 est celle mobilisée pour l’engagement de 2022.
La décision de Versailles du 3 juin 2025 a été lue intégralement par le même outil. La décision commerciale du 15 novembre 2011, pourvoi 09-10.893, sert à discuter l’effet dissuasif.
Les citations de pièces concernent uniquement ce corpus fictif. La qualification juridique et les hypothèses restent soumises à l’appréciation du juriste.

Le programme unique est dans `.piecemaker/catala/indemnite-depart/indemnite.catala_fr`. Il réunit règles, sources, données et scénarios.
Lancer `pm catala verifier --programme indemnite-depart` dans une copie de ce dossier. Les résultats produits restent hors de l’archive suivie par Git.

## Origine des éléments

| Élément | Origine | Traitement dans la projection |
|---|---|---|
| Mandat, engagement, rémunération, performance, révocation, refus et impayé | Six pièces fictives existantes | Données fixes, chacune accompagnée d’un extrait exact |
| Fondements et discussion du vote | Textes officiels et décisions consultés | Citations rattachées aux définitions concernées |
| Conditions, calculs, dates, exception pour faute et scénarios | Mécanismes natifs Catala | Un seul fichier, avec plusieurs champs d’application liés |
| Attribut `#[doc]` | Catala natif | Documentation conservée près de chaque définition |
| Contenu `source:` et `quote:` ; obligation de présence | Convention PieceMaker | Rattachement des documents et contrôle des extraits |
| Statuts `Confirmé`, `Réfuté`, `Inconnu` et fonction `cumul` | Modélisation ajoutée pour ce dossier | Catala exécute cette logique ; aucune inconnue ne devient fausse |
| Quatre lectures du vote | Hypothèses ajoutées à partir de la discussion juridique | Une hypothèse favorable ne prouve aucune condition du dossier |
| Borne prudente de prescription | Choix de modélisation explicite | Calcul natif ; absence de conclusion automatique après cette borne |
| Cases, noms de documents, visionneuse et présentation des dépendances | PieceMaker | Présentation des résultats et de leur provenance Catala |

Le résultat de paiement porte sur l’indemnité restant impayée. Le rapport au capital reste une information descriptive.

## Scénarios

| Scénario | Paiement restant dû selon les hypothèses |
|---|---|
| Dossier en état | Inconnu |
| Thèse contractuelle favorable, autres conditions confirmées | Confirmé |
| Lecture de Versailles, vote individuel initial non établi | Inconnu |
| Lecture de Versailles, vote individuel initial prouvé | Confirmé |
| Vote exigé après le départ, refus constaté | Réfuté |
| Effet dissuasif retenu | Réfuté |
| Participation du dirigeant au conseil retenue | Réfuté |

## Contrôles réalisés

- Présence de `#[doc]` et de `quote`, typage et format : réussis.
- Sept scénarios Clerk et leur exécution Python : réussis.
- Citations : 29 sur 29 retrouvées dans les textes officiels consultés ou les documents fictifs.
- Graphe : sept scénarios affichés ; ouverture des pièces et décisions dans la visionneuse contrôlée par le DOM.

La preuve Z3 produit 64 obligations et ne signale aucun conflit. Elle reste non validée : `ErrorOnEmpty unsupported` concerne l’exception pour faute.
Le vérificateur automatique classe ce fichier contenant des scénarios comme fichier de test et omet sa preuve métier.
La preuve a donc été lancée explicitement : `pm catala preuve --programme indemnite-depart --fichier indemnite.catala_fr --scope AnalyseIndemnité`.
Le contrôle automatisé Catleg n’a pas été exécuté. Les versions des articles ont été consultées par le MCP Légifrance.
Les tests vérifient le modèle écrit. Ils ne tranchent ni la preuve des faits ni les interprétations juridiques discutées.
