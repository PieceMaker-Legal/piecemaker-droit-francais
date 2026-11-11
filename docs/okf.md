# Index OKF du dossier

L'index du dossier suit Open Knowledge Format 0.2, avec les relations typées d'OKF-Legal. Le format n'est pas réinventé : frontmatter YAML, `type` obligatoire, `generated`, identifiants bundle-relatifs, `index.md` avec `okf_version`.

## Autorité

L'OKF fait autorité sur les types, les liens entre pièces, les faits et le lien d'une pièce à une partie. Un fait n'existe que par un lien cité dans la fiche d'une pièce.

SQLite garde ce qui sert à l'anonymisation : personnes, pseudonymes, mentions, qualification de partie. L'OKF reflète cette qualification à chaque reconstruction ; il ne contient jamais d'identité réelle.

## Périmètre

`.piecemaker/okf/` contient :

| Fiche | Identifiant | Origine |
| --- | --- | --- |
| Document | `/<chemin du document>.md` | scan |
| Fait | `/_faits/<titre normalisé>.md` | avocat, agent ou revue tabulaire |
| Partie | `/_parties/<CODE>.md` | personnes qualifiées client ou adversaire |
| `index.md` | — | reconstruction |

Seules les personnes qualifiées de parties ont une fiche. Les tiers n'entrent pas dans l'OKF.

## Types

Le type d'une fiche de document est le dossier de premier niveau de `.piecemaker/arborescence.json`. Sans arborescence, la classification par défaut s'applique. Un document hors arborescence reçoit `Non classé` ; la vérification le signale. `Fait` et `Partie` sont réservés.

Le graphe ne montre que certains types de documents : `['Pièces']` par défaut, ou `typesGraphe` dans `.piecemaker/okf.json`. Il montre aussi les faits et les parties.

## Relations

Dans le frontmatter de la fiche source : `relations: { <relation>: [{ target, citation, value?, origin, dismissed? }] }`.

| Relation | Source → cible | Citation | Posée par |
| --- | --- | --- | --- |
| `amends`, `responds-to`, `refers-to`, `supersedes` | document → document (types du graphe) | oui | scan (`refers-to`), agent, avocat |
| `states` | document → Fait | oui, plus `value` facultative | avocat (visionneuse), agent, revue tabulaire |
| `mentions` | document → Partie | non | scan seulement |
| `involves` | Fait → Partie | non | agent |

`supersedes` relie une version à celle qu'elle remplace. Aucun champ de statut (projet, signé) n'existe.

`origin` vaut `piecemaker/gliner`, `piecemaker/agent`, `piecemaker/avocat` ou `piecemaker/tabular-review`. Un lien dérivé (scan, revue) retiré est marqué `dismissed` et ne revient pas. Un lien manuel retiré est supprimé.

## Faits

Un fait est une fiche `Fait` : `title`, `description`, `single_value` facultatif. Son corps liste les pièces qui l'établissent (vue dérivée ; le lien dans la fiche de la pièce fait foi).

Trois sources :

1. **Visionneuse** — l'avocat sélectionne un passage, clic droit, « Fait », choisit ou crée le fait. Le passage devient la citation du lien `states`.
2. **Agent** — `pm okf link <pièce> states "<titre>" --citation "…" [--value "…"] [--single]`.
3. **Revue tabulaire** — une colonne de modèle marquée « Index du dossier » porte un fait. Chaque cellule avec une citation vérifiée devient un lien : valeur = résumé de la cellule, citation = première citation vérifiée.

Deux usages de la colonne :

| Marquage | Usage | Écart entre pièces |
| --- | --- | --- |
| `single` | contentieux : un fait vu par plusieurs pièces | contradiction signalée |
| `checkpoint` | due diligence : un point de contrôle appliqué à chaque contrat | résultat attendu |

Une fiche `Fait` vit tant qu'une colonne de revue la porte ou qu'un lien non écarté la vise. Sinon la reconstruction la supprime.

## Production, sans token

1. Le scan GLiNER remplit SQLite.
2. `buildBundle` écrit les fiches de documents (titre, nature, date), de parties et de faits, et pose `mentions`.
3. Le scan pose `refers-to` quand une phrase du Markdown converti contient la date et la nature d'un seul autre document.
4. `factsFromReviews` lit `Tabular Review/*.json` et pose les liens `states` des colonnes marquées.

La reconstruction a lieu après un scan, après un renommage (les cibles suivent), après chaque écriture de lien et à chaque lecture. Un fichier n'est réécrit que si son contenu change.

Le serveur refuse une citation absente du document source.

## Vérification

`pm okf verify`, ou le bouton Vérifier de l'onglet Index. Deux listes :

- **Erreurs** : frontmatter, type, document présent, fiche alignée sur son document, relation connue et permise pour le type de la source, cible présente, citation retrouvée mot pour mot, document sans fiche, `index.md`.
- **Contradictions** : fait `single_value` qui reçoit plusieurs valeurs distinctes (comparaison sans casse ni accents).

## Interface

Onglet Index du plugin `piecemaker-dossier` :

- Tableau : colonne Liens (survol : citation).
- Graphe (cytoscape) : pièces, faits, parties. Un clic ouvre la fiche : visionneuse pour une pièce, fiche de l'onglet Parties pour une partie (avec ses faits), fiche du même design pour un fait (pièces, valeurs, citations, parties).
- Visionneuse : texte de la pièce, passages repérés surlignés (parties, date, citations des faits), section « Faits établis par la pièce » avec retrait. Les faits s'écrivent dans l'OKF dès le choix, par `POST /api/piecemaker/okf/link` et `/unlink`.

## Agent

Skill `okf` (`server/piecemaker/vendor/skills/okf/`), déclaré dans chaque dossier. Sous-agent `gestionnaire-okf` (`vendor/piecemaker-plugin/agents/`), modèle de niveau moyen pour Claude, Codex et Vibe, activé par dossier depuis la Bibliothèque. Claude précharge le skill ; Codex et Vibe le lisent en première étape.

## Limites connues

- Un changement de code d'une partie laisse les liens `involves` pendants ; `verify` les signale.
- Les valeurs sont comparées comme des chaînes : « 3 mars 2024 » et « 2024-03-03 » comptent pour deux valeurs.
- Un fait créé dans la visionneuse n'est pas `single_value` ; l'agent le pose avec `--single`.

## Fichiers

| Rôle | Fichier |
| --- | --- |
| Format, lecture, écriture | `server/piecemaker/okf/bundle.ts` |
| Construction depuis le scan | `server/piecemaker/okf/build.ts` |
| Faits des revues tabulaires | `server/piecemaker/okf/reviews.ts` |
| Vérification, contradictions | `server/piecemaker/okf/verify.ts` |
| Liens à la demande | `server/piecemaker/okf/links.ts` |
| Routes `/api/piecemaker/okf` et locale | `server/piecemaker/okf/index.ts` |
| Commande `pm okf` | `server/piecemaker/vendor/skills/Skill-PieceMaker/scripts/pm.mjs` |
| Tableau, graphe, appels | `plugins/piecemaker-dossier/src/okf.ts` |
| Visionneuse | `plugins/piecemaker-dossier/src/editors.ts` (`documentEditor`) |
| Marquage des colonnes | `plugins/piecemaker-tabular-review/src/shared.ts` (`COLUMN_FACTS`) |
