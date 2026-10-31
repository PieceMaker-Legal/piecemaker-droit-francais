---
name: recherche-juridique
description: "Rechercher un texte de loi ou une jurisprudence via le serveur MCP Légifrance et produire des citations vérifiables (bloc <CITATIONS>) pour une réponse ou un acte PieceMaker. À utiliser dès qu'un texte de loi, un article ou une décision doit être cité — jamais de mémoire. Le harnais de citations signale toute citation qui ne se retrouve pas mot pour mot dans une source lue dans le tour."
---

# Recherche juridique et citations vérifiables

## Ce que ce skill garantit

**Une citation n'est vérifiée que si sa source a été lue dans ce tour, mot pour
mot.** À la fin du tour, le harnais de citations relit chaque citation du bloc
`<CITATIONS>` et la localise mécaniquement dans le texte source réel. Ce n'est
jamais un jugement du modèle : c'est une recherche de sous-chaîne, tolérante aux
espaces, à la casse et à la ponctuation, pas au sens. Une citation introuvable
reste visible avec l'avertissement « citation non retrouvée, à vérifier ».

Ce skill décrit le déroulé de recherche avec les outils Légifrance
effectivement disponibles, puis le format exact que le vérificateur accepte.

## Outils du serveur MCP Légifrance

| Outil | Rôle |
| --- | --- |
| `Search_Jurisprudence` | Seul outil de recherche jurisprudentielle. Interroge en un appel Légifrance et Judilibre, fusionne les doublons et trie du plus récent au plus ancien. `query` et `juridictions` obligatoires (`cassation`, `appel`, `premiere_instance`, `conseil_etat`, `caa`). `matiere` obligatoire pour `cassation` (`CIVIL`, `COMMERCIAL`, `PENAL`, `SOCIAL`), `types_premiere_instance` obligatoire pour `premiere_instance`. Filtres facultatifs : `sources`, `publication_cassation`, `sieges_appel`, `villes_caa`, `publication_recueil`, `date_debut`, `date_fin`. |
| `Search_Code` | Recherche dans les codes juridiques français (Code civil, Code du travail…) — référence d'article exacte (`L. 1235-3`), mots-clés ou expression exacte. Renvoie les identifiants `LEGIARTI…` des articles trouvés. |
| `consulter_article` | Texte intégral et vigueur d'une version précise d'article, à partir de son identifiant `LEGIARTI…` rendu par `Search_Code`. |
| `consulter_decision` | Rapatrie le texte intégral d'une décision à partir de son identifiant Légifrance (`JURITEXT…`, `CETATEXT…`) ou Judilibre (24 caractères hexadécimaux). **Rapatrie le texte intégral et le met en cache** (voir plus bas) — c'est le moyen normal de lire une décision avant de la citer. |
| `Historique_Judiciaire` | Rend pour une décision (`JURITEXT…`, `CETATEXT…`) son historique procédural et le relevé des décisions qui la citent. |
| `Tracking_BODACC` | Situation d'une entreprise (procédures collectives) via son SIREN — hors jurisprudence, utile pour qualifier une partie. |
| `dictionnaire_juridique` | Définition d'un terme du lexique juridique officiel de justice.fr. |

`Search_Jurisprudence` applique la même requête aux deux bases (guillemets, `ET`,
`OU`, parenthèses, articles). Au-delà de 500 décisions après fusion des doublons, la recherche est refusée.
Judilibre ne couvre que l'ordre judiciaire.

## Recherche large : l'analyse tabulaire en mode recherche

Pour une question de droit qui mérite un balayage systématique plutôt qu'une
requête isolée, l'**analyse tabulaire en mode recherche** : une formulation
Légifrance et Judilibre, mêmes filtres et même syntaxe que les outils
Légifrance, au plus 500 décisions, une ligne par décision et une colonne par
question. La préparer avec `pm tabular_review preparer --mode recherche` : nom, requête et filtres, questions ou `modele`, IA. Le
formulaire rempli s'affiche à l'avocat, qui vérifie et lance. `lancer`
seulement si l'avocat l'a demandé dans le chat.

Une fois la revue faite, la lire avec `pm tabular_review lister`, puis
`ouvrir` : le fichier `Tabular Review/<fichier>.json` donne, pour chaque
ligne, l'identifiant de la décision (`decision`, et `aliases` quand elle
existe dans les deux bases), la copie lue par l'IA (`documents[0].copy`, sous
`Tabular Review/docs/`) et les réponses par question
(`cells[ligne][colonne].summary`, `.citations`).

### Le fait décisif : seuls deux chemins rendent une citation vérifiable

Le vérificateur ne peut confirmer une citation que si le texte de sa source
est quelque part sur disque :

- **Analyse tabulaire en mode recherche** : la copie Markdown de chaque
  décision (`Tabular Review/docs/`) est indexée sous son identifiant —
  vérifiable. Cette copie ne contient que la **partie retenue** (motifs et
  dispositif quand « Dispositif uniquement » est coché) : un extrait pris
  ailleurs dans la décision exige `consulter_decision`.
- **`consulter_decision`** renvoie le texte intégral dans sa réponse d'outil ;
  le harnais de citations (`harness/decisions.cjs`) le capte au passage et l'écrit dans
  `~/.piecemaker/decisions/<id>.json` — vérifiable.

**Conséquence pratique** : les résultats de `Search_Jurisprudence` (titre,
analyse, extraits) servent à trier. Dès qu'une décision doit être citée, il
faut d'abord la lire avec `consulter_decision` (ou dans la copie d'une analyse
tabulaire en mode recherche).

## Déroulé de recherche

1. **Recherche large** avec `Search_Jurisprudence`, sur les juridictions visées
   (ou, pour une question de droit qui mérite un balayage systématique plutôt
   qu'une requête isolée, l'analyse tabulaire en mode recherche préparée
   pour l'avocat). Pour un texte de loi, `Search_Code`.
2. **Tri** des résultats sur les seuls éléments déjà renvoyés (titre, analyse,
   date, extraits) — sans lire chaque décision en entier.
3. **Lecture** des seules décisions/articles retenus comme potentiellement
   cite-worthy : `consulter_decision` (jurisprudence) ou `consulter_article`
   (texte de loi), ou relecture de la copie d'une analyse tabulaire en mode
   recherche déjà faite (`Tabular Review/docs/`).
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
prend l'une des trois formes suivantes.

### Forme « jurisprudence » (`kind: "case"`)

Identifie la décision par `decision_id` — l'identifiant Légifrance
(`JURITEXT…`, `CETATEXT…`) ou Judilibre (24 caractères hexadécimaux) rendu par
`Search_Jurisprudence`, lu avec `consulter_decision`, ou l'identifiant rendu par
une analyse tabulaire en mode recherche (champ `decision` de la ligne), lu dans
la copie `Tabular Review/docs/` de cette analyse.

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

### Forme « article » (`kind: "article"`)

Identifie un article de code par `article_id` — l'identifiant `LEGIARTI…`
rendu par `Search_Code` et passé à `consulter_article`. Ne pas utiliser
l'identifiant du code (`LEGITEXT…`) ni une référence en clair (« art. 1103
C. civ. ») : seul le texte lu sous cet identifiant sert à la vérification.

```json
{
  "ref": 4,
  "kind": "article",
  "article_id": "LEGIARTI000012345678",
  "quotes": [
    { "quote": "les contrats légalement formés tiennent lieu de loi" }
  ]
}
```

Mêmes règles que pour une décision : jusqu'à 3 extraits littéraux, pas de
`doc_id`, `page`, `sheet` ni `cell`.

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

## Ce que fait le vérificateur, et quoi faire quand il signale une citation

À la fin du tour, le harnais de citations :

1. Parse le bloc `<CITATIONS>` du dernier message.
2. Pour chaque citation, résout sa source réelle — texte de la décision
   (analyse tabulaire en mode recherche ou `consulter_decision` de ce tour),
   de l'article, ou pièce Markdown du dossier.
3. Localise mécaniquement chaque extrait dans ce texte. Un extrait qui a
   légèrement dérivé (espace, casse, ponctuation) est **corrigé
   automatiquement** avec l'extrait source exact — ce n'est pas une faute.
4. Un extrait introuvable reste affiché avec l'avertissement « citation non
   retrouvée, à vérifier ». Le harnais ne bloque pas la réponse déjà diffusée.

Pour éviter cet avertissement : relire la source exacte et reprendre le texte
réel de l'extrait (jamais le reformuler pour le faire passer), ou retirer la
citation si elle ne peut pas être justifiée par une source effectivement lue.

## Ce qu'il ne faut pas faire

- Ne jamais citer une décision connue uniquement par un résultat de
  `Search_Jurisprudence` sans l'avoir d'abord lue avec `consulter_decision`.
- Ne jamais paraphraser un extrait pour qu'il « sonne » comme la source — le
  vérificateur tolère l'espace/la casse/la ponctuation, pas le sens.
- Ne jamais laisser un `ref` sauter un numéro ou repartir en désordre.
- Ne jamais dépasser 3 extraits par citation ni 25 mots par extrait.
- Ne jamais inventer un `decision_id` ou un `doc_id` pour combler un manque de
  source.
