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

Théorie juridique du dossier, pas à pas ; chaque commande renvoie l’état et ce qui reste à faire. Volet Raisonnement à côté du chat.

| Commande | Options |
| --- | --- |
| `pm raisonnement etat` | `--question Q1`, `--vue complete` (règles, pièces, citations, force probante) ; par défaut l’arbre synthétique |
| `pm raisonnement question` | `--texte` question de droit, `--objectif oui\|non`, `--date` nom du fait date de référence, `--question Q1` pour modifier |
| `pm raisonnement type` | `--nom` Majuscule, `--champs "montant contenu argent, payee contenu booléen"` (structure) ou `--cas "Amiable, Judiciaire contenu date"` (énumération) |
| `pm raisonnement condition` | `--question`, `--nom`, `--libelle`, `--regle` (expression Catala : et, ou, non, = < >, \|AAAA-MM-JJ\|, 2 mois, 1 000 €, 30%, si/alors/sinon, listes, `x.champ`, `x sous forme Cas`, `f de x`, `q1.reponse`…), `--source` LEGIARTI…/JURITEXT…/note, `--extrait` exact, `--role condition\|fondement\|moyen_adverse\|assertion`, `--a-la-date` ; `--type` (valeur calculée, ex. argent), `--parametres "montant contenu argent"` (fonction), `--etiquette`, `--exception-de base\|étiquette`, `--consequence non`, `--etat`, `--si` |
| `pm raisonnement fait` | `--question`, `--nom`, `--type booléen\|date\|entier\|décimal\|argent\|durée\|liste de T\|Structure\|Énumération`, `--valeur` (constante Catala pour les types composés), `--piece` chemin, `--extrait` exact, `--force-probante acte_authentique\|acte_sous_seing_privé\|commencement_de_preuve\|indice\|sans_valeur`, `--appreciation` |
| `pm raisonnement retirer` | `--question`, `--nom` (sans nom : toute la question), `--etiquette`, `--etat` ; ou `--type Nom` |
| `pm raisonnement tester` | vigueur, recours, extraits, personnes morales ; liste les alertes |

Un nom inconnu dans `--regle` devient un fait à prouver. Sans pièce, ne donnez pas de valeur. Un élément validé ou écarté par l’avocat est verrouillé.
