# DOCX et modèle de raisonnement

Pour les nouveaux documents liés, le modèle reste dans le dossier, par défaut
le raisonnement du dossier dans `.piecemaker/raisonnements/` s'il est unique, sinon celui indiqué par `--modele`. Le DOCX conserve uniquement sa référence relative,
son empreinte de version et les repères du texte ; aucun code du modèle n’y est
copié. Si le fichier est absent ou modifié, le contrôle est suspendu. Ne remplacez
pas l’empreinte pour faire disparaître une alerte : un changement de modèle demande
un réexamen.

```sh
pm docx preparer --fichier projet.docx --liens liens.json --sortie projet-lie.docx
pm docx verifier --fichier projet-lie.docx
pm docx comparer --fichier projet-lie.docx
pm docx extraire --fichier projet-lie.docx --sortie modele-extrait.yaml
```

Tous les chemins sont relatifs au dossier de la session (`--dossier` pour changer
de dossier). `--modele FILE.yaml` choisit le fichier du modèle dans le dossier pour
la préparation ou une autre source de comparaison. `preparer` ouvre le document produit dans le volet.

Lisez d’abord le DOCX avec `docx read`. Dans `liens.json`, désignez les passages
déjà rédigés par leurs paragraphes et les valeurs par leur texte exact. Les
questions internes du modèle ne nécessitent pas un paragraphe dans l’acte.
Exemple minimal pour un modèle qui déclare déjà la variable `prix` :

```json
{
  "clauses": [{
    "tag": "pm:clause-prix",
    "paragraphes": ["Le prix convenu est de 12 000 EUR, payable après réception."]
  }],
  "valeurs": [{
    "tag": "pm:prix", "valeur": "prix", "type": "nombre",
    "texte": "12 000 EUR", "clause": "pm:clause-prix"
  }]
}
```

Une clause peut couvrir plusieurs paragraphes contigus dans le même parent,
notamment une cellule de tableau. Une valeur peut traverser plusieurs runs de
mise en forme dans un paragraphe. Types : `nombre`, `pourcentage` avec `%`, `date`
ISO. Aucune règle ou formule du modèle n’est modifiée. La préparation
conserve le texte et la mise en forme, et écrit une copie liée au fichier externe.

`verifier` est local et ne réécrit rien : sources externes, parties et fiabilité
des pièces ne sont pas relues. Une clause réécrite ressort « à revoir ». La commande
`pm raisonnement verifier` porte sur le fichier du dossier, pas sur ce DOCX.

Ne pas confondre avec l'acte rédigé dans le raisonnement : celui-ci s'imprime par `pm acte exporter`, et les retouches de l'avocat reviennent par `pm acte fusionner`.
`comparer` compare les empreintes exactes, pas l’équivalence logique du code ; une
divergence ne permet jamais de tester silencieusement une version différente.
`extraire` crée une copie de la version liée si elle est disponible, sans écraser
celle du dossier. Pour un ancien DOCX, il récupère sa copie embarquée. Renommer
le DOCX dans le dossier, ou déplacer le dossier complet avec son modèle, conserve
la référence ; déplacer le DOCX seul ne suffit pas pour le vérifier.
