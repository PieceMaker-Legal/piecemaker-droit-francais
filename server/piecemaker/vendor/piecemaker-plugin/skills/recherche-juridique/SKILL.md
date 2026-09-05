---
name: recherche-juridique
description: "Rechercher un texte de loi ou une jurisprudence via le serveur MCP Légifrance et produire des citations vérifiables (bloc <CITATIONS>) pour une réponse ou un acte PieceMaker. À utiliser dès qu'un texte de loi, un article ou une décision doit être cité — jamais de mémoire. Le hook Stop `verify-citations.mjs` bloque le tour si une citation ne se retrouve pas mot pour mot dans une source réellement lue."
---

# Recherche juridique et citations vérifiables

## Ce que ce skill garantit

**Une citation n'est acceptée que si elle a été lue dans ce tour, mot pour
mot.** Le hook Stop `verify-citations.mjs` relit chaque citation du bloc
`<CITATIONS>` produit en fin de réponse, la localise mécaniquement dans le
texte source réel, et bloque le tour si l'une d'elles est introuvable — même
approximativement. Ce n'est jamais un jugement du modèle : c'est une
recherche de sous-chaîne, tolérante aux espaces/casse/ponctuation mais pas au
sens. Une citation reformulée, résumée ou inventée est rejetée.

Ce skill décrit le déroulé de recherche avec les outils Légifrance
effectivement disponibles, puis le format exact que le vérificateur accepte.

## Outils du serveur MCP Légifrance

| Outil | Rôle |
| --- | --- |
| `Search_Cour_Cassation` | Recherche ciblée dans la jurisprudence de la Cour de cassation (mots-clés, opérateurs ET/OU, expression exacte, référence d'article), filtrable par matière et publication au bulletin. |
| `Search_Conseil_Etat` | Même recherche ciblée dans la jurisprudence du Conseil d'État, filtrable par publication au recueil Lebon. |
| `Search_Cour_Appel` | Même recherche dans les cours d'appel, filtrable par ville — bien cibler (ville + dates), le volume est important. |
| `Search_CAA` | Même recherche dans les cours administratives d'appel, filtrable par ville. |
| `Search_Premiere_Instance` | Recherche dans les juridictions de première instance — volume très limité (~50 décisions), opérateur OU par défaut. |
| `Search_Code` | Recherche dans les codes juridiques français (Code civil, Code du travail…) — référence d'article exacte (`L. 1235-3`), mots-clés ou expression exacte. Renvoie les identifiants `LEGIARTI…` des articles trouvés. |
| `consulter_article` | Texte intégral et vigueur d'une version précise d'article, à partir de son identifiant `LEGIARTI…` rendu par `Search_Code`. |
| `consulter_decision` | Rapatrie le texte intégral d'une décision à partir de son identifiant (`JURITEXT…`, `CETATEXT…`). **Rapatrie le texte intégral et le met en cache** (voir plus bas) — c'est le moyen normal de lire une décision avant de la citer. |
| `Download_Query_Results` | Télécharge en masse tous les résultats d'une requête dans un dossier local, pour trier sans paginer. **Ne rapatrie pas le texte intégral** (voir l'avertissement ci-dessous) — sert au tri, jamais directement à la citation. |
| `Build_Research_Corpus` | Construit un corpus exhaustif et reproductible sur une question de droit : plusieurs requêtes, déduplication, téléchargement et scan du texte intégral de chaque décision. **Rapatrie le texte intégral.** À utiliser pour une recherche large et systématique plutôt qu'un enchaînement manuel de `Search_*`. |
| `Validate_Research_Cards` | Valide mécaniquement (sans LLM) le résultat de `Build_Research_Corpus` : une fiche par décision, citations confirmées dans le texte intégral, rapport de couverture. |
| `Tracking_BODACC` | Situation d'une entreprise (procédures collectives) via son SIREN — hors jurisprudence, utile pour qualifier une partie. |

### Le fait décisif : seuls deux chemins rendent une citation vérifiable

Le vérificateur ne peut confirmer une citation que si le texte intégral de sa
source est quelque part sur disque. Sur les trois façons dont le MCP restitue
une décision, **une seule ne rapatrie pas ce texte** :

- **`Build_Research_Corpus`** écrit `decisions.jsonl` (une décision par ligne,
  champ `texte` = texte intégral réel) — vérifiable.
- **`consulter_decision`** renvoie le texte intégral dans sa réponse d'outil ;
  le hook `decision-cache.mjs` le capte au passage et l'écrit dans
  `~/.piecemaker/decisions/<id>.json` — vérifiable.
- **`Download_Query_Results`** écrit `results.json`, mais chaque entrée ne
  contient que `id`, `titre`, `lien`, `date`, `analyse` (un sommaire) et,
  optionnellement, `solution.dispositif` (le dispositif seul — jamais les
  motifs). **Pas de texte intégral.** Citer une décision connue uniquement par
  ce canal produira une citation non vérifiée et bloquera le tour.

**Conséquence pratique** : `Download_Query_Results` sert à trier une liste de
résultats (lire les titres/sommaires, écarter le hors-sujet). Dès qu'une
décision de cette liste doit être citée, il faut d'abord la lire avec
`consulter_decision` (ou l'avoir dans un corpus `Build_Research_Corpus`) —
jamais citer directement depuis `results.json`.

## Déroulé de recherche

1. **Recherche large** avec l'outil `Search_*` adapté à la juridiction visée
   (ou `Build_Research_Corpus` pour une question de droit qui mérite un
   balayage systématique plutôt qu'une requête isolée). Pour un texte de loi,
   `Search_Code`.
2. **Tri** des résultats sur les seuls éléments déjà renvoyés (titre, sommaire,
   date, `analyse`) — sans lire chaque décision en entier. `Download_Query_Results`
   aide à trier un grand volume hors ligne.
3. **Lecture** des seules décisions/articles retenus comme potentiellement
   cite-worthy : `consulter_decision` (jurisprudence) ou `consulter_article`
   (texte de loi), ou relecture du `decisions.jsonl` d'un corpus déjà construit.
   Ne lire que ce qui sera effectivement cité ou a de bonnes chances de l'être
   — pas systématiquement tout ce qui est remonté par la recherche large.
4. **Citation** : une fois la décision ou l'article lu dans ce tour, en extraire
   les passages utiles mot pour mot et construire le bloc `<CITATIONS>`
   (format ci-dessous).

## Discipline de citation

- **Ne jamais citer une source qu'on n'a pas lue dans ce tour.** Une décision
  connue seulement par son titre, son sommaire, un résumé mémorisé ou un
  résultat de recherche n'est pas une source de citation valable — elle doit
  d'abord être lue avec `consulter_decision` ou `consulter_article`.
- **Une citation est une reproduction littérale**, jamais une reformulation
  ni un résumé. Copier le texte exact de la source, ponctuation comprise si
  possible (le vérificateur tolère un léger écart d'espace/casse/ponctuation,
  pas un écart de sens).
- **Au plus 3 extraits par citation**, chacun **25 mots maximum**, bien ciblés
  sur l'affirmation qu'ils appuient.
- **Références contiguës** : les marqueurs `[N]` dans le texte de la réponse
  vont de `[1]` à `[N]` sans saut, dans l'ordre de première apparition. Chaque
  `[N]` a exactement une entrée correspondante `"ref": N` dans le bloc
  `<CITATIONS>`. Réutiliser un `ref` existant pour citer à nouveau la même
  source/le même passage plutôt que d'en créer un nouveau.
- Si une source utile n'a pas encore été lue, la lire avant de la citer — ou,
  à défaut, dire qu'elle n'a pas pu être lue et ne pas s'appuyer dessus.

## Format du bloc `<CITATIONS>`

Le bloc est ajouté **à la toute fin** de la réponse, tel que parsé par
`piecemaker-plugin/scripts/lib/citations.cjs` :

```
<CITATIONS>
[ ... tableau JSON d'objets citation ... ]
</CITATIONS>
```

Le contenu entre les balises doit être un tableau JSON valide (`JSON.parse`
strict — pas de virgule finale, pas de commentaire). Chaque entrée du tableau
prend l'une des deux formes suivantes.

### Forme « jurisprudence » (`kind: "case"`)

Identifie la décision par `decision_id` — l'identifiant Légifrance
(`JURITEXT…`, `CETATEXT…`) tel que rendu par `Search_*`/`Download_Query_Results`/
`Build_Research_Corpus`, et lu avec `consulter_decision` (ou présent dans un
`decisions.jsonl`).

```json
{
  "ref": 1,
  "kind": "case",
  "decision_id": "JURITEXT000012345678",
  "quotes": [
    { "quote": "le juge doit rechercher si l'inexécution est suffisamment grave" }
  ]
}
```

Plusieurs extraits de la même décision (jusqu'à 3) :

```json
{
  "ref": 2,
  "kind": "case",
  "decision_id": "JURITEXT000012345678",
  "quotes": [
    { "quote": "premier extrait littéral, vingt-cinq mots au maximum" },
    { "quote": "second extrait littéral, distinct du premier" }
  ]
}
```

`type` et `author` sont acceptés dans chaque objet `quotes` (facultatifs,
informatifs, jamais vérifiés). `doc_id`, `page`, `sheet`, `cell` ou un `quote`
au premier niveau n'ont pas de sens pour une citation de jurisprudence — ne
pas les utiliser sur une entrée `case`.

### Forme « document » (`kind: "document"`, ou `doc_id` sans `decision_id`)

Identifie une pièce du dossier par `doc_id` (le chemin, absolu ou relatif à la
racine du dossier, de sa contrepartie Markdown convertie — jamais l'original).
Chaque extrait porte un localisateur `page` (numéro, ou `"N-M"` pour une plage)
ou, pour un tableur, `sheet` + `cell` (adresse ou plage A1, ex. `"B7"` ou
`"B7:C9"`).

```json
{
  "ref": 3,
  "doc_id": "pieces/contrat-bail.md",
  "quotes": [
    { "page": 3, "quote": "le preneur s'engage à occuper les lieux en bon père de famille" }
  ]
}
```

Extrait à cheval sur deux pages : `page` prend la forme `"N-M"` et la
sentinelle `[[PAGE_BREAK]]` sépare, dans le même `quote`, le texte de fin de
page N du texte de début de page M — chaque segment est vérifié
indépendamment contre sa propre page.

```json
{
  "ref": 4,
  "doc_id": "pieces/attestation.md",
  "quotes": [
    { "page": "41-42", "quote": "texte de fin de page 41 [[PAGE_BREAK]] texte de début de page 42" }
  ]
}
```

Citation dans un tableur (pièce convertie contenant des tableaux `## Sheet:
<nom>`) : `sheet` + `cell` remplacent `page`.

```json
{
  "ref": 5,
  "doc_id": "pieces/tableau-honoraires.md",
  "quotes": [
    { "sheet": "Honoraires", "cell": "B7", "quote": "3 500 €" }
  ]
}
```

Une citation à un seul extrait peut aussi s'écrire sous la forme abrégée
(niveau supérieur au lieu de `quotes`) — `citations.cjs` l'accepte, elle
retombe sur un tableau `quotes` d'un seul élément :

```json
{ "ref": 6, "doc_id": "pieces/mise-en-demeure.md", "page": 1, "quote": "je vous mets en demeure de régulariser sous huitaine" }
```

## Ce que fait le vérificateur, et quoi faire quand il bloque

À l'arrêt du tour, `verify-citations.mjs` :

1. Parse le bloc `<CITATIONS>` du dernier message.
2. Pour chaque citation, résout sa source réelle — texte intégral de la
   décision (corpus `Build_Research_Corpus`, cache `consulter_decision`, ou en
   dernier recours le sommaire de `Download_Query_Results`) ou pièce
   Markdown du dossier.
3. Localise mécaniquement chaque extrait dans ce texte. Un extrait qui a
   légèrement dérivé (espace, casse, ponctuation) est **corrigé
   automatiquement** avec l'extrait source exact — ce n'est pas une faute.
4. Un extrait introuvable, même tolérant, **bloque le tour** : la réponse
   liste chaque citation fautive avec son identifiant et le motif (source
   inconnue, source illisible, ou introuvable dans la source).

Quand ça arrive : soit relire la source exacte et reprendre le texte réel de
l'extrait fautif (jamais le reformuler pour le faire passer), soit retirer la
citation si elle ne peut pas être justifiée par une source effectivement lue.

## Ce qu'il ne faut pas faire

- Ne jamais citer une décision connue uniquement par un résultat
  `Download_Query_Results` sans l'avoir d'abord lue avec `consulter_decision`.
- Ne jamais paraphraser un extrait pour qu'il « sonne » comme la source — le
  vérificateur tolère l'espace/la casse/la ponctuation, pas le sens.
- Ne jamais laisser un `ref` sauter un numéro ou repartir en désordre.
- Ne jamais dépasser 3 extraits par citation ni 25 mots par extrait.
- Ne jamais inventer un `decision_id` ou un `doc_id` pour combler un manque de
  source.
