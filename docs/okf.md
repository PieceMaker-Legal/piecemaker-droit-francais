# Index OKF du dossier

L'index du dossier suit Open Knowledge Format 0.2. Ses classes et ses propriétés sont celles de la Legal Ontologies Foundry (LOF). Le format n'est pas réinventé : frontmatter YAML, `type` obligatoire, `generated`, identifiants bundle-relatifs, `index.md` avec `okf_version`.

## Autorité

SQLite fait foi. Les fiches LOF, les liens cités, les examens sans lien et les revues tabulaires liées sont dans les tables `piecemaker_okf_premises`, `piecemaker_okf_relations`, `piecemaker_okf_exams` et `piecemaker_okf_reviews` (`server/piecemaker/okf/store.ts`). L'Index du dossier (la revue tabulaire de l'Index : colonnes, lignes, cellules et citations) est dans `piecemaker_index_reviews`, `piecemaker_index_columns`, `piecemaker_index_rows` et `piecemaker_index_cells` (`server/piecemaker/okf/index-store.ts`) ; son `.json` dans `Tabular Review/` est une vue réécrite après chaque écriture. Les personnes, pseudonymes, mentions et qualifications de partie sont dans les tables de la connaissance. Les fiches `.md` de `.piecemaker/okf/` sont des vues : le serveur les régénère depuis SQLite après chaque écriture dans la base. Une fiche modifiée ou supprimée à la main est réécrite à la reconstruction suivante. Une fiche LOF n'existe que par un lien cité ou une revue tabulaire liée.

Les fiches écrites avant que SQLite ne porte ces données sont importées une seule fois par dossier (`piecemaker_okf_imports`). Les fiches Partie portent des codes, pas des noms. Les citations et les titres de pièces sont en clair et peuvent contenir des identités réelles.

## Ontologie : Legal Ontologies Foundry

L'ontologie de l'index est la Legal Ontologies Foundry (LOF) de David R. Koepsell : https://legal-ontologies-foundry.github.io/ (dépôts https://github.com/legal-ontologies-foundry). Elle est publiée sous licence CC BY 4.0 ; ses termes BFO viennent de Basic Formal Ontology, CC BY 4.0. `server/piecemaker/okf/lof.json` la reprend sans modification depuis les dépôts : LOF-ODP-001 à 004 (version 0.2.0) et LOF-ODP-005 et 006 (`src/ontology`). Il garde l'attribution, la source et, pour chaque terme, l'IRI, le libellé anglais, les annotations mot pour mot (définition, exemples, notes), le domaine, le codomaine, l'inverse, les parents et les axiomes. Il compte 48 classes, 59 propriétés d'objet et une propriété de donnée (`has date-time value`).

La LOF est fixe : ni l'avocat ni l'agent ne la modifient. `pm okf ontologie` l'affiche (attribution, classes, propriétés avec domaine → codomaine et définition) ; `pm okf ontologie --noms` donne les libellés des propriétés en JSON. Elle remplace l'ancienne ontologie (`amends`, `responds-to`, `refers-to`, `supersedes`, `states`, `mentions`, `involves`) et les types `Premise` et `Partie`. Les anciennes relations ne sont pas importées.

## Périmètre

`.piecemaker/okf/` contient :

| Fiche | Identifiant | Classe LOF | Origine |
| --- | --- | --- | --- |
| Document | `/<chemin du document>.md` | `legal document` ou `material entity` (nature) | lignes de l'Index, complétées par le scan |
| Fiche LOF | `/_lof/<titre normalisé>.md` | toute classe : `legal position`, `claim`, `duty`, `legal act`, `temporal instant`… | avocat ou agent |
| Partie | `/_parties/<CODE>.md` | `material entity` | personnes qualifiées client ou adversaire |
| `index.md` | — | — | reconstruction |

Seules les personnes qualifiées de parties ont une fiche. Les tiers n'entrent pas dans l'OKF. Une fiche LOF porte `type` (libellé de sa classe), `lof` (identifiant de la classe), `title` et `description`. Les fiches `/_premises/` d'un index antérieur restent lues comme fiches LOF ; sans classe, `verify` demande de les relier en donnant leur classe.

## Types

Le type principal d’un document suit le champ `type` du dossier, hérité du parent. Sans ce champ, le nom du dossier de premier niveau reste le type. Sans arborescence, la classification par défaut s’applique. Un document hors arborescence reçoit `Non classé` ; la vérification le signale. `Non classé` est réservé.

La nature d’un document est une classe LOF : `legal document` ou `material entity`, ou `indéterminé`. Elle donne la classe `lof` de sa fiche ; une nature hors LOF donne `legal document`.

Le graphe montre les documents des types du graphe (par défaut `Pièces`), les parties, et les fiches LOF sur demande.

L'avocat seul fixe l'arborescence, donc les types de documents. Elle est commune à tous les dossiers : c'est la clé `arborescence` de `~/.piecemaker/ontologie.json`, scellée. Au premier démarrage, la plus récente des anciennes `.piecemaker/arborescence.json` des dossiers devient l'arborescence commune ; ces fichiers ne sont plus lus. L'agent la lit avec `pm dossier arborescence` et modifie la clé `arborescence` de `ontologie.json` avec Edit, Write ou apply_patch : le hook `guard-ontologie` refuse l'écriture, applique la modification à la proposition en attente (ou au fichier actuel), la fait valider par `pm okf ontologie proposer` et répond à l'agent ce qui a changé. Sans hook, l'agent propose une arborescence complète avec `pm dossier arborescence --dossiers JSON --motif "…"` ou `pm okf ontologie proposer --json '{"arborescence":[…],"motif":"…"}'`. La proposition est écrite dans `ontologie.proposition.json` ; elle ne s'applique pas. L'onglet Index › Classement la montre en suivi des modifications : l'avocat accepte, refuse ou modifie chaque changement, puis enregistre, ce qui supprime la proposition (`DELETE /classification/proposition` du plugin Tabular review pour « Tout refuser »). L'enregistrement met à jour la colonne Classement des revues de tous les dossiers. Un bandeau de l'onglet Index signale une proposition en attente.

## Fichier commun

`~/.piecemaker/ontologie.json` (ou `$PIECEMAKER_HOME/ontologie.json`), un seul fichier commun à tous les dossiers : `{ "arborescence": [{ name, explanation, type? }], "sceau" }`. Les clés `relations` et `documentTypes` d'un fichier antérieur sont ignorées et disparaissent au prochain enregistrement. Un fichier illisible fait appliquer l'arborescence par défaut, avec un message.

Le serveur scelle le fichier à chaque enregistrement : `sceau` est un HMAC-SHA256 de l'arborescence, calculé avec la clé `ontologie.cle` du même répertoire (créée au premier enregistrement, mode 600). Un fichier dont le sceau ne correspond pas a été modifié hors de l'onglet Index : l'arborescence par défaut s'applique, `verify` et l'onglet Index le signalent, et l'avocat l'enregistre de nouveau.

- `verify` contrôle `ontologie.json` et `ontologie.proposition.json` : clés de premier niveau (`arborescence`, `motif`, `sceau`, `date`), sans clé inconnue, puis valeurs conformes aux règles.
- Le hook `guard-ontologie` refuse à l'agent toute écriture directe dans `~/.piecemaker/ontologie.json`, et tout accès à `ontologie.cle`. Il est branché sous Claude (`Write|Edit|MultiEdit|NotebookEdit|Bash|Read|Grep|Glob`), sous Codex (`Bash|apply_patch`, patch lu dans `tool_input.command`) et dans le chat Mistral (`mistral-sdk/tools.ts`, avec `protect-originals`).
- Une commande shell qui nomme l'un de ces fichiers n'est admise que si chacun de ses segments est une lecture (`cat`, `grep`, `jq` sans `-i`, `find` sans `-delete` ni `-exec`, `pm`…), sans redirection vers un fichier ni substitution de commande.

## Liens

Dans le frontmatter de la fiche source : `relations: { <libellé de la propriété LOF>: [{ target, piece, citation, value?, origin, at?, dismissed? }] }`.

- La source et la cible sont un document, une partie ou une fiche LOF. Une fiche LOF absente est créée avec la classe donnée (`source_class`, `target_class`).
- Chaque lien porte la pièce qui le fonde (`piece`) et une citation mot pour mot de cette pièce. Le serveur refuse une pièce ou une citation absente.
- La classe de la source doit entrer dans le domaine de la propriété, celle de la cible dans son codomaine (sous-classes comprises). Une propriété fonctionnelle n'admet qu'une cible. Une fiche ne se lie pas à elle-même.
- `has date-time value`, seule propriété de donnée, n'a pas de cible : elle porte `value`, une date `AAAA-MM-JJ`. Sa cible enregistrée est la pièce.

`origin` vaut `piecemaker/agent` ou `piecemaker/avocat`. Un lien retiré est supprimé.

L'agent pose les liens par l'outil MCP `OkfWrite` (serveur `features`) : `link`, `unlink`, `mark_examined`, `link_review`, une ou plusieurs opérations par appel (`writes`), toutes validées avant la première et arrêtées au premier échec. Son schéma n'admet que les libellés des propriétés LOF, qu'il reçoit au démarrage (`pm okf ontologie --noms`), et exige la pièce et la citation. Il passe par `pm okf link|unlink|examinee|revue`, donc par la vérification du serveur. Le Hérisson lance `pm okf verify` après toute écriture d'une fiche.

L'agent part des personnes impliquées, d'abord du client : la `legal position` (`claim`, `duty`, `power`…) qu'il tient (`held by`), ce qui la fonde (`grounded in`), l'acte qui l'a créée (`generated by`), l'événement qui la déclenche (`triggered by`), la personne visée (`directed at`), le remède (`remedy provided by`). Ces six propriétés font une « fully grounded legal position » au sens de la LOF ; `verify` signale celles qui manquent.

### Revue tabulaire liée

Une colonne d'une revue tabulaire des pièces se lie à une fiche LOF, créée au besoin d'après son titre et la classe donnée. Chaque ligne positive de la colonne devient une pièce de la fiche : réponse trouvée (ni « Non trouvé » ni « Non traité »), et « Oui » pour une question Oui / Non. La pièce porte la valeur de la cellule, sa première citation vérifiée et un auteur :

- `agent` : la réponse de la session IA, telle quelle ;
- `human` : la réponse que l'avocat a marquée vérifiée dans la revue (bouton « Marquer vérifiée » du détail de la cellule) ou corrigée à la main. Relancer la cellule efface la vérification.

Le lien (`piecemaker_okf_reviews` : fiche, fichier de la revue, index de colonne, auteur du lien, date) est seul écrit dans SQLite. Les lignes sont lues dans la revue à chaque lecture. La fiche `.md` porte `revues: [{fichier, colonne, by, at}]` et, dans son corps, la section « Revues tabulaires » régénérée à chaque reconstruction.

- Agent : `pm okf revues` liste les revues et leurs colonnes ; `pm okf revue "<titre>" --fichier <revue.json> --colonne <nom|index> [--classe <classe LOF>] [--retirer]`, ou `OkfWrite` action `link_review` (`source` = titre de la fiche, `file`, `column`, `class`, `remove`).
- Avocat : fiche dans l'onglet Index, « Lier une revue tabulaire » ; « Délier » sur chaque revue liée.

Une recherche juridique ne se lie pas : elle cite des décisions, pas des pièces du dossier. Une revue liée supprimée ou privée de sa colonne est une erreur de `pm okf verify`.

Une fiche LOF vit tant qu'un lien ou une revue liée la vise ou part d'elle. Retirer le dernier la supprime.

## Raisonnement Catala

Catala ne lit pas l'index OKF. Un programme Catala cite ses pièces directement ; l'index se tient seul.

## Production, sans token

1. L'analyse tabulaire de l'Index et le scan GLiNER remplissent SQLite.
2. `buildBundle` écrit une fiche par ligne de l'Index (titre de la ligne, colonnes Nature et Date) et par document scanné absent de l'Index, ainsi que les fiches de parties et les fiches LOF. Le scan ne pose aucun lien.
3. `buildBundle` régénère toutes les fiches depuis SQLite et supprime les fichiers qui n'y correspondent pas.

La reconstruction a lieu après une écriture de l'Index (regroupée, une seconde après la dernière), après un scan, après un renommage (les cibles suivent dans SQLite) et après chaque écriture de lien ou d'examen. La lecture (`GET /okf`) et la vérification (`verify`) ne reconstruisent pas : elles lisent les fiches sur le disque. Un fichier n'est réécrit que si son contenu change.

Le serveur refuse une citation absente du document source.

## Vérification

`pm okf verify`, ou le bouton Vérifier de l'onglet Index. Trois listes :

- **Erreurs** : frontmatter, type, classe LOF, document présent, fiche alignée sur son document, propriété LOF connue, classe de la source dans le domaine et de la cible dans le codomaine, propriété fonctionnelle à une seule cible, cible présente, pièce présente, date de `has date-time value`, citation retrouvée dans la pièce dans le document (apostrophes et guillemets typographiques, espaces insécables et ellipse « … » au milieu tolérés ; les fragments se suivent dans l'ordre), document sans fiche, `index.md`.
- **Contradictions** : `temporal instant` qui reçoit plusieurs dates distinctes (`has date-time value` ou revue liée) (comparaison sans casse ni accents ; une valeur qui est une date est ramenée au format `AAAA-MM-JJ` avant comparaison : « 3 mars 2024 », « 03/03/2024 » et « 2024-03-03 » comptent pour une seule valeur).

`pm okf verify` donne aussi la liste **Manques**, pour l'agent. Chaque ligne nomme un élément et ce qui lui manque ; `pm check` les reprend :

| Élément | Manque signalé |
| --- | --- |
| Pièce d'un type du graphe | pièce à examiner : aucun lien LOF ne la cite ; ou pièce modifiée depuis son examen sans lien |
| `legal position` | sans titulaire `held by` (sans partie qualifiée au dossier : `avocat: true`, en attente de l'avocat, onglet Dossier, vue générale ; compté à part par `pm check`) ; incomplète : `grounded in`, `generated by`, `triggered by`, `directed at` ou `remedy provided by` sans lien cité. Celles que tient le client viennent en premier. |
| Fiche LOF | sans classe ; sans pièce citée |
| Partie | aucun lien LOF cité |

**Pièce examinée sans lien.** Une pièce lue dont aucun passage ne justifie de lien reste sinon un manque à jamais. L'agent (ou l'avocat) la marque : `pm okf examinee <pièce> --motif "raison"`. Le serveur écrit dans SQLite le motif, l'auteur, la date et l'empreinte SHA-256 du document original ; la fiche régénérée porte le champ `examen_sans_lien`. `verify` renvoie la pièce dans `examinees`, imprimée sous « Examinées sans lien (information, pas un manque) », et non dans les manques. Le manque revient si l'empreinte ne correspond plus au document (« pièce modifiée depuis son examen sans lien ») ou si la marque est retirée (`pm okf examinee <pièce> --retirer`). La fiche de la pièce, dans l'onglet Index, montre la ligne « Examen ». Le Hérisson lance `pm okf verify` après `pm okf examinee`, comme après `link`.

## Interface

Onglet Index du plugin `piecemaker-dossier` :

Le bouton **Ontologie** réunit deux onglets : LOF et Classement. Un seul bouton enregistre les onglets ouverts.

- **LOF** affiche l'ontologie, en lecture seule : attribution, classes et propriétés avec leurs définitions. « Demander à l’assistant » met la LOF en pastille dans le chat.
- **Classement** réutilise l’éditeur d’arborescence. Le champ `type` d’un dossier fixe son type principal, par exemple `Pièces` ou `Archives`. Les sous-dossiers héritent du parent. Sans champ `type`, le nom du dossier de premier niveau reste le type principal. L’enregistrement reconstruit l’index sans déplacer les fichiers.
- L'onglet Index **est** la revue de l'Index du dossier, unique : une ligne par pièce, une colonne par question, plus une colonne **Liens** (liens OKF de la pièce). Il n'y a plus de tableau tiré du scan ni de fenêtre d'analyse par-dessus. Le bouton **Chronologie** n'y garde que les pièces (lignes dont la fiche est du type `Pièces`), de la plus ancienne à la plus récente selon la colonne Date, les pièces sans date en fin de liste ; le choix est retenu dans le navigateur. `pm dossier index lancer|lire|colonnes` et l'outil MCP `tabular_review_index` ouvrent cet onglet (la vue `index-analysis` en est un alias). Le plugin Tabular Review lit et écrit l'Index par la route locale `/api/piecemaker/local/index-review` (`GET`, `PUT` avec la révision lue, `DELETE`), à l'origine `PIECEMAKER_HOST_ORIGIN` que l'hôte lui donne au lancement ; hors de PieceMaker, l'Index reste un `.json`. Un Index encore en `.json` est repris une fois dans SQLite à la première lecture. Après un lancement par `pm` ou par l’outil MCP, la route hôte `/api/piecemaker/local/tabular-review` transmet l’origine du serveur : le runner du plugin range chaque ligne terminée selon la colonne Classement (`/api/piecemaker/local/rename`, puis `markApplied`), même si la revue n’est pas affichée. Un lancement fait depuis l’interface garde le rangement par le volet.
Les natures sont des classes LOF : `legal document` et `material entity`, plus `indéterminé` quand l’extraction ne tranche pas. Elles ne se modifient pas.

Le graphe affiche des pastilles avec titre et icône, sur fond uni. Les traits sont fins ; les mentions et parties utilisent des pointillés. Le survol révèle les libellés proches. Le titre est extrait avec une citation vérifiée pendant la revue tabulaire et conservé dans `row.title`. Il remplace le nom source dans la première cellule, les exports et les en-têtes des fiches, sans colonne de question supplémentaire. Sans titre, le nom source reste affiché. Les anciennes colonnes `Titre`, `Intitulé`, `Titre du document` et `Nom du document` restent lues. `Événement` ne sert plus de titre. La nature vient du document, sinon des colonnes `Nature`, `Type de document`, `Type de pièce` ou `Type`. La lecture reflète les dernières réponses sans réécrire les fiches.

Route ajoutée : `POST /api/piecemaker/okf/rebuild`. Natures et icônes : `plugins/piecemaker-dossier/src/document-types.ts`.

- Tableau : colonne Liens (survol : citation).
- Graphe (cytoscape), onglet « Graphe » à côté de l'onglet « Index » (qui garde le tableau) : pièces et parties ; le bouton « Fiches LOF » montre ou masque les fiches LOF avec leurs liens (choix gardé dans le navigateur) et le placement se recalcule. Nœuds placés au format du cadre (aire cible : trois fois celle des nœuds), écartés d'au moins 24 px en largeur et 12 px en hauteur, sans chevauchement ; les nœuds ne se déplacent pas. Le bouton ⌖ recentre le graphe entier. Un clic ouvre la fiche dans le même cadre, à droite, et cadre la vue sur le nœud et ses voisins ; × ou Échap la ferme. La fiche donne titre, méta, auteur et date de création (`generated`), actions, propriétés en pastilles (valeurs, parties, fiches LOF, liens), alertes (sources divergentes, aucune pièce), pièces sources avec fichier (un clic l'ouvre dans le volet Fichier), citation, auteur et date du lien (`at`, écrit par `pm okf link`). Pièce : « Corriger la pièce » ; partie : « Modifier la partie ». Une pastille ouvre la fiche liée. Fiche : `plugins/piecemaker-dossier/src/okf-card.ts`.
- Visionneuse : texte de la pièce, passages repérés surlignés (parties, date, citations des liens), liens fondés par la pièce avec retrait. L'avocat sélectionne un passage, choisit la fiche source (ou en crée une avec sa classe LOF), la propriété LOF, puis la cible ou la date. Le passage devient la citation et la pièce ouverte la pièce du lien, écrits par `POST /api/piecemaker/okf/link` et `/unlink`.

## Agent

Skill `okf` (`server/piecemaker/vendor/skills/okf/`), déclaré dans chaque dossier.

L'agent principal écrit lui-même l'index, par l'outil `OkfWrite` du MCP `features` ou par `pm okf`.

## Limites connues

- Un changement de code d'une partie laisse ses liens pendants ; `verify` les signale.
- Seule `has date-time value` porte une valeur dans l'index ; ses dates sont ramenées au format ISO (`JJ/MM/AAAA`, `JJ.MM.AAAA`, `AAAA-MM-JJ`, `J mois AAAA`).
- La LOF ne couvre que ses six patrons (ODP-001 à 006). Un lien qu'aucune propriété LOF n'exprime n'entre pas dans l'index.
- Le CLI `vibe` exécute les hooks PieceMaker par `~/.vibe/hooks.toml`, écrit au démarrage du serveur (entrées `piecemaker-*` seulement, hooks personnels conservés) ; l'adaptateur `scripts/vibe-hook.mjs` traduit le protocole Vibe. Limite : sous le harnais expérimental de Vibe, `subagent.spawn` est asynchrone, son résultat ne porte pas le compte rendu : `verify-subagent` n'y voit rien. Le chat Mistral de l'app passe par `guard-ontologie`, `protect-originals`, `classify-ai-documents` et `verify-subagent`.
- Une commande qui fabrique le chemin sans le nommer (concaténation, variable) échappe au hook. Le sceau détecte alors une arborescence modifiée, et `verify` un lien hors LOF posé dans une fiche.

## Fichiers

| Rôle | Fichier |
| --- | --- |
| Format, lecture, écriture | `server/piecemaker/okf/bundle.ts` |
| Construction depuis le scan | `server/piecemaker/okf/build.ts` |
| Tables SQLite de l'OKF | `server/piecemaker/okf/store.ts` |
| Index du dossier (SQLite, vue `.json`) | `server/piecemaker/okf/index-store.ts`, `plugins/piecemaker-tabular-review/src/server/host-index.ts` |
| Onglet Index (revue de l'Index, colonne Liens) | `plugins/piecemaker-dossier/src/index-analysis.ts` |
| Métadonnées lues dans les revues tabulaires | `server/piecemaker/okf/reviews.ts` |
| Vérification, contradictions | `server/piecemaker/okf/verify.ts` |
| Pièces d'une fiche LOF, manques du graphe | `server/piecemaker/okf/premises.ts` |
| Liens à la demande | `server/piecemaker/okf/links.ts` |
| LOF (données reprises du dépôt, lecture) | `server/piecemaker/okf/lof.json`, `server/piecemaker/okf/lof.ts` |
| Arborescence commune | `server/piecemaker/okf/ontology.ts` |
| Fichier scellé commun, arborescence | `server/piecemaker/okf/sealed.ts` |
| Onglet LOF et Classement | `plugins/piecemaker-dossier/src/ontology.ts` |
| Proposition de l'assistant | `server/piecemaker/okf/ontology-proposal.ts` |
| Suivi des modifications, commun | `plugins/piecemaker-dossier/src/proposal.ts`, `plugins/piecemaker-dossier/src/pending-proposals.ts` |
| Proposition d'arborescence | `plugins/piecemaker-tabular-review/src/server/classification.ts`, `plugins/piecemaker-dossier/src/classification.ts` |
| Garde d'écriture | `server/piecemaker/vendor/piecemaker-plugin/scripts/guard-ontologie.mjs` |
| Routes `/api/piecemaker/okf` et locale | `server/piecemaker/okf/index.ts` |
| Commande `pm okf` | `server/piecemaker/vendor/skills/Skill-PieceMaker/scripts/pm.mjs` |
| Tableau, graphe, appels | `plugins/piecemaker-dossier/src/okf.ts` |
| Visionneuse | `plugins/piecemaker-dossier/src/editors.ts` (`documentEditor`) |
