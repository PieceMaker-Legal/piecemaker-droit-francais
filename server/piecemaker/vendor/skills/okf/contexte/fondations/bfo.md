---
type: Fondation
title: Basic Formal Ontology (BFO)
description: Ontologie de haut niveau dont dépendent tous les objets de la Legal Ontologies Foundry.
tags: [bfo, ontologie, fondation]
status: stable
generated: { by: agent:mistral-vibe, at: 2026-11-23T00:00:00Z }
sources:
  - { id: lof, resource: "https://github.com/legal-ontologies-foundry/legal-ontologies-foundry.github.io", title: "Legal Ontologies Foundry" }
---

# Basic Formal Ontology (BFO)

Ontologie de haut niveau, standard de facto des ontologies bio et juridiques. La LOF exige que toute ontologie membre soit fondée sur BFO : chaque classe LOF déclare sa classe BFO parente (continuant, occurrent, processus...).

Ce qu'il suffit de retenir pour lire ce bundle : BFO distingue ce qui existe dans le temps (continuants, par exemple un document) de ce qui se déroule (occurrents, par exemple un acte). Cette distinction fonde le [pattern acte juridique et document](/patterns/odp-001.md).

Les ontologies LOF citent BFO 2020 comme version de référence.

Ce concept ne porte pas de fichier source local : BFO est une dépendance externe appelée par chaque [pattern](/patterns/index.md) et chaque [ontologie](/ontologies/index.md) du bundle.
