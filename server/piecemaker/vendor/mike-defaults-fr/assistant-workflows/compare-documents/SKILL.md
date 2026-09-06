---
name: "compare-documents"
description: "Comparer les documents importés dans un tableau structuré mettant en évidence similitudes, différences, risques et points de suivi."
license: "MIT"
metadata:
  workflow_type: "assistant"
  title: "Comparer les documents"
  version: "1.0.0"
  author: "Open Legal Products"
  language: "French"
  mike-display-name: "Comparer les documents"
  mike-type: "assistant"
  mike-availability: "system"
  practice: "Opérations générales"
  jurisdictions: "Général"
---
# Comparer les documents

## Instructions

Comparez les documents importés pour un relecteur juridique ou opérationnel. Concentrez-vous sur les stipulations, conditions, risques et points commerciaux qui diffèrent entre les documents. La comparaison doit fonctionner quel que soit le nombre de documents importés.

Présentez la comparaison sous forme de tableau Markdown avec exactement les colonnes suivantes :

- Sujet
- Une colonne pour chaque document importé, avec son nom ou un libellé court lisible comme en-tête
- Différence

Par exemple, si trois documents sont importés, le tableau doit avoir cette forme :

| Sujet | Document A | Document B | Document C | Différence |
| --- | --- | --- | --- | --- |

Comparez les documents sur les sujets pertinents suivants, lorsque ces éléments sont disponibles :

- Parties et rôles
- Date du document et date d'entrée en vigueur
- Durée, expiration, renouvellement et droits de prorogation
- Périmètre des travaux, services, livrables ou objet
- Honoraires, prix, modalités de paiement, pénalités et devise
- Conditions préalables, approbations, consentements et notifications
- Déclarations, garanties, engagements et restrictions
- Confidentialité, propriété intellectuelle, protection des données et droits d'utilisation
- Cession, transfert, changement de contrôle et sous-traitance
- Droits de résiliation et de suspension, délais de remède et conséquences
- Plafonds de responsabilité, indemnités, exclusions, assurances et recours
- Droit applicable, juridiction, règlement des différends et signification

Dans chaque colonne de document, indiquez la stipulation pertinente et le meilleur emplacement disponible, avec citation lorsque possible. Dans la colonne **Différence**, expliquez la divergence et sa portée juridique, opérationnelle ou commerciale lorsque cela est utile.

Après le tableau, ajoutez une section **Points clés** de cinq puces maximum résumant les différences importantes et les actions de suivi. Si un sujet n'est pas traité, écrivez « Non indiqué ». N'inventez aucun fait, clause, partie, date, somme ou obligation ; si les documents ne sont pas comparables, expliquez pourquoi et fournissez la comparaison la plus utile possible.
