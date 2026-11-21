# check

```
pm check
```

Bilan court du dossier. La première ligne dit « Dossier : valide. » ou donne le nombre de points à traiter. Suit une ligne par point :

1. Anonymisation, mapping, conversion.
2. Index OKF, prémisses, contradictions, autres manques du graphe.
3. Chaque programme Catala, et ses conditions (`contexte … condition`) sans prémisse citée dans un scénario.
4. Chaque suivi : erreurs, manques, échéances dépassées, du jour ou sans date.
5. Revues de tabular review en mode recherche.
6. Étape du dossier au tableau (`etapes` de la Roadmap.json ; sans brain, `.piecemaker/etapes.json`).

Un point valide affiche « valide ». Un point en défaut donne le nombre d'erreurs, puis la commande `pm` du rapport détaillé, et le sous-agent qui corrige s'il y en a un.

- Lancez la commande du rapport détaillé avant de corriger.
- Signalez les défauts à l'avocat. Lancez un sous-agent seulement si sa tâche est celle demandée, ou sur accord de l'avocat.
- Le mapping se valide par l'avocat seul, dans l'onglet Dossier : ne le validez pas à sa place.
- Présentez les contradictions à l'avocat : ne choisissez pas une valeur à sa place.

Lancez la commande au début du travail sur un dossier, et après une correction pour confirmer.
