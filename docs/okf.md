# Bundle OKF du dossier

Le bundle OKF du dossier suit Context-OKF : Open Knowledge Format 0.3 sur le socle de la Legal Ontologies Foundry (LOF) de David R. Koepsell (CC BY 4.0). L'OKF dit comment représenter ; la LOF dit quoi représenter, par ses six patterns ODP-001 à 006.

## Autorité

Le bundle Markdown `.piecemaker/okf/` fait foi. L'agent l'écrit lui-même, avec Write ou Edit (Codex : apply_patch), en suivant le skill `okf` (`server/piecemaker/vendor/skills/okf/`). Le serveur ne régénère aucun concept : il lit le bundle pour l'onglet Index.

L'Index du dossier (la revue tabulaire de l'Index) reste dans SQLite (`server/piecemaker/okf/index-store.ts`) ; son `.json` dans `Tabular Review/` est une vue réécrite après chaque écriture.

## Périmètre

| Dossier | `type` | Contenu |
| --- | --- | --- |
| `documents/` | `Document` | une pièce analysée |
| `actes/` | `Acte` | signature, modification, notification |
| `contenus/` | `Contenu` | clause, obligation établie par l'acte |
| `roles/` | `Rôle` | partie et rôle conféré (ODP-002) |
| `positions/` | `Position` | claim, duty, power, liability (ODP-003) |
| `chaines/` | `Chaîne` | norme, déclencheur, acte, effet, remède (ODP-004) |
| `versions/` | `Version` | acte modificatif, dates de vigueur (ODP-005) |
| `conflits/`, `determinations/` | `Conflit`, `Détermination` | normes opposées, précédence (ODP-006) |

`index.md` porte `okf_version: "0.3"` ; chaque dossier a son `index.md` ; `log.md` date chaque maintenance. Un concept porte `type`, `title` et `description`, et selon le cas `resource` (chemin de la pièce depuis la racine du dossier, précédé de `/`), `date` (`AAAA-MM-JJ`) et `citation` (extrait littéral de la pièce). Un lien est un lien Markdown relatif vers un autre concept.

## Vérification

`pm okf verify`, ou le bouton Vérifier de l'onglet Index, lance `validate.py --strict` du skill `okf` sur le bundle. Chaque ligne `ERROR` (frontmatter, lien cassé) ou `LINT` (concept orphelin, champ recommandé absent) est rendue, puis le résumé. Le Hérisson le lance après chaque écriture sous `okf/`. Sans `index.md`, `verify` demande de créer le bundle.

## Lecture par l'interface

`GET /api/piecemaker/okf` lit les concepts valides. Pour chacun : identifiant (chemin dans le bundle), `type` (pour un Document, le type principal d'après l'arborescence), `lof` (le `type` du concept), titre, description, pièce, date et relations. Une relation suit chaque lien Markdown vers un autre concept ; elle porte le type de la cible, le Document de la même pièce et la citation du concept.

L'onglet Index garde le tableau, le graphe, la fiche et la visionneuse. Le bouton Ontologie montre le socle LOF (les six patterns, en lecture seule) et le Classement. Dans la visionneuse, « Lien OKF » sur un passage le met en pastille dans le chat, avec une demande à l'assistant : l'avocat ne pose plus de lien à la main.

## Types

Le type principal d’un document suit le champ `type` du dossier, hérité du parent. Sans ce champ, le nom du dossier de premier niveau reste le type. Sans arborescence, la classification par défaut s’applique. Un document hors arborescence reçoit `Non classé` ; la vérification le signale. `Non classé` est réservé.

Le graphe montre les documents des types du graphe (par défaut `Pièces`), les rôles, et les autres concepts sur demande.

L'avocat seul fixe l'arborescence, donc les types de documents. Elle est commune à tous les dossiers : c'est la clé `arborescence` de `~/.piecemaker/ontologie.json`, scellée. Au premier démarrage, la plus récente des anciennes `.piecemaker/arborescence.json` des dossiers devient l'arborescence commune ; ces fichiers ne sont plus lus. L'agent la lit avec `pm dossier arborescence` et modifie la clé `arborescence` de `ontologie.json` avec Edit, Write ou apply_patch : le hook `guard-ontologie` refuse l'écriture, applique la modification à la proposition en attente (ou au fichier actuel), la fait valider par `pm okf ontologie proposer` et répond à l'agent ce qui a changé. Sans hook, l'agent propose une arborescence complète avec `pm dossier arborescence --dossiers JSON --motif "…"` ou `pm okf ontologie proposer --json '{"arborescence":[…],"motif":"…"}'`. La proposition est écrite dans `ontologie.proposition.json` ; elle ne s'applique pas. L'onglet Index › Classement la montre en suivi des modifications : l'avocat accepte, refuse ou modifie chaque changement, puis enregistre, ce qui supprime la proposition (`DELETE /classification/proposition` du plugin Tabular review pour « Tout refuser »). L'enregistrement met à jour la colonne Classement des revues de tous les dossiers. Un bandeau de l'onglet Index signale une proposition en attente.

## Fichier commun

`~/.piecemaker/ontologie.json` (ou `$PIECEMAKER_HOME/ontologie.json`), un seul fichier commun à tous les dossiers : `{ "arborescence": [{ name, explanation, type? }], "sceau" }`. Les clés `relations` et `documentTypes` d'un fichier antérieur sont ignorées et disparaissent au prochain enregistrement. Un fichier illisible fait appliquer l'arborescence par défaut, avec un message.

Le serveur scelle le fichier à chaque enregistrement : `sceau` est un HMAC-SHA256 de l'arborescence, calculé avec la clé `ontologie.cle` du même répertoire (créée au premier enregistrement, mode 600). Un fichier dont le sceau ne correspond pas a été modifié hors de l'onglet Index : l'arborescence par défaut s'applique, `verify` et l'onglet Index le signalent, et l'avocat l'enregistre de nouveau.

- `verify` contrôle `ontologie.json` et `ontologie.proposition.json` : clés de premier niveau (`arborescence`, `motif`, `sceau`, `date`), sans clé inconnue, puis valeurs conformes aux règles.
- Le hook `guard-ontologie` refuse à l'agent toute écriture directe dans `~/.piecemaker/ontologie.json`, et tout accès à `ontologie.cle`. Il est branché sous Claude (`Write|Edit|MultiEdit|NotebookEdit|Bash|Read|Grep|Glob`), sous Codex (`Bash|apply_patch`, patch lu dans `tool_input.command`) et dans le chat Mistral (`mistral-sdk/tools.ts`, avec `protect-originals`).
- Une commande shell qui nomme l'un de ces fichiers n'est admise que si chacun de ses segments est une lecture (`cat`, `grep`, `jq` sans `-i`, `find` sans `-delete` ni `-exec`, `pm`…), sans redirection vers un fichier ni substitution de commande.

## Personnes et organisations (`persons/`)

`persons.ts` génère `okf/persons/` depuis la base du dossier à chaque `read` et `verify` : une fiche par personne (`cco: Person`) ou organisation (`cco: Organization`), nommée d'après son code, avec désignation, liens, citations et pièces qui la mentionnent. `persons/index.md` classe les fiches par auteur (`gliner` À trier, `agent` À vérifier, `human` Validé) et liste les éléments non rattachés. L'agent complète la base par l'outil `sql`, jamais les fichiers ; un Rôle lie sa fiche `/persons/<code>.md` et en prend le côté.

Un changement de code (`renameNode`) garde l'ancien code dans `data_json.codes_retires`. À la génération suivante, chaque lien du bundle vers l'ancienne fiche (`/persons/…` ou relatif) est réécrit vers la nouvelle, sauf si une fiche actuelle porte encore l'ancien nom.

## Suivi du dossier

Un événement du suivi renvoie à un concept daté par son titre : `evenements.<nom>.okf` = `title` du concept, qui porte `date`, `resource` et `citation` (`premiseDate`).

## Limites connues

- Un bundle au format 0.2 (fiches LOF, `_parties/`, `relations` en frontmatter) n'est pas repris : `verify` le signale jusqu'à ce que l'agent le reconstruise.
- Les tables SQLite de l'ancien OKF restent dans les bases existantes, sans lecteur.
- Les revues tabulaires ne se lient plus à un concept.
- Délier un élément dans l'onglet Dossier n'empêche pas le scan suivant de recréer le lien.
- Une commande qui fabrique le chemin de `ontologie.json` sans le nommer échappe au hook ; le sceau détecte alors une arborescence modifiée.

## Fichiers

| Rôle | Fichier |
| --- | --- |
| Lecture du bundle | `server/piecemaker/okf/bundle.ts` |
| Routes, validateur, `premiseDate` | `server/piecemaker/okf/index.ts` |
| Skill, validateur, contexte LOF | `server/piecemaker/vendor/skills/okf/` |
| Index du dossier (SQLite, vue `.json`) | `server/piecemaker/okf/index-store.ts` |
| Arborescence commune, sceau | `server/piecemaker/okf/ontology.ts`, `server/piecemaker/okf/sealed.ts` |
| Proposition de l'assistant | `server/piecemaker/okf/ontology-proposal.ts` |
| Garde d'écriture | `server/piecemaker/vendor/piecemaker-plugin/scripts/guard-ontologie.mjs` |
| Commande `pm okf` | `server/piecemaker/vendor/skills/Skill-PieceMaker/scripts/pm.mjs` |
| Tableau, graphe, appels | `plugins/piecemaker-dossier/src/okf.ts`, `okf-card.ts` |
| Socle LOF et Classement | `plugins/piecemaker-dossier/src/ontology.ts` |
| Visionneuse | `plugins/piecemaker-dossier/src/editors.ts` |
