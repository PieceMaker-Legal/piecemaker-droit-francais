# Format d'un fichier Catala

Ce modèle suit la programmation littéraire du livre Catala (`livre/5-1-literate-programming.md`). Il passe `clerk typecheck`, les tests, `catala-format` et `pm catala verifier` sans changement avec Catala 1.3. Partez de lui. `pm catala verifier` contrôle chaque règle de ce modèle et nomme la correction.

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
- Une constante d'énumération (`Inconnu`, une thèse) est une hypothèse du scénario : elle ne demande pas de lien.
- Confiez les prémisses à `premise-maker`. Il les cherche dans les pièces et les relie par des liens `states` cités.
- Gardez les déclarations dans un bloc ` ```catala-metadata ` : un module n'expose que ces blocs.

## Structure

- Reproduisez la hiérarchie du texte par les titres Markdown : `# Code civil`, puis `## Article 1224 | LEGIARTI…`. Pour une décision : `## Cass. civ. 3e, 1er janvier 2024, n° 00-00.000 | JURITEXT…`.
- Un article, une section : son titre, l'extrait appliqué entre « », puis le texte intégral de l'article, recopié mot pour mot, NOTA compris, puis ses blocs de code. N'en inventez aucun mot.
- Prenez la version en vigueur à la date retenue (`date_vigueur`). `pm catala verifier` compare le numéro, la vigueur et le texte intégral au texte officiel.
- Placez chaque bloc ` ```catala ` sous l'article qui le fonde, jamais sous un sous-titre sans source. Un même champ peut être défini par plusieurs blocs, chacun sous son article.
- Citez l'article (`LEGIARTI`, `JORFARTI`), jamais le texte entier (`LEGITEXT`, `JORFTEXT`). Tout identifiant cité ailleurs dans le fichier a sa propre section.
- Une étiquette qui nomme un article porte aussi son texte : `article_1224_code_civil`, pas `article_1224`.
- Écrivez les justifications en commentaires `#` au-dessus de la règle, dont l'ordre choisi entre une exception et sa règle de base.
