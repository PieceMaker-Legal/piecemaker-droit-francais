# Outil `sql`

Un seul outil MCP, `sql`, donne à Claude, Codex et Vibe un accès SQL libre à la
base PieceMaker (`auth.db`) : chronologie, personnes, mentions, citations,
renommage des pièces. Il remplace l'outil MCP `renommage` (la commande
`piecemaker renommage` reste). `conversion` reste à part : c'est un traitement,
pas un accès aux données. L'IA corrige ce que le scan a mal compris ; le scan
ne fait plus qu'ajouter (voir « Scan additif »).

## Chemin d'un appel

`server.mjs` (outil `sql`, paramètre `requete`, le `cwd` de la session est joint
automatiquement, il ne coûte aucun jeton) → `runSql`
(`vendor/installer/lib/conversion-client.mjs`, port trouvé comme pour
`conversion`) → `POST /api/piecemaker/local/sql` (`knowledge/local-routes.ts`,
monté avant l'authentification, boucle locale seulement, sans mot de passe) →
`createSqlTool` (`knowledge/sql-tool.ts`). Connexion `better-sqlite3` dédiée
(WAL, `busy_timeout`) ; les appels sont exécutés l'un après l'autre. Plusieurs
instructions sont acceptées ; `BEGIN`, `COMMIT`, `ROLLBACK` et `SAVEPOINT` sont
refusés (chaque écriture est déjà une transaction). Les échecs reviennent en
erreur d'outil (HTTP 400, champ `erreur`).

## Ce que l'IA voit

Description de l'outil (`SQL_DESCRIPTION`, écrite à la main) :
`piecemaker_nodes` (`kind='document'` = pièce, `doc_date` AAAA-MM-JJ,
`data_json.nature`, `.localisation` ; sinon personne, société, coordonnée),
`piecemaker_links` (`relation='mentions'` : la pièce cite l'entité),
`piecemaker_citations` (`texte`, `piece_id` ou `source`). Les dates
`created_at`/`updated_at` sont automatiques.

`piecemaker_citations` : un lien peut avoir autant de citations que voulu, ou
aucune (liens anciens, mentions ajoutées à la main). La source est une pièce
du dossier (`piece_id`) ou une référence libre (`source` : registre public,
URL, déclaration du client). Les liens trouvés au registre public portent la
source `Registre national des entreprises`.

## `dossier()`

Fonction SQL de la connexion, pour filtrer `project_id` sans le connaître :

| Appel | Désigne |
| --- | --- |
| `dossier()` | le dossier de la session : le `project_path` le plus long qui contient le `cwd` (sous-dossiers compris) ; sinon erreur `pas de dossier courant` |
| `dossier('3f2a9c')` | le dossier dont le `project_id` commence par ce préfixe (4 caractères hexadécimaux ou tirets minimum) |
| `dossier('Exemple')`, `dossier('PERSONNE_1')` | un dossier par son nom (`custom_project_name` ou nom du dossier), sans accents ni casse ; un code masqué est résolu vers toutes les variantes réelles de son nœud |

Économie de jetons : aucune liste de dossiers dans la description. Une erreur
`ambigu : 3f2a9c Nom ; 7b01de Nom` tient en une ligne (cinq candidats au plus) ;
`aucun dossier` ne dit rien d'autre.

## Masquage fait par le serveur

Le serveur masque lui-même, donc même sans proxy hudsucker (Claude desktop,
terminal ordinaire). Avant l'exécution, la requête est démasquée
(`PERSONNE_1` redevient `Jean Dupont`, y compris dans `entity:…` et dans les
comparaisons sur `masked_value` ou `$.code`) ; après, chaque valeur du résultat
est masquée (`applyMapping`) avec le dictionnaire du proxy
(`createSqliteDictionaryLoader`). Dans une session qui passe par hudsucker, les
deux opérations ne changent plus rien : les codes ne sont pas des valeurs du
dictionnaire.

- Les codes (`PERSONNE_1`) sont visibles dans le panneau d'appel d'outil ; la
  réponse rédigée par l'IA reste démasquée par le proxy.
- Limite : une valeur transformée en SQL (`substr`, `upper`) peut échapper au
  dictionnaire.

## Secrets

Une requête qui nomme `api_keys`, `user_credentials`, `users`, `vapid_keys`,
`piecemaker_telegram_bots` ou `app_config` est refusée (texte en minuscules,
sans guillemets, mot entier ; vérifié avant et après démasquage). SQLite n'a
pas de SQL dynamique : une vue, un trigger ou un `ATTACH` doivent nommer la
table eux aussi. Filet : toute valeur secrète lue dans ces tables (6 caractères
minimum) qui apparaît dans un résultat ou un message d'erreur devient `[secret]`.

## Écritures

Toute écriture est faite dans une transaction, après la sauvegarde
hebdomadaire. Des triggers **temporaires** (connexion de l'outil, jamais écrits
dans la base) complètent ce que l'IA n'a pas à savoir :

| Événement | Effet |
| --- | --- |
| `INSERT`/`UPDATE` d'un nœud | `search_text` recalculé (même normalisation que `knowledge.ts`), `updated_at` rafraîchi à l'`UPDATE` |
| `UPDATE` d'un lien ou d'un masque | `updated_at` rafraîchi |
| `DELETE` d'une entité | chaque nom et alias entre dans les valeurs du nœud « Exclusions GLiNER » du dossier |
| `DELETE` d'une mention | exclusion de lien `{piece, entite, relation}` pour le dossier |
| `INSERT` d'une personne ou d'une société | code libre attribué (logique de `party-codes.ts`), masque créé, nœud renommé `entity:CODE` ; nouvel identifiant ajouté au résultat. Masquer davantage est sans risque. |
| `UPDATE` du `label` d'une pièce | renommage par `pipeline.rename` à partir de l'ancien chemin (fichier, Markdown, état, nœud, citations) ; nouvel identifiant ajouté au résultat |

Un renommage refusé (nom hors `AAAA-MM-JJ_titre`, doublon, conversion en cours)
restaure le libellé et renvoie l'erreur. Supprimer une entité supprime aussi
ses masques (cascade) : son nom n'est plus masqué — voulu pour un faux positif.
Le dictionnaire du proxy est rafraîchi après chaque écriture.

## Citations

Dans l'onglet Dossier, chaque personne mentionnée affiche ses citations,
supprimables une à une. Un clic droit sur une sélection de la pièce propose
« Citer pour… » : le texte est enregistré comme citation de la mention, avec la
pièce pour source. Le scan, lui, ajoute pour chaque mention nouvelle la phrase
du Markdown converti qui contient la première occurrence du nom
(`excerpt.ts` ; une phrase au plus de 300 caractères).

## Scan additif et exclusions

`mergeScan` (`knowledge.ts`) n'écrase et ne supprime rien : nœud absent inséré,
nœud existant complété seulement là où il est vide (`doc_date` NULL, clés
absentes de `data_json`), alias ajoutés, liens et masques en `INSERT OR IGNORE`
(le masquage ne diminue jamais). Les scans partiels passent aussi par la
fusion. Corrections et mentions retirées survivent donc à un nouveau scan ;
une pièce supprimée en base revient au scan suivant tant que son fichier existe.

Deux niveaux d'exclusion :

- **Pour le dossier** : nœud « Exclusions GLiNER » (`EXCLUSIONS_NODE_ID`),
  `data_json.values` (termes), `.liens` (mentions retirées d'une pièce) et
  `.alias` (alias retirés). Le scan les saute ; la fusion conserve le nœud.
  Posées par l'éditeur (« Exclure de ce dossier ») et par les `DELETE` de l'IA.
- **Pour tous les dossiers** : termes institutionnels
  (`piecemaker_institutional_terms`, `PUT /institutional-terms`), choisis par
  l'avocat (« Exclure de tous les dossiers »). L'IA ne le fait pas.

`.piecemaker/document-index.json` ne sert plus qu'à transmettre le résultat du
scan Python au serveur. Les anciens `overrides` en attente y sont importés en
base au démarrage (`overrides-import.ts`, idempotent).

## Sauvegarde

À la première écriture de l'outil dans la semaine, `db.backup()` copie la base
dans `<racine de données>/backups/auth-AAAA-Sww.db` (droits 600). Les 4
dernières sont conservées. Elle permet de revenir sur une suppression faite par
erreur.

## Déclaration par dossier

Claude garde l'enregistrement `user` de l'installateur. Pour les autres agents,
`declarePieceMakerServer` (`mcp-declaration.ts`), appelée pour chaque dossier
surveillé par `startAgentInstructionsMirror`, déclare le serveur `piecemaker`
dans `.codex/config.toml`, `.vibe/config.toml`, `.cursor/mcp.json`, la
configuration OpenCode et `.grok/config.toml` (sans doublon côté Claude, sans
réécriture si l'entrée est déjà à jour).

## Limites connues

- `node` doit être dans le `PATH` de Codex et de Vibe (commande déclarée : `node`).
- Une session déjà ouverte ne voit l'outil qu'après redémarrage.
- Codex ne lit la configuration d'un dossier que si ce dossier est fiable.
- Valeurs transformées : voir « Masquage ».
