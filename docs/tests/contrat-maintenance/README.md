# Exemple Catala — contrat de maintenance (mode contrat)

Contrat entièrement fictif. Il illustre la représentation d’un contrat en Catala, selon la programmation littéraire du livre Catala : chaque clause est une section `## Article N — Intitulé`, suivie de son texte exact entre « », puis du code qui la traduit.

- `.piecemaker/catala/penalites-maintenance/tache.json` : tâche de type `transactional`, objectif « Fixer la pénalité due pour un retard d’intervention ».
- `maintenance.catala_fr` : module `Maintenance`, champ `PénalitéDeRetard`.
  - Article 2 : prix annuel de 24 000 €.
  - Article 4 : délai d’intervention de 48 heures après un signalement écrit.
  - Article 5 : pénalité de 0,1 % du prix annuel par heure de retard, plafonnée à 10 % (étiquette `pénalité_contractuelle`).
  - Article 6 : dérogation pour force majeure (`exception pénalité_contractuelle`).
- `test_maintenance.catala_fr` : quatre cas de figure.

| Cas | Hypothèses | Pénalité attendue |
|---|---|---|
| `CasRetardSimple` | signalement écrit, intervention à 72 h | 576 € |
| `CasRetardPlafonné` | signalement écrit, intervention à 400 h | 2 400 € (plafond) |
| `CasForceMajeure` | retard de 400 h causé par la force majeure | 0 € |
| `CasSansSignalementÉcrit` | aucun signalement écrit | 0 € |

Dans le volet Catala, le graphe affiche la stipulation (l’objectif), son effet (le montant dû), les conditions de chaque clause, la dérogation de l’article 6 et les hypothèses du cas choisi. Les hypothèses ne demandent pas de pièce.

`catala.test.mjs` (skill PieceMaker) vérifie que ce programme passe le contrôle de documentation en mode contrat. Lancez `pm catala verifier` dans ce dossier pour le typage, les tests Clerk et la preuve.
