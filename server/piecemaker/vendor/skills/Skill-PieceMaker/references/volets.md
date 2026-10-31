# Volets

`afficher` sert à lire, pointer ou fermer.

| Commande | Rôle |
| --- | --- |
| `pm afficher` | lire les volets déjà ouverts |
| `pm afficher --fichier PATH` | pointer ce fichier |
| `pm afficher --volet dossier` | pointer Dossier, vue générale |
| `pm afficher --volet index` | pointer Dossier, dates des pièces (pour lire toutes les pièces : `pm tabular_review_index ouvrir`) |
| `pm afficher --volet tabular-review` | pointer Analyse tabulaire (sans reset) |
| `pm afficher --volet tabular-review --review FICHIER.json` | pointer cette analyse |
| `pm afficher --volet tampon` | pointer Bordereau |
| `pm afficher --fermer --fichier PATH` | fermer ce fichier |
| `pm afficher --fermer --volet dossier\|index\|tabular-review\|tampon` | fermer ce volet |
