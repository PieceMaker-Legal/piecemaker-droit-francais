---
name: piecemaker
description: Outils du dossier PieceMaker — SQL (pièces, personnes, mentions), conversion, chronologie, suivi du dossier (échéances), volets, tabular review et liaison DOCX au raisonnement. Use when the user asks about case documents, deadlines or the case follow-up, linked DOCX reasoning, the chronology, SQL on the dossier, converting pieces, opening or closing a panel, or a tabular review.
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

## DOCX et modèle de raisonnement

Pour les nouveaux documents liés, le modèle reste dans le dossier, par défaut
le raisonnement du dossier dans `.piecemaker/raisonnements/` s'il est unique, sinon celui indiqué par `--modele`. Le DOCX conserve uniquement sa référence relative,
son empreinte de version et les repères du texte ; aucun code du modèle n’y est
copié. Si le fichier est absent ou modifié, le contrôle est suspendu. Ne remplacez
pas l’empreinte pour faire disparaître une alerte : un changement de modèle demande
un réexamen. Un DOCX lié à un ancien modèle JS est refusé : transcrire le modèle en YAML, puis préparer à nouveau le document.

```sh
pm docx preparer --fichier projet.docx --liens liens.json --sortie projet-lie.docx
pm docx verifier --fichier projet-lie.docx
pm docx comparer --fichier projet-lie.docx
pm docx extraire --fichier projet-lie.docx --sortie modele-extrait.js
```

Tous les chemins sont relatifs au dossier de la session (`--dossier` pour changer
de dossier). `--modele FILE.js` choisit le fichier du modèle dans le dossier pour
la préparation ou une autre source de comparaison. Les sorties doivent être nouvelles : aucun fichier existant n’est
écrasé. Préparer un DOCX déjà lié est refusé pour ne pas remplacer sa référence ni
effacer la trace d’une retouche. `preparer` ouvre le document produit dans le volet.

Lisez d’abord le DOCX avec `docx read`. Dans `liens.json`, désignez les passages
déjà rédigés par leurs paragraphes et les valeurs par leur texte exact. Les
questions internes du modèle ne nécessitent pas un paragraphe dans l’acte.
Exemple minimal pour un modèle qui déclare déjà la variable `prix` :

```json
{
  "clauses": [{
    "tag": "pm:clause-prix",
    "paragraphes": ["Le prix convenu est de 12 000 EUR, payable après réception."]
  }],
  "valeurs": [{
    "tag": "pm:prix", "valeur": "prix", "type": "nombre",
    "texte": "12 000 EUR", "clause": "pm:clause-prix"
  }]
}
```

Une clause peut couvrir plusieurs paragraphes contigus dans le même parent,
notamment une cellule de tableau. Une valeur peut traverser plusieurs runs de
mise en forme dans un paragraphe. Types : `nombre`, `pourcentage` avec `%`, `date`
ISO. Aucune règle ou formule du modèle n’est modifiée. Un texte absent, ambigu,
des sélections qui se chevauchent, des révisions non résolues ou une valeur Word
dynamique sont refusés ; précisez la sélection au lieu de deviner. La préparation
conserve le texte et la mise en forme, et écrit une copie liée au fichier externe.

`verifier` est local et ne réécrit rien : sources externes, parties et fiabilité
des pièces ne sont pas relues. Une clause réécrite ressort « à revoir ». La commande
`pm raisonnement verifier` porte sur le fichier du dossier, pas sur ce DOCX.

Ne pas confondre avec l'acte rédigé dans le raisonnement : celui-ci s'imprime par `pm acte exporter`, et les retouches de l'avocat reviennent par `pm acte fusionner`.
`comparer` compare les empreintes exactes, pas l’équivalence logique du code ; une
divergence ne permet jamais de tester silencieusement une version différente.
`extraire` crée une copie de la version liée si elle est disponible, sans écraser
celle du dossier. Pour un ancien DOCX, il récupère sa copie embarquée. Renommer
le DOCX dans le dossier, ou déplacer le dossier complet avec son modèle, conserve
la référence ; déplacer le DOCX seul ne suffit pas pour le vérifier.

## suivi (échéances du dossier)

Le suivi relève les étapes du dossier qu'il ne faut pas manquer ; il ne raisonne pas (c'est le rôle du raisonnement, propre à un acte) et n'est pas une chronologie. Un seul fichier par dossier : `.piecemaker/suivi.yaml`. Il apparaît, avec ceux des autres dossiers, dans l'onglet Échéances.

N'y figurent que :
- en contentieux, les actes qui ont une valeur procédurale (ceux qui font courir un délai ou fixent une étape) et les échéances qui en découlent ;
- en contrat, les dates qui ont un lien avec sa validité ou son existence, et les échéances qui en découlent.

Recherche toi-même, avec les outils Légifrance, le texte, la décision ou la clause qui fixe chaque délai et sa manière de le compter : le moteur ne connaît aucune règle de droit, il recalcule et signale ce qui n'est pas justifié.

```yaml
evenements:
  nom de l’événement:
    date: AAAA-MM-JJ
    preuve:
      - piece: pieces/…
        citation: passage exact qui porte la date
echeances:
  nom de l’échéance:
    intitule: Ce qu'il faut faire, en clair
    de: nom de l’événement
    delai:
      mois: 1
    selon:
      - source: identifiant officiel (LEGIARTI…, JURITEXT…) ou chemin de la pièce pour une clause
        citation: passage exact qui fixe le délai
    decompte:
      depart: exclu
      report: jour_ouvrable_suivant
      selon:
        - source: …
          citation: passage exact qui fixe ce décompte
  autre_echeance:
    intitule: …
    date: AAAA-MM-JJ
    preuve:
      - piece: pieces/…
        citation: passage exact qui porte la date
```

- Échéance calculée : `de` (après un événement ou une échéance) ou `avant` (à rebours d'une échéance), `delai` en `jours`, `jours_ouvres`, `mois` ou `ans`, `selon` obligatoire, `decompte` avec `depart` (`exclu` : le jour de départ ne compte pas ; `inclus`), `report` si le terme tombe un samedi, un dimanche ou un jour férié (`jour_ouvrable_suivant`, `jour_ouvrable_precedent`, `aucun`) et son `selon`. `prolongation: { delai, selon }` ajoute un délai supplémentaire justifié.
- Échéance fixée : `date` et la `preuve` qui la porte (calendrier, ordonnance, avis).
- Un événement sert à au moins une échéance (`de` / `avant`) ou cite le texte qui lui donne effet (`selon`) ; sinon retire-le.
- Contrat non signé : `hypothese: true` au lieu de `preuve` ; les échéances qui en partent sont des dates supposées.
- Accomplissement : `fait: { date, preuve }` ; l'avocat peut aussi la marquer faite dans l'onglet.
- Ne recopie pas les dates calculées : si tu écris `date` sur une échéance calculée, elle doit égaler le calcul.

`pm suivi verifier` recalcule chaque échéance (calcul affiché pas à pas), relit pièces et sources (identifiant officiel, citation exacte, version en vigueur à la date de départ, historique judiciaire, fiabilité) et ne renvoie que les erreurs et manques, localisés à la ligne. Corrige et relance jusqu'à ne plus avoir d'erreur.

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

