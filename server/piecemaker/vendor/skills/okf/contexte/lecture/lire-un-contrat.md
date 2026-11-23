---
type: Méthode
title: Lire un contrat, un avenant, un courrier
description: Ordre de lecture d'une pièce fondé sur les six patterns LOF ; méthode dérivée, proposée pour ce bundle.
tags: [methode, lecture, piece, patterns]
status: stable
generated: { by: agent:mistral-vibe, at: 2026-11-23T00:00:00Z }
sources:
  - { id: odp1, resource: "/patterns/odp-001.md", title: "ODP-001" }
---

# Lire une pièce avec les patterns

Méthode dérivée des patterns LOF pour ce bundle. Pour chaque pièce, suivre l'ordre :

1. **Qu'est-ce que la pièce ?** Un [document](/patterns/odp-001.md), jamais l'acte ni le contenu. Identifier sa nature affichée : contrat, avenant, courrier.
2. **Quels actes fonde-t-elle ?** Signature, modification, acceptation. Chaque acte est un processus daté.
3. **Qui tient quels rôles ?** Parties et [conferrals de rôles](/patterns/odp-002.md) : prestataire, client, débiteur.
4. **Quelles positions ?** Traduire chaque clause en [positions corrélatives](/patterns/odp-003.md) : claim/duty, power/liability.
5. **La chaîne est-elle complète ?** Pour chaque prétention, exiger la [chaîne minimale](/patterns/odp-004.md) : norme, rôle, déclencheur, acte, cible, effet, remède. Signaler chaque maillon manquant.
6. **Quelle version s'applique ?** Si la pièce modifie une autre : acte modificatif, dates de vigueur, [versions](/patterns/odp-005.md).
7. **Y a-t-il conflit ?** Deux clauses opposées : [relations entre normes](/patterns/odp-006.md), prévalence seulement si elle est elle-même du contenu juridique.

Le résultat attendu est une annotation de la pièce où chaque fait relevé cite le pattern qui le qualifie. Le test d'exécution de cette méthode sur des pièces fictives : `tests/rendu.py` à la racine du dépôt.

Applications exemple, dans ce bundle : [pièce contrat](/assets/piece-contrat.md), [pièce avenant](/assets/piece-avenant.md), [pièce courrier](/assets/piece-courrier.md).
