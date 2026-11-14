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

```catala
champ d'application ResolutionUnilaterale:
  ## Écarter la résolution par principe
  étiquette base
  définition possible égal à faux
```

## Article 1226 | LEGIARTI000032041472

« Sauf urgence, il doit préalablement mettre en demeure le débiteur défaillant de satisfaire à son engagement dans un délai raisonnable. »

```catala
champ d'application ResolutionUnilaterale:
  ## Vérifier la résolution par notification
  exception base
  définition possible
  sous condition inexécution_grave et mise_en_demeure
  conséquence égal à
    vrai
```

## Article 1229 | LEGIARTI000032041443

« Lorsque les prestations échangées ne pouvaient trouver leur utilité que par l'exécution complète du contrat résolu, les parties doivent restituer l'intégralité de ce qu'elles se sont procuré l'une à l'autre. »

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
- Sous le titre, copiez l'extrait exact du texte entre « ». N'en inventez aucun mot.
- Placez chaque bloc ` ```catala ` sous l'article qui le fonde. Un même champ peut être défini par plusieurs blocs, chacun sous son article.
- Écrivez les justifications en commentaires `#` au-dessus de la règle, dont l'ordre choisi entre une exception et sa règle de base.
