# Format d'un fichier Catala

Ce modèle suit la programmation littéraire du livre Catala (`livre/5-1-literate-programming.md`). Il passe `clerk typecheck`, les tests, `catala-format` et `pm catala verifier` sans changement avec Catala 1.3. Partez de lui. `pm catala verifier` contrôle chaque règle de ce modèle et nomme la correction.

## Module : `resolution.catala_fr`

````
> Module Resolution

# Faits du dossier

```catala-metadata
déclaration énumération Prémisse:
  -- InexecutionGrave
  -- MiseEnDemeureRecue
  -- PrixFacture

déclaration énumération Fait:
  -- Prouvé contenu Prémisse
  -- NonProuvé

déclaration structure MontantProuvé:
  donnée valeur contenu argent
  donnée preuve contenu Prémisse

déclaration énumération FaitMontant:
  -- MontantÉtabli contenu MontantProuvé
  -- MontantNonProuvé

déclaration champ d'application ResolutionUnilaterale:
  ## Inexécution grave
  entrée inexécution_grave contenu Fait
  ## Mise en demeure reçue
  entrée mise_en_demeure contenu Fait
  ## Prix facturé
  entrée prix contenu FaitMontant
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
  sous condition
    inexécution_grave sous forme Prouvé
    et mise_en_demeure sous forme Prouvé
  conséquence égal à
    vrai
```

## Article 1229 | LEGIARTI000032041443

« Lorsque les prestations échangées ne pouvaient trouver leur utilité que par l'exécution complète du contrat résolu, les parties doivent restituer l'intégralité de ce qu'elles se sont procuré l'une à l'autre. »

```catala
champ d'application ResolutionUnilaterale:
  ## Calculer la restitution du prix
  définition restitution égal à
    si possible alors
      selon prix sous forme
      -- MontantÉtabli contenu montant : montant.valeur
      -- MontantNonProuvé : 0 €
    sinon 0 €
```
````

## Test : `test_resolution.catala_fr`

````
> Usage de Resolution

# Scénarios

```catala
#[test]
déclaration champ d'application TestResolution:
  résultat calcul contenu Resolution.ResolutionUnilaterale

champ d'application TestResolution:
  ## Calculer la résolution du dossier
  définition calcul égal à
    résultat de Resolution.ResolutionUnilaterale avec {
      -- inexécution_grave:
        Resolution.Fait.Prouvé contenu Resolution.Prémisse.InexecutionGrave
      -- mise_en_demeure:
        Resolution.Fait.Prouvé contenu Resolution.Prémisse.MiseEnDemeureRecue
      -- prix:
        Resolution.FaitMontant.MontantÉtabli contenu Resolution.MontantProuvé {
          -- valeur: 12 000 €
          -- preuve: Resolution.Prémisse.PrixFacture
        }
    }
  assertion calcul.possible
  assertion calcul.restitution = 12 000 €
```
````

## Prémisses

Chaque cas de l'énumération `Prémisse` désigne une fiche OKF : son nom, découpé en mots, sans accents, en minuscules et en tirets. `InexecutionGrave` désigne `okf:/_premises/inexecution-grave.md`. Confiez ces fiches à `premise-maker`. Il les cherche dans les pièces et les relie par des liens `states` cités.

- Une condition n'est remplie que par une prémisse citée : `fait sous forme Prouvé`. Le typage l'impose.
- Un fait chiffré (montant, date, durée) porte sa valeur et sa prémisse : une structure (`MontantProuvé`) dans une énumération propre (`FaitMontant`). Dans le test, écrivez `-- valeur:` puis `-- preuve:` sur la ligne suivante : la valeur est comparée à celle de la prémisse.
- Dans le test, un fait reste `NonProuvé` tant qu'aucune pièce ne le prouve. Nommez le cas par son module : `Resolution.Fait.Prouvé contenu Resolution.Prémisse.InexecutionGrave`.
- Gardez les déclarations dans un bloc ` ```catala-metadata ` : un module n'expose que ces blocs.

## Structure

- Reproduisez la hiérarchie du texte par les titres Markdown : `# Code civil`, puis `## Article 1224 | LEGIARTI…`. Pour une décision : `## Cass. civ. 3e, 1er janvier 2024, n° 00-00.000 | JURITEXT…`.
- Sous le titre, copiez l'extrait exact du texte entre « ». N'en inventez aucun mot.
- Placez chaque bloc ` ```catala ` sous l'article qui le fonde. Un même champ peut être défini par plusieurs blocs, chacun sous son article.
- Écrivez les justifications en commentaires `#` au-dessus de la règle, dont l'ordre choisi entre une exception et sa règle de base.
