# Format d'un fichier Catala

Ce modèle suit la programmation littéraire du livre Catala (`livre/5-1-literate-programming.md`). Il passe `clerk typecheck`, les tests et `catala-format` sans changement avec Catala 1.3. Partez de lui.

## Module : `resolution.catala_fr`

````
> Module Resolution

# Pièces du dossier

```catala-metadata
déclaration énumération Pièce:
  ## Mise en demeure du 2 mars 2026
  #[pm.preuve = "source: Pièces/mise-en-demeure.pdf | citation: Nous vous mettons en demeure de livrer la commande sous quinze jours. | by: agent"]
  -- MiseEnDemeure
  ## Facture du 5 janvier 2026
  #[pm.preuve = "source: Pièces/facture.pdf | citation: Total TTC : 12 000,00 € | by: agent"]
  -- Facture
  ## Constat d'inexécution
  #[pm.preuve = "source: okf:/_premises/inexecution-grave.md | by: human"]
  -- Constat
  ## Retard menaçant la saison de vente
  #[pm.preuve = "source: okf:/_premises/urgence.md | goal: établir que le retard menace la saison de vente | by: agent"]
  -- RetardSaison

déclaration énumération Fait:
  -- Prouvé contenu Pièce
  -- NonProuvé

déclaration structure PreuveMontant:
  donnée valeur contenu argent
  donnée pièce contenu Pièce

déclaration énumération FaitMontant:
  -- MontantProuvé contenu PreuveMontant
  -- MontantNonProuvé
```

# Code civil

## Article 1224 | LEGIARTI000032041482

« La résolution résulte soit de l'application d'une clause résolutoire soit, en cas d'inexécution suffisamment grave, d'une notification du créancier au débiteur ou d'une décision de justice. »

```catala-metadata
déclaration champ d'application ResolutionUnilaterale:
  ## Inexécution grave constatée
  entrée inexécution_grave contenu Fait
  ## Mise en demeure reçue
  entrée mise_en_demeure contenu Fait
  ## Urgence établie
  entrée urgence contenu Fait
  ## Prix facturé
  entrée prix contenu FaitMontant
  résultat possible contenu booléen
  résultat restitution contenu argent
```

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
  # La mise en demeure est exigée sauf urgence : les deux branches sont alternatives.
  ## Vérifier la résolution par notification
  exception base
  définition possible
  sous condition
    inexécution_grave sous forme Prouvé
    et (mise_en_demeure sous forme Prouvé ou urgence sous forme Prouvé)
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
      -- MontantProuvé contenu preuve : preuve.valeur
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
déclaration champ d'application TestSocieteExemple:
  résultat calcul contenu Resolution.ResolutionUnilaterale

champ d'application TestSocieteExemple:
  ## Calculer la résolution pour Société Exemple SAS
  définition calcul égal à
    résultat de Resolution.ResolutionUnilaterale avec {
      -- inexécution_grave: Resolution.Fait.Prouvé contenu Resolution.Pièce.Constat
      -- mise_en_demeure: Resolution.Fait.Prouvé contenu Resolution.Pièce.MiseEnDemeure
      -- urgence: Resolution.Fait.NonProuvé
      -- prix:
        Resolution.FaitMontant.MontantProuvé contenu Resolution.PreuveMontant {
          -- valeur: 12 000 €
          -- pièce: Resolution.Pièce.Facture
        }
    }
  assertion calcul.possible
  assertion calcul.restitution = 12 000 €
```
````

## Structure

- Reproduisez la hiérarchie du texte par les titres Markdown : `# Code civil`, puis `## Article 1224 | LEGIARTI…`. Pour une décision : `## Cass. civ. 3e, 1er janvier 2024, n° 00-00.000 | JURITEXT…`.
- Sous le titre, copiez l'extrait exact du texte entre « ». N'en inventez aucun mot.
- Placez chaque bloc ` ```catala ` juste sous l'article qui le fonde : sa position le rattache à ce texte. Un même champ peut être défini par plusieurs blocs, chacun sous son article.
- Titrez chaque définition, chaque entrée et chaque pièce par `## texte court` sur la ligne au-dessus. Ce titre nomme la case du graphe (« Style des titres » de `SKILL.md`). N'écrivez pas `#[doc]`.
- Écrivez les justifications en commentaires `#` au-dessus de la règle, dont l'ordre choisi entre une exception et sa règle de base.

## Faits prouvés par une pièce

Une condition n'est remplie que si une pièce est citée. Le typage l'impose.

1. Déclarez une seule fois, en tête du module, l'énumération `Pièce` : un cas par pièce, avec son titre `##` et un seul attribut `#[pm.preuve = "clé: valeur | clé: valeur"]`.
   - `source` (obligatoire) : chemin de la pièce depuis la racine du dossier, ou prémisse `okf:/_premises/<fiche>.md`.
   - `citation` : extrait exact qui prouve le fait. Obligatoire pour une pièce, facultative pour une prémisse `okf:`, qui porte déjà ses citations.
   - `goal` : pour une prémisse encore absente, à la place de `citation`, ce qu'elle doit établir. `premise-maker` la cherche dans les pièces.
   - `by` (obligatoire) : `agent` si vous avez posé le lien, `human` si l'avocat l'a posé ou doit le vérifier lui-même.
   - Séparez les clés par ` | `. Une citation contenant `|` ou `"` : choisissez un extrait plus court.
2. Une pièce qui prouve deux faits par deux passages donne deux cas (`MiseEnDemeureDate`, `MiseEnDemeureDélai`).
3. Déclarez un fait du dossier comme `entrée` de type `Fait` : `Prouvé contenu Pièce` ou `NonProuvé`.
4. Un fait chiffré (montant, date, durée) prouvé porte sa valeur et sa pièce : une structure (`PreuveMontant`) dans une énumération propre (`FaitMontant`). Les noms de cas restent distincts d'une énumération à l'autre.
5. Une condition teste la preuve : `fait sous forme Prouvé`. La valeur d'un fait chiffré se lit par `selon … sous forme` (`livre/5-5-expressions.md`, « Filtrage par motif »).
6. Dans le test, un fait reste `NonProuvé` tant qu'aucune pièce ne le prouve.
7. Dans le test, nommez le cas par son module : `Resolution.Fait.Prouvé contenu Resolution.Pièce.Constat`.
