---
okf_version: "0.3"
title: Context OKF
description: "Contexte juridique lisible par un agent : patterns d'ontologie légale de la Legal Ontologies Foundry, ontologie NAO, et méthode de lecture des pièces."
license: CC-BY-4.0
---
# Context OKF

Bundle de contexte : ce qu'il faut savoir du droit pour lire un document, pas comment le rédiger. Entrer par cette page, index d'abord, suivre les liens utiles seulement.

1. Les [fondations](/fondations/index.md) : BFO et la Legal Ontologies Foundry.
2. Les [patterns](/patterns/index.md) : six design patterns (acte, rôle, positions, chaîne, versions, conflits).
3. Les [ontologies](/ontologies/index.md) : NAO, la réponse aux manquements.
4. La [méthode de lecture](/lecture/index.md) : appliquer les patterns à une pièce, pas à pas.

Règle de construction : LOF est le socle de règles qui gouverne la construction de tout bundle OKF juridique — types, `resource`, liens, `sources`, paliers de confiance, cycle de vie, attestation, index, log (mapping complet : `skills/okf/references/socle-lof-okf.md`). Ce bundle en est l'implémentation de référence : il porte les objets LOF — fondations, patterns ODP-001..006, ontologies — d'où dérive la méthode de lecture. Chaque concept LOF porte sa source dans `assets/`.

Chaque fichier source (patterns, ontologie, pièces de test) vit dans [assets/](/patterns/index.md) ; aucun concept ne dépend d'une URL externe.

Historique : [log.md](/log.md).
