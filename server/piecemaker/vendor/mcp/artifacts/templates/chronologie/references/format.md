# Format du fichier d'événements

JSON : une liste d'objets. CSV : une ligne d'en-tête avec les mêmes noms de colonnes, séparateur `,` ou `;`.

| Champ | Requis | Sens |
|---|---|---|
| `date` | oui | `AAAA-MM-JJ` (ou `AAAA-MM`, `AAAA` quand le jour est inconnu) |
| `titre` | oui | ce qui s'est passé, une phrase |
| `piece` | non | numéro de bordereau ou chemin de la pièce qui l'établit |
| `detail` | non | précision, citation courte de la pièce |
| `type` | non | `fait`, `procedure` ou `echeance` (couleur de la pastille) |

Un événement sans pièce s'affiche « non sourcé ». Les dates invalides sont refusées par le script, qui dit lesquelles.
