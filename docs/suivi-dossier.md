# Suivi du dossier

Le suivi relève les étapes d'un dossier qu'il ne faut pas manquer. Il se distingue du raisonnement : le raisonnement réfléchit dans un acte (`.piecemaker/raisonnements/<nom>.yaml`, plusieurs par dossier), le suivi liste les dates qui comptent pour le dossier (`.piecemaker/suivi.yaml`, un seul). Ce n'est pas une chronologie : n'y entrent que les actes à valeur procédurale (contentieux) et les dates liées à la validité du contrat (contrat), avec les échéances qui en découlent.

## Fichier

YAML 1.2, mêmes diagnostics de syntaxe que le raisonnement (indentation, guillemets, clés inconnues ou mal placées, commentaires refusés).

- `evenements.<nom>` : `date`, `preuve: [{ piece, citation }]` ou `hypothese: true` (acte non signé), `selon` facultatif, `intitule` facultatif.
- `echeances.<nom>` : `intitule`, puis
  - date fixée : `date` + `preuve` (ou `selon`) ;
  - date calculée : `de` (après) ou `avant` (à rebours), `delai` (`jours`, `jours_ouvres`, `mois`, `ans`), `selon`, `decompte: { depart: exclu|inclus, report: jour_ouvrable_suivant|jour_ouvrable_precedent|aucun, selon }`, `prolongation: { delai, selon }` facultative ;
  - `fait: { date, preuve }` facultatif.

Aucune règle de droit n'est codée : le moteur applique les réglages déclarés et exige que chacun soit justifié par une source citée. Il connaît seulement le calendrier (samedis, dimanches, jours fériés de métropole ; mois de quantième à quantième, dernier jour du mois à défaut).

## Vérification

`server/modules/piecemaker-reasoning/suivi.ts` (`verifySuivi`), calendrier dans `calendar.ts`.

- Erreurs : syntaxe et clés, référence `de`/`avant` inconnue, boucle, délai ou prolongation sans `selon`, date fixée sans preuve ni source, date écrite différente du calcul, pièce introuvable ou marquée non fiable, citation introuvable, source sans identifiant officiel, version non en vigueur à la date de départ, décision remise en cause.
- Manques : date d'événement non prouvée, citation qui ne montre pas la date, décompte absent ou non fondé, `depart`/`report` manquant, événement sans portée (ni échéance ni `selon`), accomplissement non prouvé, échéance dépassée non marquée faite, historique judiciaire à examiner, source sans connecteur.

Les sources passent par les mêmes connecteurs que le raisonnement (Légifrance, pièces du dossier).

## Service, commandes, onglet

- `suivi-service.ts` : tables `pm_suivi(project_id, revision, code, snapshot_json)` et `pm_suivi_faits(project_id, echeance, date, piece, at)` ; la lecture revérifie quand le fichier a changé (empreinte sha256).
- Routes `/api/piecemaker/suivi` (`GET /`, `GET /tous`, `POST /verify`, `POST /fait`) et route locale `/suivi` pour `pm suivi verifier` et l'outil MCP `suivi`.
- Onglet `plugins/piecemaker-echeances` : tous les dossiers ou le dossier ouvert, groupes par urgence, calcul et fondements dépliables, « Marquer faite » (enregistré à part, le fichier n'est jamais modifié), « Ouvrir le dossier » (dernière conversation du dossier), dates passées repliées.

## Limites

- Jours fériés de métropole seulement.
- « Ouvrir le dossier » exige une conversation existante dans le dossier.
- Pas de notification système : l'onglet est le seul rappel.
