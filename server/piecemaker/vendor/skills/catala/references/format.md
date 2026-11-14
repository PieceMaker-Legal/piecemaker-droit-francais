# Format d'un fichier Catala

Ce modèle suit le livre Catala (programmation littéraire, chapitre 5-1). Il passe `clerk typecheck` et `catala-format` sans changement avec Catala 1.3. Partez de lui.

## Module : `resolution.catala_fr`

````
> Module Resolution

# Code civil

## Article 1224 | LEGIARTI000032041482

« La résolution résulte soit de l'application d'une clause résolutoire soit, en cas d'inexécution suffisamment grave, d'une notification du créancier au débiteur ou d'une décision de justice. »

```catala-metadata
déclaration champ d'application ResolutionUnilaterale:
  ## Inexécution grave établie
  #[piecemaker.source = "okf:/_premises/inexecution-grave.md"]
  entrée inexécution_grave contenu booléen
  ## Mise en demeure reçue
  #[piecemaker.source = "pieces/02-mise-en-demeure.md"]
  #[piecemaker.citation = "Nous vous mettons en demeure de livrer la commande sous quinze jours."]
  entrée mise_en_demeure contenu booléen
  ## Urgence établie
  #[piecemaker.source = "okf:/_premises/urgence.md"]
  #[piecemaker.question = "Le retard menace-t-il la saison de vente ?"]
  entrée urgence contenu booléen
  résultat possible contenu booléen
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
  sous condition inexécution_grave et (mise_en_demeure ou urgence)
  conséquence égal à
    vrai
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
      -- inexécution_grave: vrai
      -- mise_en_demeure: vrai
      -- urgence: faux
    }
  assertion calcul.possible
```
````

## Règles

- Reproduisez la hiérarchie du texte par les titres Markdown : `# Code civil`, puis `## Article 1224 | LEGIARTI…`. Catleg lit ce titre d'article : gardez la forme `Article N | LEGIARTI…`. Pour une décision : `## Cass. civ. 3e, 1er janvier 2024, n° 00-00.000 | JURITEXT…`.
- Sous le titre, copiez l'extrait exact du texte en texte libre, entre « ». Vérifiez-le contre Légifrance. N'en inventez aucun mot.
- Placez le bloc ` ```catala ` juste sous l'article qui le fonde : sa position le rattache à ce texte. N'écrivez ni `Concerne :` ni citation en double pour une règle.
- Un même champ d'application peut être défini par plusieurs blocs, chacun sous son article.
- Titrez chaque définition et chaque entrée par `## texte court` sur la ligne au-dessus : ce titre nomme la case du graphe (voir « Style des titres » de `SKILL.md`).
- Un fait du dossier est une `entrée` portant `#[piecemaker.source = "okf:/_premises/<fiche>.md"]`. La prémisse porte les pièces et leurs citations.
- Une prémisse encore absente porte aussi `#[piecemaker.question = "…"]` : `premise-maker` la cherche dans les pièces.
- Une pièce citée directement porte `#[piecemaker.source = "<chemin de la pièce>"]` et `#[piecemaker.citation = "extrait exact"]`. Le chemin part de la racine du dossier.
- Écrivez les justifications et le raisonnement en commentaires `#` au-dessus de la règle. Justifiez ainsi l'ordre d'une exception.
- N'écrivez pas `#[doc]`. Le titre `##` est sa forme courte : il documente le rôle de l'élément, jamais sa source ni sa citation.
- Évitez les lignes de texte commençant par `>` : Catala les réserve à ses directives.
