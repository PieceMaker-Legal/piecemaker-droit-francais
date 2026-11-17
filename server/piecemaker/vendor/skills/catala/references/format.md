# Format d'un fichier Catala

Ce modèle suit la programmation littéraire du livre Catala (`livre/5-1-literate-programming.md`). Il passe `clerk typecheck`, les tests, `catala-format` et `pm catala verifier` sans changement avec Catala 1.3. Partez de lui. `pm catala verifier` contrôle chaque règle de ce modèle et nomme la correction.

## Écrire sans boucle

Le Hérisson compile chaque écriture. Un refus n'écrit rien : le fichier reste tel qu'avant.

1. Écrivez le dossier `.piecemaker/catala/<nom>/` au nom exact que donne `pm check`.
2. Copiez ce modèle, puis remplacez seulement les noms, les faits et les articles.
3. Ajoutez ensuite une section à la fois, avec Edit.
4. Après un refus, corrigez seulement la ligne citée, à l'aide des tableaux ci-dessous. Gardez le reste du texte. Ne réécrivez pas tout le fichier.

## Types et valeurs

Formes vérifiées avec Catala 1.3. Déclarations, dans ` ```catala-metadata ` :

```
déclaration champ d'application DelaiDePaiement:
  contexte facture_reçue condition
  contexte date_facture contenu date
  contexte montant contenu argent
  contexte jours_de_retard contenu entier
  contexte taux contenu décimal
  contexte délai contenu durée
  résultat date_limite contenu date
  résultat en_retard contenu booléen
  résultat pénalité contenu argent
```

Règles, dans ` ```catala ` sous leur article :

```
champ d'application DelaiDePaiement:
  définition délai égal à 30 jour
  définition date_limite égal à date_facture + délai
  définition en_retard égal à jours_de_retard > 0
  définition pénalité égal à
    si facture_reçue et en_retard alors montant * taux sinon 0 €
```

Valeurs, dans le test :

```
  règle calcul.facture_reçue rempli
  définition calcul.date_facture égal à |2024-01-15|
  définition calcul.montant égal à 1 500,50 €
  définition calcul.jours_de_retard égal à 3
  définition calcul.taux égal à 0,1
  assertion calcul.date_limite = |2024-02-14|
  assertion calcul.pénalité = 150,05 €
  assertion |2024-01-15| + 1 mois + 2 an = |2026-02-15|
```

Chaque fait du test porte aussi son `## okf:/_premises/<fiche>.md` (voir « Faits du dossier »).

## Fautes fréquentes

| Message du compilateur | Faute | Forme correcte |
|---|---|---|
| `Unknown built-in type` | `contenu montant`, `nombre`, `bool`, `texte` | `contenu argent`, `entier`, `décimal`, `booléen` ; un libellé est une énumération |
| `Syntax error at "jours"` (ou `"ans"`, `"années"`) | unité au pluriel | `30 jour`, `2 mois`, `1 an` |
| `Syntax error at "jour": » expected an expression` | `jour(30)`, unité avant le nombre | `30 jour` |
| `operator + on types date and integer` | `date_facture + 30` | `date_facture + 30 jour` |
| `Parsing error after token` | date au format français, `€1500` | date au format ISO entre barres verticales (ci-dessus), `1 500 €` |
| `operator / on types decimal and integer` | date sans barres : `15/01/2024` | date au format ISO entre barres verticales (ci-dessus) |
| `Syntax error at "50 €"` ou `a tuple was expected` | point décimal : `1500.50 €`, `0.1` | virgule : `1 500,50 €`, `0,1` |
| `Syntax error at "ET"` | mot-clé en majuscules | `et`, `ou`, `non`, `si … alors … sinon` en minuscules |
| `Syntax error at "="` après `définition x` | `définition x = 1` | `définition x égal à 1` |
| `Syntax error in preceding code block` | `si … alors …` sans `sinon` | `si … alors … sinon …` |
| `Module declared as X, which does not match the file name` | fichier `.catala_fr` nommé autrement que son module, par exemple avec des tirets | renommez le fichier `X.catala_fr` : nom du fichier = nom du module, sans tiret ; le dossier du programme garde son nom |
| `unknown identifier` | nom non déclaré ou mal orthographié | déclarez-le dans ` ```catala-metadata `, avec les mêmes accents |
| `titre « … » : écrivez 2 à 7 mots` | titre `##` d'une entrée trop court, trop long, avec `?` ou un identifiant | voir « Style des titres » du skill |
| `explication` : `Operator && applied to the wrong arguments` (`value ø`) ou `explain.ml … Assertion failed` | scénario qui ne remplit pas une `condition` lue par une règle : le test réussit, `catala explain` plante | écrivez `règle calcul.fait non rempli` pour chaque condition fausse du scénario |
| `règle sans source juridique` | bloc ` ```catala ` sous un titre sans identifiant | placez le bloc sous le titre de son article et son extrait, comme dans le modèle |

## Module : `resolution.catala_fr`

````
> Module Resolution

# Faits du dossier

```catala-metadata
déclaration champ d'application ResolutionUnilaterale:
  ## Inexécution grave
  contexte inexécution_grave condition
  ## Mise en demeure reçue
  contexte mise_en_demeure condition
  ## Prix facturé
  contexte prix contenu argent
  résultat possible contenu booléen
  résultat restitution contenu argent
```

# Code civil

## Article 1224 | LEGIARTI000032041482

« La résolution résulte soit de l'application d'une clause résolutoire soit, en cas d'inexécution suffisamment grave, d'une notification du créancier au débiteur ou d'une décision de justice. »

La résolution résulte soit de l'application d'une clause résolutoire soit, en
cas d'inexécution suffisamment grave, d'une notification du créancier au
débiteur ou d'une décision de justice.

```catala
champ d'application ResolutionUnilaterale:
  ## Écarter la résolution par principe
  étiquette base
  définition possible égal à faux
```

## Article 1226 | LEGIARTI000032041472

« Sauf urgence, il doit préalablement mettre en demeure le débiteur défaillant de satisfaire à son engagement dans un délai raisonnable. »

Le créancier peut, à ses risques et périls, résoudre le contrat par voie de
notification. Sauf urgence, il doit préalablement mettre en demeure le débiteur
défaillant de satisfaire à son engagement dans un délai raisonnable.

La mise en demeure mentionne expressément qu'à défaut pour le débiteur de
satisfaire à son obligation, le créancier sera en droit de résoudre le contrat.

Lorsque l'inexécution persiste, le créancier notifie au débiteur la résolution
du contrat et les raisons qui la motivent.

Le débiteur peut à tout moment saisir le juge pour contester la résolution. Le
créancier doit alors prouver la gravité de l'inexécution.

```catala
champ d'application ResolutionUnilaterale:
  ## Vérifier la résolution par notification
  exception base
  définition possible
  sous condition inexécution_grave et mise_en_demeure
  conséquence égal à
    vrai
```

## Article 1229 | LEGIARTI000032041457

« Lorsque les prestations échangées ne pouvaient trouver leur utilité que par l'exécution complète du contrat résolu, les parties doivent restituer l'intégralité de ce qu'elles se sont procuré l'une à l'autre. »

La résolution met fin au contrat.

La résolution prend effet, selon les cas, soit dans les conditions prévues par
la clause résolutoire, soit à la date de la réception par le débiteur de la
notification faite par le créancier, soit à la date fixée par le juge ou, à
défaut, au jour de l'assignation en justice.

Lorsque les prestations échangées ne pouvaient trouver leur utilité que par
l'exécution complète du contrat résolu, les parties doivent restituer
l'intégralité de ce qu'elles se sont procuré l'une à l'autre. Lorsque les
prestations échangées ont trouvé leur utilité au fur et à mesure de l'exécution
réciproque du contrat, il n'y a pas lieu à restitution pour la période
antérieure à la dernière prestation n'ayant pas reçu sa contrepartie ; dans ce
cas, la résolution est qualifiée de résiliation.

Les restitutions ont lieu dans les conditions prévues aux articles 1352 à
1352-9.

```catala
champ d'application ResolutionUnilaterale:
  ## Calculer la restitution du prix
  définition restitution égal à si possible alors prix sinon 0 €
```
````

## Test : `test_resolution.catala_fr`

````
> Usage de Resolution

# Scénarios

```catala
#[test]
déclaration champ d'application TestResolution:
  résultat calcul champ d'application Resolution.ResolutionUnilaterale

champ d'application TestResolution:
  ## okf:/_premises/inexecution-grave.md
  règle calcul.inexécution_grave rempli
  ## okf:/_premises/mise-en-demeure.md
  règle calcul.mise_en_demeure rempli
  ## okf:/_premises/prix.md
  définition calcul.prix égal à 12 000 €
  assertion calcul.possible
  assertion calcul.restitution = 12 000 €
```
````

## Faits du dossier

- Déclarez chaque fait du dossier comme un `contexte` titré : `condition` s'il est vrai ou faux, `contenu argent`, `entier` ou `date` s'il porte une valeur.
- Une `condition` est fausse tant qu'aucune règle ne la remplit. Dans le test, écrivez `règle calcul.fait rempli` pour un fait établi, `définition calcul.prix égal à …` pour une valeur.
- Justifiez chaque fait du scénario : écrivez `## okf:/_premises/<fiche>.md` juste au-dessus. `pm catala verifier` refuse un fait sans ce lien, une fiche sans pièce citée et une valeur différente de celle de la prémisse. Il avertit quand le lien de la pièce a été posé par l'avocat.
- Chaque entrée et chaque `contexte` fait du champ métier est fixé, dans le scénario du dossier (le champ qui cite des prémisses), par un fait sous `## okf:/_premises/<fiche>.md` ou par une expression calculée à partir de tels faits. Une constante (`Inconnu`, `Établi`, `vrai`, un montant) posée sans prémisse est refusée, même enveloppée dans une définition ou un champ de structure : le contrôle `premisses` de `pm catala verifier` remonte jusqu'à la ligne qui l'écrit.
- Si aucune pièce n'établit le fait, écrivez `## Sans prémisse : <ce qui manque>` juste au-dessus de la ligne qui le fixe. Le contrôle l'accepte avec une alerte, que l'avocat lit.
- Une prémisse ne sert que si son fait calcule une entrée. Une liste de prémisses en prose, ou un fait qui ne nourrit qu'une liste documentaire, ne relie rien : `pm catala verifier` signale chaque prémisse de l'index qui ne fixe aucune entrée.
- Les scénarios d'hypothèse, sans prémisse citée, fixent librement leurs entrées.
- Établissez les prémisses avec le skill `okf` : cherchez-les dans les pièces et reliez-les par des liens `states` cités.
- Gardez les déclarations dans un bloc ` ```catala-metadata ` : un module n'expose que ces blocs.

## Structure

- Reproduisez la hiérarchie du texte par les titres Markdown : `# Code civil`, puis `## Article 1224 | LEGIARTI…`. Pour une décision : `## Cass. civ. 3e, 1er janvier 2024, n° 00-00.000 | JURITEXT…`.
- Un article, une section : son titre, l'extrait appliqué entre « », puis le texte intégral de l'article, recopié mot pour mot, NOTA compris, puis ses blocs de code. N'en inventez aucun mot. `pm catala section` écrit le titre, l'extrait vérifié et le texte officiel.
- Prenez la version en vigueur à la date retenue (`date_vigueur`). `pm catala verifier` compare le numéro, la vigueur et le texte intégral au texte officiel.
- Placez chaque bloc ` ```catala ` sous l'article qui le fonde, jamais sous un sous-titre sans source. Un même champ peut être défini par plusieurs blocs, chacun sous son article.
- Citez l'article (`LEGIARTI`, `JORFARTI`), jamais le texte entier (`LEGITEXT`, `JORFTEXT`). Une section = une source : un identifiant n'apparaît que dans le titre de sa section, jamais dans le texte d'une autre section ni dans une liste de sources. Le Hérisson refuse l'écriture sinon.
- Une étiquette qui nomme un article porte aussi son texte : `article_1224_code_civil`, pas `article_1224`.
- Écrivez les justifications en commentaires `#` au-dessus de la règle, dont l'ordre choisi entre une exception et sa règle de base.
