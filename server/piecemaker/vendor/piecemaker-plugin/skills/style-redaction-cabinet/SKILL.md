---
name: style-redaction-cabinet
description: "Appliquer le style de rédaction du cabinet à tout document, avec les modèles Word du cabinet. À utiliser dès qu'il faut rédiger, réviser ou relire un acte de procédure, un courrier ou un document juridique français."
---

# Style rédaction cabinet

## Style Word

Par défaut, le style Word est à configurer. Avant de créer un `.docx`, lance `python3 <dossier de ce skill>/scripts/style-docx.py etat`, puis suis sa réponse.

Crée tout `.docx` avec `python3 <dossier de ce skill>/scripts/style-docx.py creer SORTIE.docx --markdown-file F`. Pour un acte avec template, utilise `--depuis <template>` sans `--markdown-file`, puis remplace les placeholders `{{...}}` avec `docx-cli`. N'utilise pas `docx create`.

## Documents

| Document | Règles | Template |
| --- | --- | --- |
| E-mails | [styles/e-mails.md](styles/e-mails.md) | Aucun |
| Citations | [styles/citations.md](styles/citations.md) | Aucun |
| Assignation | [styles/assignation.md](styles/assignation.md) | Aucun |
| Mise en demeure | [styles/mise-en-demeure.md](styles/mise-en-demeure.md) | Aucun |
| Conclusions en défense | [styles/conclusions-en-defense.md](styles/conclusions-en-defense.md) | [templates/conclusions-en-defense.docx](templates/conclusions-en-defense.docx) |
| Conclusions d'appel | [styles/conclusions-appel.md](styles/conclusions-appel.md) | Aucun |

En cas de document demandé par l'utilisateur non listé, ajoute une ligne au tableau, et note dans la colonne Règles : "Règle à rédiger à partir de la session <ID de ta session>".

Si la mention existe, propose à l'utilisateur d'ouvrir une session séparée pour rédiger le style, avec instruction de lire [new-style.md](new-style.md).
