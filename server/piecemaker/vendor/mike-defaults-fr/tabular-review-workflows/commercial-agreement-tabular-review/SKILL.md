---
name: "commercial-agreement-tabular-review"
description: "Examiner les documents importés et extraire les informations structurées dans les colonnes de revue tabulaire définies dans table-columns.yaml."
license: "MIT"
metadata:
  workflow_type: "tabular"
  title: "Revue tabulaire d'un contrat commercial"
  version: "1.0.0"
  author: "Open Legal Products"
  language: "French"
  mike-display-name: "Revue tabulaire d'un contrat commercial"
  mike-type: "tabular"
  mike-availability: "system"
  practice: "Opérations générales"
  jurisdictions: "Général"
---
# Revue tabulaire d'un contrat commercial

## Objet

Utilisez ce workflow pour examiner les documents importés et extraire les informations structurées dans les colonnes de revue tabulaire définies dans `table-columns.yaml`.

## Instructions

- Appliquez chaque demande de colonne de `table-columns.yaml` à chaque document séparément.
- N'extrayez que les informations étayées par le texte du document.
- Incluez, lorsque disponible, les renvois aux clauses, les noms de sections, les dates, les montants, les noms des parties et les termes définis.
- Si aucune information pertinente n'est trouvée, renvoyez une valeur vide ou la réponse concise « Non trouvé ».
- Gardez les cellules concises tout en fournissant assez de contexte pour rendre chaque valeur exploitable.
- N'inventez aucune citation, aucun fait, aucune partie, date, droit, obligation ou conséquence financière.
- Produisez les résultats dans un fichier Excel (`.xlsx`) exportable. Si une sortie Excel est impossible, produisez un tableau Markdown.
