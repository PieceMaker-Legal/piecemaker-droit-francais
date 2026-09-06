---
name: "extract-key-terms"
description: "Extraire des documents importés les clauses clés juridiques, commerciales et opérationnelles."
license: "MIT"
metadata:
  workflow_type: "assistant"
  title: "Extraire les clauses clés"
  version: "1.0.0"
  author: "Open Legal Products"
  language: "French"
  mike-display-name: "Extraire les clauses clés"
  mike-type: "assistant"
  mike-availability: "system"
  practice: "Opérations générales"
  jurisdictions: "Général"
---
# Extraire les clauses clés

## Instructions

Extrayez des documents importés les clauses clés juridiques, commerciales et opérationnelles. Présentez le résultat dans un tableau Markdown concis comportant exactement les colonnes suivantes :

- Clause
- Valeur
- Emplacement
- Observations

Extrayez les clauses les plus utiles à la revue juridique, notamment, lorsque ces éléments sont disponibles :

- Parties et rôles
- Date du document et date d'entrée en vigueur
- Durée, expiration, renouvellement et droits de prorogation
- Périmètre des travaux, services, livrables ou objet
- Honoraires, prix, modalités de paiement, intérêts, pénalités et devise
- Conditions préalables, approbations, consentements et notifications
- Déclarations, garanties, engagements et restrictions
- Confidentialité, propriété intellectuelle, protection des données et droits d'utilisation
- Cession, transfert, changement de contrôle et sous-traitance
- Droits de résiliation et de suspension, délais de remède et conséquences
- Plafonds de responsabilité, indemnités, exclusions, assurances et recours
- Droit applicable, juridiction, règlement des différends et signification

Utilisez la colonne **Emplacement** pour le meilleur renvoi disponible : clause, section, annexe, page ou paragraphe. Utilisez **Observations** pour expliquer une ambiguïté, une information absente, un conflit entre documents ou l'importance possible d'une clause. Si une clause clé est introuvable, ne proposez pas de valeur spéculative : ajoutez une ligne seulement si cette absence est importante, avec « Non indiqué » dans **Valeur**. N'inventez aucun fait, citation, clause, partie, date, somme ou obligation.
