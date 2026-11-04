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
- Routes `/api/piecemaker/suivi` (`GET /`, `GET /tous`, `POST /verify`), `/api/piecemaker/suivi/board` (`GET ?rev=`, `POST { op, path, data, base }`) et route locale `/suivi` pour `pm suivi_dossiers verifier|lire|ecrire` et l'outil MCP `suivi`.
- Onglet Suivi des dossiers (`plugins/piecemaker-echeances`), trois vues : Tableau, Tâches, Échéances (voir « Tableau et tâches »). Les trois vues reprennent le style du Matter board : mêmes jetons (couleurs, polices, rayons) et mêmes composants (boutons, puces, colonnes, cartes, onglets segmentés), en clair et en sombre, dans `src/styles.ts`. Échéances : un bandeau (erreurs, manques, dates à établir, Revérifier, Ouvrir le dossier) et le Matter board dans une iframe Blob. `src/board-shim.ts` remplace `window.claude.use('db')` par ces routes, avec relecture toutes les 2 s tant que la vue est affichée, sans requête cumulée.
- État des dossiers : le bouton « Rédiger un état des dossiers » du bandeau insère la consigne dans le chat, sans l'envoyer (événement `piecemaker:composer-insert`, écouté par `piecemaker-context-suggestions`). La skill piecemaker en donne la méthode. La page n'affiche plus de ligne d'attente pour une demande ouverte.

## Tableau et tâches

Service `server/modules/piecemaker-reasoning/etapes.ts`, routes `/api/piecemaker/etapes`. État par dossier dans `.piecemaker/etapes.json` ; types de documents dans `<data root>/types-documents.json`, modèles dans `<data root>/modeles-documents/` ; file de tâches centrale dans `<data root>/todo.json` (`taches.ts`).

- Vue Tableau (`src/tableau.ts`), une carte par raisonnement, colonnes vides masquées. La carte reste minimale : nom du dossier, pastille de nature, acte, premier objectif (« +N » s'il y en a d'autres), alerte, tâche et nombre d'erreurs et de manques. Les actions de chaque étape sont dans le panneau.
  - Nature, d'après `qualification` du raisonnement, pastille arrondie aux couleurs de `docs/Design_Rule.md` : Contentieux en bleu, Contrat (`drafting`) en noir, Consultation en verre. Le libellé est écrit : la couleur n'est pas seule porteuse de sens.
  - Acte : clé racine `acte` du raisonnement, le document à produire (par exemple « Conclusions en défense ») ; son absence est un manque.
  - Préparation dossier : dossiers sans raisonnement ni étape choisie, en échec à `pm dossier verifier` ou au mapping non validé. Un scan postérieur à la validation (`scanned.updatedAt` de `.piecemaker/anonymization-state.json`) l'annule, côté serveur comme dans `pm`. Deux étapes, Anonymisation (conversion des pièces protégées, PDF et images, pseudonymisation et mapping validé) et Index, chacune avec sa pastille à gauche, verte si faite, vide sinon, et « Lancer » tant qu'elle ne l'est pas. Une étape faite devient un lien vers son onglet (Dossier, Analyse tabulaire). Quand la pseudonymisation est faite mais le mapping non validé, « Valider le mapping » remplace la pastille : le volet Dossier s'ouvre sur le mapping (`__piecemakerMappingShow`, événement `piecemaker:mapping-show`), dont le bouton du bas écrit `mappingValide` dans `.piecemaker/etapes.json`. La carte n'affiche jamais d'erreur ni de message d'attente : une vérification en échec garde le dernier état valide, enregistré dans `etats-dossiers.json` du dossier de données ; sans état connu, les deux pastilles restent vides, sans « Lancer ». Menu « Non juridique » à toutes les étapes, même sans raisonnement. Les six destinations restent disponibles sur les cartes à démarrer. L'étape choisie est conservée : une préparation incomplète ne bloque ni le raisonnement ni les étapes suivantes. Une carte en Préparation sans raisonnement propose « Démarrer le raisonnement ». La case « Afficher les exclus » (légende au survol), à droite du titre de la colonne, n'y affiche que les dossiers exclus ; un dossier exclu n'est plus vérifié.
  - Raisonnements : « N erreurs · M manques » dépliable, « Lever manques et erreurs », « Valider le raisonnement ». Un dossier prêt sans raisonnement donne une carte « À démarrer ».
  - Rédaction : documents choisis parmi les types (skills `redaction-*` de la Bibliothèque et types ajoutés avec modèle). Le skill est activé dans le dossier pour toutes les IA ; s'il manque, l'IA le crée et la Bibliothèque est rescannée en fin de tâche. « Lancer rédaction », « Ouvrir » quand le document est en cours, « Valider ».
  - Finalisation et En attente de tiers : prochaine action (« À faire » / « Effectué »), modifiable. « Intégrer une pièce » copie la pièce dans `Pièces/`, crée une nouvelle version du raisonnement (l'ancienne et ses documents restent) et crée une tâche de reprise. La relance automatique est cochée par défaut ; décochée, la tâche reste manuelle. Chaque nouveau document reçoit un chemin sans collision avec les anciennes versions. « Valider la finalisation » ou « Valider la suite » demande explicitement Attente ou « Plus d’étape ni d’attente : clore ». Une action effectuée ne clôt jamais automatiquement le dossier. La prochaine action reste disponible en Attente.
  - Clos. Le menu « ⋯ » déplace une carte vers toute étape, après confirmation.
  - Code couleur du Matter board (`src/attention.ts`, mêmes règles et seuils) : bordure orange (attention) ou rouge (urgent) et une pastille avec l'alerte la plus urgente, d'après la fiche du dossier. Un dossier exclu n'en a pas.
- Chargement instantané, sans bouton Actualiser :
  - Le serveur garde en mémoire l'état de chaque dossier (`pm dossier verifier`) et répond sans le recalculer. Sans état connu, les pastilles restent vides, sans message d'attente.
  - L'état est recalculé en arrière-plan, un dossier à la fois : au démarrage, 2 s après un changement dans le dossier (observateur de `folder-history`, hors `.git`), après une action du tableau, et au plus tard toutes les 5 min.
  - La ligne Conversion ne liste que les 10 premières pièces non converties.
  - La vue garde le dernier tableau dans `localStorage` (`pme-tableau`) et l'affiche dès l'ouverture. Elle se relit toutes les 5 s, sans lancer une requête tant que la précédente n'a pas répondu.
- Fenêtre de lancement commune (`src/lancer.ts`) : IA, modèle, consignes, case « automatique » cochée par défaut. Le modèle préféré est retrouvé par famille (`matchModel`, `mistral-medium-latest` ↔ `mistral-medium-3.5`).
- Vue Tâches (`src/taches.ts`) : Automatiques (une à la fois), Manuelles, Terminées. « Lancer immédiatement » passe la file.
- Questions des tâches : le prompt demande à l'IA de finir par une ligne « Question : … » quand l'avocat doit décider. La tâche passe alors au statut `question`, en colonne Questions : « Répondre » relance un tour dans la même session, « Terminer » la clôt. Pendant un tour, les demandes en attente de la session (AskUserQuestion, ExitPlanMode, autorisation d'outil) s'affichent sur la carte et se règlent depuis la vue (routes `repondre`, `decision`, `terminer`).
- Panneau du dossier, commun aux trois vues : un clic sur une carte du Tableau, une tâche ou une carte du Matter board (Échéances) ouvre le même tiroir à droite. Le clic sur le Matter board est intercepté : son propre panneau ne s'ouvre plus.
  - Style de `docs/Design_Rule.md` : panneau flottant `rounded-2xl` en verre, police Inter, titre en EB Garamond, boutons `rounded-full` de 28 px (principal en noir), anneau de focus bleu.
  - En-tête : nom du dossier, acte en titre (sinon premier objectif), pastille de nature.
  - Sections : Parties (noms et rôles de `matter.parties`, en clair, depuis le disque), Document à produire, Objectifs (tous), puis Étapes.
  - Étapes : les six, dans l'ordre. Bulle verte cochée si faite, vide sinon ; l'étape courante porte « En cours » et ses actions ; les suivantes sont grisées.
  - Une étape faite propose « Ouvrir le raisonnement » et ses documents.
  - Après « Intégrer une pièce », chaque version précédente du raisonnement s'affiche avec ses étapes et ses documents.
  - En dessous, quand le dossier a un suivi, la fiche du dossier en lecture seule : résumé, client, domaine, responsable, prochaine action, dates clés. Elle vient de `GET /api/piecemaker/suivi/board` (relu avec `?rev=`, seulement quand le panneau est ouvert), sans charger le Matter board. Le serveur donne l'identifiant de fiche de chaque carte (`matter`). La fiche se modifie dans la vue Échéances.
- « Ouvrir le raisonnement » pose `window.__piecemakerRaisonnementShow` et ouvre le volet Raisonnement, qui affiche ce raisonnement. Un autre dossier s'ouvre via sa dernière conversation.

## Page du tableau

`plugins/piecemaker-echeances/board/index.html` est une copie du Matter board, adaptée par `scripts/piecemaker/adapter-matter-board.mjs` :

```sh
node scripts/piecemaker/adapter-matter-board.mjs <page-source.html> plugins/piecemaker-echeances/board/index.html
```

Le script retire le bloc de coût et l'ajout de dossiers ou de tableaux, remplace les notes pour Claude par des renvois à `pm suivi_dossiers` et à la skill piecemaker, ajoute la lecture des dates écrites en français et traduit l'interface avec la table `scripts/piecemaker/matter-board-fr.mjs`. Chaque motif doit être unique, sinon le script échoue. Une entrée de la table déclare son nombre d'occurrences. Les valeurs stockées (`status`, `kind`, `role`) restent en anglais. La page n'a pas de licence publiée : l'utilisateur a décidé de l'intégrer et assume ce point. `manifest.piecemakerAssets` la fait copier par la chaîne de plugins (`docs/plugins.md`).

## Limites

- Jours fériés de métropole seulement.
- « Ouvrir le dossier » exige une conversation existante dans le dossier ; il est dans le bandeau, pas sur la carte.
- Pas de notification système : l'onglet est le seul rappel.
- Polices d'origine absentes (`/_runtime`), remplacées par celles du système.
- Le tableau montre tous les dossiers : plus de portée « Ce dossier ».
- Les capacités de la page hors `db` renvoient `null` : ses boutons d'agent copient un texte à coller dans le chat.
