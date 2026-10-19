---
name: piecemaker
description: Outils du dossier PieceMaker — SQL (pièces, personnes, mentions), conversion, chronologie, volets (lire, pointer, fermer), tabular review, raisonnement juridique. Use when the user asks about case documents, the chronology, SQL on the dossier, converting pieces, opening or closing a panel, or a tabular review.
---

# PieceMaker

L’application PieceMaker doit tourner. `pm` vise le dossier de la session, même lancé depuis un autre répertoire (`--dossier PATH` pour un autre) :

```
<cette-skill>/scripts/pm <outil> …
<cette-skill>/scripts/pm --help
```

## Volets (interface à côté du chat)

Le geste ouvre le volet tout seul : `sql` (écriture), `chronologie`, `tabular_review` (lister, preparer, lancer, ouvrir), un `.docx` écrit ou édité, un tamponnage, `raisonnement` (volet Raisonnement du dossier). Une ligne `Visible : …` le confirme. N’appelez pas `afficher` après ces commandes.

`afficher` sert à lire, pointer ou fermer.

| Commande | Rôle |
| --- | --- |
| `pm afficher` | lire les volets déjà ouverts |
| `pm afficher --fichier PATH` | pointer ce fichier |
| `pm afficher --volet dossier` | pointer Dossier, vue générale |
| `pm afficher --volet chronologie` | pointer Dossier, chronologie des pièces |
| `pm afficher --volet tabular-review` | pointer Analyse tabulaire (sans reset) |
| `pm afficher --volet tabular-review --review FICHIER.json` | pointer cette analyse |
| `pm afficher --volet tampon` | pointer Bordereau |
| `pm afficher --fermer --fichier PATH` | fermer ce fichier |
| `pm afficher --fermer --volet dossier\|chronologie\|tabular-review\|tampon` | fermer ce volet |

Un `.docx` s’ouvre dans la visionneuse tout seul. Conversion n’ouvre aucun volet.

## sql

Noms réels masqués. `dossier()` = affaire courante ; `dossier('nom ou id')` = une autre.

```
piecemaker_nodes(project_id, id, kind, label, doc_date, aliases_json, data_json)
  kind 'document' = pièce (doc_date AAAA-MM-JJ ; data_json.nature, .localisation)
  sinon personne, société, coordonnée (data_json.partySide, .position, .legalForm)
piecemaker_links(project_id, from_node_id, to_node_id, relation)
  'mentions' = la pièce cite l’entité
piecemaker_citations(project_id, from_node_id, to_node_id, relation, texte, piece_id, source)
  source = pièce (piece_id) ou référence libre
```

Dates auto. Renommer une pièce = `UPDATE` de son `label` (`AAAA-MM-JJ_titre`).

```
pm sql --requete "SELECT id, label FROM piecemaker_nodes WHERE project_id = dossier() AND kind = 'document'"
```

## conversion

Convertit **et** scanne (GLiNER). Plusieurs minutes. Un scan à la fois. `--force` reconvertit les pièces déjà prêtes.

```
pm conversion
pm conversion --force contrat.pdf
```

## chronologie

`lister` : id, date, libellé, nature. `modifier` : date (`AAAA-MM-JJ`, vide pour l’effacer) et/ou libellé (renomme le fichier). `--dossier NOM` = un autre dossier.

```
pm chronologie lister
pm chronologie modifier --piece doc:1 --date 2024-03-01 --libelle 2024-03-01_Lettre
```

## tabular_review

`lancer` seulement si l’avocat l’a demandé.

```
pm tabular_review lister
pm tabular_review ouvrir --fichier "Tabular Review/analyse.json"
pm tabular_review ouvrir --projet ID
pm tabular_review documents
pm tabular_review modeles [--modele ID]
pm tabular_review enregistrer_modele --nom TEXT --questions JSON [--modele ID]
pm tabular_review preparer --mode analyse|recherche --nom TEXT [--projet ID] [--modele ID] [--description TEXT] [--questions JSON] [--documents a,b] [--recherche JSON]
pm tabular_review lancer --projet ID [--ia claude|codex|mistral] [--modele-ia TEXT]
```

`--questions` JSON : `[{nom, consigne, format, etiquettes}]`. `format` : `text` `list` `date` `amount` `yes_no` `tags`.

`--recherche` JSON : `query`, `sources` (`cassation` `appel` `conseil_etat` `caa` `premiere_instance`), `matieres` (cassation : `CIVIL` `COMMERCIAL` `PENAL` `SOCIAL`), `publicationBulletin` (`TOUS` `PUBLIE` `INEDIT`), `sieges`, `publicationConseilEtat` (`TOUS` `PUBLIE` `NON_PUBLIE`), `villesCaa`, `publicationCaa` (`TOUS` `PUBLIE` `NON_PUBLIE`), `typesPremiereInstance` (`TRIBUNAL_JUDICIAIRE` `TRIBUNAL_GRANDE_INSTANCE` `TRIBUNAL_INSTANCE` `TRIBUNAL_COMMERCE` `CONSEIL_PRUDHOMMES` `TRIBUNAL_CORRECTIONNEL` `TRIBUNAL_SECURITE_SOCIALE` `TRIBUNAL_BAUX_RURAUX` `JURIDICTION_PROXIMITE` `OUTRE_MER` `TRIBUNAL_CONFLITS`), `dateDebut`, `dateFin`, `dispositifOnly`.

## raisonnement

Le raisonnement du dossier s’écrit dans `.piecemaker/raisonnement.js` (objet JavaScript sans fonctions : `questions`, un terme par clé avec `si`, `sauf`, `l_une`, `selon`, `preuve`, `contredit`, des délais et montants calculés (`delai`, `montant`, `decompte`) à partir de `valeurs` prouvées, et `essais`). Volet Raisonnement à côté du chat.

| Commande | Effet |
| --- | --- |
| `pm raisonnement verifier` | lit le fichier sans l’exécuter, vérifie sources, citations, vigueur, pièces et personnes, exécute le test, réécrit le fichier dans son ordre et ne renvoie que les erreurs et manques, chacun avec son emplacement, sa ligne et le contenu de cette ligne |

Une citation exacte à la ponctuation près est corrigée dans le fichier. Les alertes écartées par l’avocat et la fiabilité des pièces se gèrent dans le volet.
