# Suivi du dossier

Le suivi relève les étapes d'un dossier qu'il ne faut pas manquer. Il se distingue du raisonnement : le raisonnement réfléchit dans un acte (`.piecemaker/raisonnements/<nom>.yaml`, plusieurs par dossier), le suivi liste les dates qui comptent pour le dossier (`.piecemaker/<nom>-suivi.json`, un fichier par acte ou procédure suivi, `suivi.json` reste valide). Ce n'est pas une chronologie : n'y entrent que les actes à valeur procédurale (contentieux) et les dates liées à la validité du contrat (contrat), avec les échéances qui en découlent.

## Fichier

JSON : `{ matter, evenements, echeances }`. Une faute de syntaxe ressort à sa ligne. Les clés inconnues ou mal placées sont refusées dans `evenements` et `echeances`.

- `matter` : fiche de l'affaire sur le tableau (`name`, `client`, `practiceArea`, `responsible`, `status`, `stage`, `openedOn`, `summary`, `parties`, `nextStep`, `links`, `via`) et champs réservés à l'avocat.
- `matter.keyDates` : l'agent ne l'écrit jamais. La liste garde les dates manuelles de l'avocat, signalées en manque, et les champs du tableau (`confirmed`, `phase`, `page`, `docId`) des dates vérifiées.
- `evenements.<nom>` : `date`, `preuve: [{ piece, citation }]` ou `hypothese: true` (acte non signé), `selon` facultatif, `intitule` facultatif.
- `echeances.<nom>` : `intitule`, `kind` (`limitation`, `hearing`, `filing`, `other`), puis
  - date fixée : `date` + `preuve` (ou `selon`) ;
  - date calculée : `de` (après) ou `avant` (à rebours), `delai` (`jours`, `jours_ouvres`, `mois`, `ans`), `selon`, `decompte: { depart: exclu|inclus, report: jour_ouvrable_suivant|jour_ouvrable_precedent|aucun, selon }`, `prolongation: { delai, selon }` facultative ;
  - `fait: { date, preuve }` facultatif.

Migration : à la première lecture, un ancien `.piecemaker/suivi.yaml` devient `suivi.json` avec une fiche vide. L'ancien fichier est renommé `suivi.yaml.migre`, jamais supprimé.

Aucune règle de droit n'est codée : le moteur applique les réglages déclarés et exige que chacun soit justifié par une source citée. Il connaît seulement le calendrier (samedis, dimanches, jours fériés de métropole ; mois de quantième à quantième, dernier jour du mois à défaut).

## Vérification

`server/modules/piecemaker-reasoning/suivi.ts` (`verifySuivi`), calendrier dans `calendar.ts`.

- Erreurs : syntaxe et clés, référence `de`/`avant` inconnue, boucle, délai ou prolongation sans `selon`, date fixée sans preuve ni source, date écrite différente du calcul, pièce introuvable ou marquée non fiable, citation introuvable, source sans identifiant officiel, version non en vigueur à la date de départ, décision remise en cause.
- Manques : date d'événement non prouvée, citation qui ne montre pas la date, décompte absent ou non fondé, `depart`/`report` manquant, événement sans portée (ni échéance ni `selon`), accomplissement non prouvé, échéance dépassée non marquée faite, historique judiciaire à examiner, source sans connecteur.

Les sources passent par les mêmes connecteurs que le raisonnement (Légifrance, pièces du dossier).

## Service, commandes, onglet

- `suivi-service.ts` : tables `pm_suivi(project_id, fichier, revision, code, snapshot_json)` et `pm_suivi_faits(project_id, fichier, echeance, date, piece, at)`, créées et migrées au démarrage (l'ancienne ligne devient `fichier = suivi.json`) ; la lecture revérifie quand le fichier a changé (empreinte sha256).
- `suivi-board.ts` : présente chaque fichier de suivi au tableau unique « Dossiers » comme `projects/cabinet/matters/dossier-<sha16>`. Un dossier sans fichier de suivi n'y figure pas. La page ouvre directement ce tableau et affiche ses actions en boutons. Le serveur et la page refusent tout ajout manuel de dossier. Les autres documents (tableau, étapes, activité, demandes, documents déposés) vont dans la table `pm_board_docs(path, data_json)`.
- Écriture depuis le tableau : `matter` va dans le fichier. Une date vérifiée va dans `evenements` ou `echeances`. Une case cochée va dans `pm_suivi_faits`. Une suppression de carte renomme le fichier en `<fichier>.supprime`.
- Routes `/api/piecemaker/suivi` (`GET /`, `GET /tous`, `POST /verify`), `/api/piecemaker/suivi/board` (`GET ?rev=`, `POST { op, path, data, base }`) et route locale `/suivi` pour `pm suivi verifier|lire|ecrire` et l'outil MCP `suivi`.
- Onglet Suivi des dossiers (`plugins/piecemaker-echeances`) : un bandeau (erreurs, manques, dates à établir, Revérifier, Ouvrir le dossier) et le Matter board dans une iframe Blob. `src/board-shim.ts` remplace `window.claude.use('db')` par ces routes, avec relecture toutes les 2 s tant que la page est visible.
- État des dossiers : le bouton « Rédiger un état des dossiers » du bandeau insère la consigne dans le chat, sans l'envoyer (événement `piecemaker:composer-insert`, écouté par `piecemaker-context-suggestions`). La skill piecemaker en donne la méthode. La page n'affiche plus de ligne d'attente pour une demande ouverte.

## Page du tableau

`plugins/piecemaker-echeances/board/index.html` est une copie du Matter board, adaptée par `scripts/piecemaker/adapter-matter-board.mjs` :

```sh
node scripts/piecemaker/adapter-matter-board.mjs <page-source.html> plugins/piecemaker-echeances/board/index.html
```

Le script retire le bloc de coût et l'ajout de dossiers ou de tableaux, remplace les notes pour Claude par des renvois à `pm suivi` et à la skill piecemaker, ajoute la lecture des dates écrites en français et traduit l'interface avec la table `scripts/piecemaker/matter-board-fr.mjs`. Chaque motif doit être unique, sinon le script échoue. Une entrée de la table déclare son nombre d'occurrences. Les valeurs stockées (`status`, `kind`, `role`) restent en anglais. La page n'a pas de licence publiée : l'utilisateur a décidé de l'intégrer et assume ce point. `manifest.piecemakerAssets` la fait copier par la chaîne de plugins (`docs/plugins.md`).

## Limites

- Jours fériés de métropole seulement.
- « Ouvrir le dossier » exige une conversation existante dans le dossier ; il est dans le bandeau, pas sur la carte.
- Pas de notification système : l'onglet est le seul rappel.
- Polices d'origine absentes (`/_runtime`), remplacées par celles du système.
- Le tableau montre tous les dossiers : plus de portée « Ce dossier ».
- Les capacités de la page hors `db` renvoient `null` : ses boutons d'agent copient un texte à coller dans le chat.
