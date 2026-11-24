---
type: Fondation
title: Legal Ontologies Foundry (LOF)
description: Consortium ouvert d'ontologies juridiques interopérables fondées sur BFO ; statut founding, gouvernance en cours de ratification.
tags: [lof, ontologie, foundry, gouvernance]
status: stable
generated: { by: agent:mistral-vibe, at: 2026-11-23T00:00:00Z }
sources:
  - { id: readme, resource: "https://github.com/legal-ontologies-foundry/legal-ontologies-foundry.github.io/blob/main/README.md", title: "Legal Ontologies Foundry - README" }
---

# Legal Ontologies Foundry (LOF)

Initiative ouverte, coordonnée par William Mandrick, Barry Smith et David R. Koepsell. But : des ontologies du droit et de la pratique juridique interopérables, toutes fondées sur [BFO](/fondations/bfo.md).

État au 23 novembre 2026, à retenir avant tout usage :

- Le consortium est en formation : **aucune ontologie membre n'est publiée en téléchargement**. Principes et gouvernance sont des brouillons en attente de ratification.
- Six [design patterns](/patterns/index.md) sont affichés en discussion : quatre « accepted » (ODP-001 à 004), deux « draft » (ODP-005, 006). Ce sont des propositions de travail, pas des versions stables.
- Une ontologie candidate est déclarée : [NAO](/ontologies/nao.md).
- Licence du site et des contenus : CC BY 4.0, sauf mention contraire.

Le site public : https://legal-ontologies-foundry.github.io

Conséquence pour ce bundle : chaque concept pointe son fichier source daté dans `assets/` ; une évolution LOF invalide de facto la copie locale, à détecter par comparaison avec le dépôt amont.
