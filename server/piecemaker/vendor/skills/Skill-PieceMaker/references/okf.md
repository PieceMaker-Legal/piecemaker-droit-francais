# Index OKF (`pm okf`)

L'index du dossier suit le format Open Knowledge Format 0.2. Il vit dans `.piecemaker/okf/` : une fiche Markdown par document et un `index.md`. Le scan GLiNER écrit les fiches sans appel à un modèle. Ne les écris pas à la main : passe par `pm okf`.

## Fiche

```markdown
---
type: Pièces
title: Courrier.pdf
description: Courrier
resource: Pièces/Courrier.pdf
date: 2021-06-01
generated:
  by: piecemaker/gliner
  at: 2026-01-01T00:00:00.000Z
relations:
  se-refere-a:
    - cible: /Pièces/Contrat.pdf.md
      citation: Nous faisons suite au contrat de prestation du 12 mars 2021.
      origine: piecemaker/gliner
---
# Atomes

## PERSONNE_PHYSIQUE_01

> Phrase du document qui cite la personne.
```

- `type` : dossier de premier niveau de l'arborescence choisie par l'avocat (`.piecemaker/arborescence.json`). Aucun autre type n'existe. Un document hors arborescence reçoit `Non classé` ; `verifier` le signale.
- Identifiant d'une fiche : `/<chemin du document>.md`, depuis la racine du dossier.
- Atomes : une citation mot pour mot par entité repérée dans le document.

## Liens

Trois relations, de la source vers la cible : `modifie`, `repond-a`, `se-refere-a`. Chaque lien porte une citation mot pour mot du document source. Seuls les documents des types du graphe (par défaut `Pièces`) portent des liens.

Le scan pose `se-refere-a` quand une phrase contient la date et la nature d'un seul autre document. Ajoute un lien seulement si tu as lu la phrase qui le fonde :

```bash
pm okf lier "Pièces/Avenant.pdf" modifie "Pièces/Contrat.pdf" --citation "L'article 3 du contrat est remplacé."
pm okf delier "Pièces/Courrier.pdf" se-refere-a "Pièces/Contrat.pdf"
```

Un lien du scan retiré reste écarté : le scan ne le repose pas.

## Vérifier

```bash
pm okf verifier
```

La commande ne renvoie que les erreurs : type hors arborescence ou différent du dossier du document, document absent, document sans fiche, relation inconnue, cible absente ou hors graphe, citation introuvable dans le document, `index.md` incomplet. Corrige la cause (classement, lien, analyse du dossier), puis relance.
