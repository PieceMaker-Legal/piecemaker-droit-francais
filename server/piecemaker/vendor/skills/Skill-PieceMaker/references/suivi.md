# Suivi (échéances du dossier)

Le suivi relève les étapes du dossier qu'il ne faut pas manquer ; il ne raisonne pas (c'est le rôle du raisonnement, propre à un acte) et n'est pas une chronologie. Un fichier par acte ou procédure suivi : `.piecemaker/<nom>-suivi.json` (`.piecemaker/suivi.json` reste valide). Chaque fichier donne une carte sur le Matter board de l'onglet Suivi des dossiers, qui montre tous les dossiers. Quand le dossier en compte plusieurs, cible le fichier : `pm suivi verifier --suivi <nom>-suivi.json`. Les données restent sur le poste.

N'y figurent que :
- en contentieux, les actes qui ont une valeur procédurale (ceux qui font courir un délai ou fixent une étape) et les échéances qui en découlent ;
- en contrat, les dates qui ont un lien avec sa validité ou son existence, et les échéances qui en découlent.

Recherche toi-même, avec les outils Légifrance, le texte, la décision ou la clause qui fixe chaque délai et sa manière de le compter : le moteur ne connaît aucune règle de droit, il recalcule et signale ce qui n'est pas justifié.

```json
{
  "matter": {
    "client": "Société Exemple SAS",
    "practiceArea": "Litigation",
    "summary": "Une ou deux phrases sur l'affaire.",
    "parties": [{ "name": "Jean Dupont", "role": "adverse", "entityType": "person" }],
    "nextStep": { "text": "Préparer la déclaration d'appel", "due": "AAAA-MM-JJ" }
  },
  "evenements": {
    "nom de l’événement": {
      "date": "AAAA-MM-JJ",
      "preuve": [{ "piece": "pieces/…", "citation": "passage exact qui porte la date" }]
    }
  },
  "echeances": {
    "nom de l’échéance": {
      "intitule": "Ce qu'il faut faire, en clair",
      "kind": "filing",
      "de": "nom de l’événement",
      "delai": { "mois": 1 },
      "selon": [{ "source": "identifiant officiel (LEGIARTI…, JURITEXT…) ou chemin de la pièce pour une clause", "citation": "passage exact qui fixe le délai" }],
      "decompte": {
        "depart": "exclu",
        "report": "jour_ouvrable_suivant",
        "selon": [{ "source": "…", "citation": "passage exact qui fixe ce décompte" }]
      }
    },
    "autre_echeance": {
      "intitule": "…",
      "kind": "hearing",
      "date": "AAAA-MM-JJ",
      "preuve": [{ "piece": "pieces/…", "citation": "passage exact qui porte la date" }]
    }
  }
}
```

- Échéance calculée : `de` (après un événement ou une échéance) ou `avant` (à rebours d'une échéance), `delai` en `jours`, `jours_ouvres`, `mois` ou `ans`, `selon` obligatoire, `decompte` avec `depart` (`exclu` : le jour de départ ne compte pas ; `inclus`), `report` si le terme tombe un samedi, un dimanche ou un jour férié (`jour_ouvrable_suivant`, `jour_ouvrable_precedent`, `aucun`) et son `selon`. `prolongation: { delai, selon }` ajoute un délai supplémentaire justifié.
- Échéance fixée : `date` et la `preuve` qui la porte (calendrier, ordonnance, avis).
- `kind` d'une échéance : `limitation` (prescription ou forclusion), `hearing` (audience, réunion d'expertise, médiation), `filing` (acte à déposer ou signifier) ou `other`.
- Contrat non signé : `hypothese: true` au lieu de `preuve` ; les échéances qui en partent sont des dates supposées.
- Accomplissement : `fait: { date, preuve }` si une pièce le prouve ; sinon l'avocat coche la date sur le tableau.

`pm suivi verifier` recalcule chaque échéance (calcul affiché pas à pas), relit pièces et sources (identifiant officiel, citation exacte, version en vigueur à la date de départ, historique judiciaire, fiabilité) et ne renvoie que les erreurs et manques, localisés à la ligne. Corrige et relance jusqu'à ne plus avoir d'erreur.

## Fiche `matter` et Matter board

`matter` décrit l'affaire sur le tableau : `name`, `client`, `practiceArea`, `responsible`, `status` (`open` ou `closed`), `stage`, `openedOn`, `summary`, `parties`, `nextStep`, `links`, `via`. Omets ce que la source ne dit pas. Le nom du dossier sert de `name` par défaut.

- `parties` : `[{ name, role, entityType, aliases }]`. `role` : `client`, `adverse`, `related`, `co-party`, `insurer`, `opposing-counsel`, `witness` ou `other`. `entityType` : `person` ou `organisation`.
- `nextStep` : `{ text, due }`. `links` : `[{ label, url }]`, en https, adresses données par la source.
- Une valeur `responsible` qui commence par `user:` désigne un confrère : ne l'affiche pas et ne la change pas.
