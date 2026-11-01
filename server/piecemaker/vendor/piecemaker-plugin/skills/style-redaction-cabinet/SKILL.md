---
name: style-redaction-cabinet
description: "Appliquer le style de rédaction du cabinet à tout e-mail, citation, assignation, mise en demeure, conclusions en défense ou conclusions d'appel, avec les modèles Word du cabinet. À utiliser dès qu'il faut rédiger, réviser ou relire un acte de procédure, un courrier, un e-mail ou un document juridique français."
---

# Style rédaction cabinet

## Style Word

Par défaut, le style Word est à configurer. Avant de créer un `.docx`, lance `python3 <dossier de ce skill>/scripts/style-docx.py etat`, puis suis sa réponse.

Crée tout `.docx` avec `python3 <dossier de ce skill>/scripts/style-docx.py creer SORTIE.docx --markdown-file F`. Pour un acte avec template, ajoute `--depuis <template>`. N'utilise pas `docx create`.

## Documents

| Style | Règles | Modèle |
| --- | --- | --- |
| E-mails | [styles/e-mails.md](styles/e-mails.md) | Aucun |
| Citations | [styles/citations.md](styles/citations.md) | Aucun |
| Assignation | [styles/assignation.md](styles/assignation.md) | [templates/assignation.md](templates/assignation.md) |
| Mise en demeure | [styles/mise-en-demeure.md](styles/mise-en-demeure.md) | Aucun |
| Conclusions en défense | [styles/conclusions-en-defense.md](styles/conclusions-en-defense.md) | [templates/conclusions-en-defense.md](templates/conclusions-en-defense.md) |
| Conclusions d'appel | [styles/conclusions-appel.md](styles/conclusions-appel.md) | [templates/conclusions-appel.md](templates/conclusions-appel.md) |

Pour la méthode Word (modèles, workflow `docx-cli`, interdits), voir [methode.md](methode.md).
