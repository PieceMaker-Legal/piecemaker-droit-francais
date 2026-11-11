# Syntaxe Catala en français — modèle vérifié

Ce modèle passe typecheck, format, tests Clerk et Python, et preuve avec Catala 1.3. Partez de lui plutôt que de mémoire. Le site catala-lang.org peut être inaccessible depuis l'agent : ne comptez pas sur lui.

## Module : `resolution.catala_fr`

````
> Module Resolution

## Article 1226 | LEGIARTI000032041472

```catala-metadata
déclaration champ d'application ResolutionUnilaterale:
  entrée mise_en_demeure contenu booléen
  entrée urgence contenu booléen
  entrée inexecution_persistante contenu booléen
  résultat possible contenu booléen
```

```catala
champ d'application ResolutionUnilaterale:
  étiquette base
  définition possible égal à faux

  exception base
  définition possible
  sous condition (mise_en_demeure ou urgence) et inexecution_persistante
  conséquence égal à
    vrai
```
````

## Test : `test_resolution.catala_fr`

````
> Usage de Resolution

```catala
#[test]
déclaration champ d'application TestUrgence:
  résultat calcul contenu Resolution.ResolutionUnilaterale

champ d'application TestUrgence:
  définition calcul égal à
    résultat de Resolution.ResolutionUnilaterale avec {
      -- mise_en_demeure: faux
      -- urgence: vrai
      -- inexecution_persistante: vrai
    }
  assertion calcul.possible
```
````

## Pièges fréquents

| Symptôme | Cause | Correction |
| --- | --- | --- |
| « Type X is private » ou « Could not resolve reference » dans le test | Déclaration dans un bloc ` ```catala ` | Déclarez dans ` ```catala-metadata ` |
| Tests Python : `'function' object has no attribute …In` | Module et champ portent le même nom | Nommez le champ autrement que le module (`Resolution` / `ResolutionUnilaterale`) |
| Erreur de syntaxe sur `est` | Définition écrite `définition x est …` | Écrivez `définition x égal à …` |
| Erreur de syntaxe sur une condition | `si … alors` utilisé pour une définition conditionnelle | Écrivez `sous condition … conséquence égal à …` |
| Test ignoré ou erreur sur `#[test]` | Attribut mal placé | Mettez `#[test]` sur la ligne juste avant `déclaration champ d'application` |
| Conflit signalé par la preuve | Deux définitions de même niveau peuvent s'appliquer ensemble | Donnez une `étiquette` à la règle générale et marquez l'autre `exception <étiquette>` |
| « Please add parentheses » | `et` et `ou` mélangés sans parenthèses | Parenthésez : `(a ou b) et c` |
| « Reserved builtin name » | Nom réservé (`nombre`, par exemple) | Choisissez un autre nom |
| `[WARNING] Unused variable` | Entrée qui ne sert à aucun résultat | Utilisez-la ou retirez-la |
| « Module declared as X, which does not match the file name » | Nom du module différent du nom du fichier | Nommez le module d'après le fichier : `resolution.catala_fr` → `> Module Resolution` |
| Citation : « Pièce hors du dossier » | Lien relatif qui remonte trop haut | Comptez depuis `.piecemaker/catala/<nom>/` : `../../../<chemin de la pièce>.md` |
| Citation : « Aucun extrait cité » | Aucune ligne `Citation :` sous le lien | Écrivez `Citation : « … »` juste sous le lien |
| Deuxième passage d'une source ignoré | Deux liens de même libellé vers la même source | Un lien par passage, avec un libellé distinct (`Pièce 3, prix` / `Pièce 3, délai`) |
| Citation : « Lien de source absent » | Espace dans le chemin du lien | Encodez chaque espace en `%20` |
| Variable sans valeur | Entrée non fixée dans le test | Fixez chaque entrée dans `avec { -- nom: valeur }` |

## Mots-clés utiles

- Types : `booléen`, `entier`, `décimal`, `argent`, `date`, `durée`, `liste de …`.
- Valeurs : `vrai`, `faux`, `10 €`, `|2024-01-31|`, `3 mois`, `15 jour`.
- Opérateurs : `et`, `ou`, `non` (parenthésez les mélanges), `=`, `>=`, `+`, `*`, `si … alors … sinon …` (dans une expression).
- Structures : `déclaration structure Nom:` puis `donnée champ contenu type`.
- Énumérations : `déclaration énumération Nom:` puis `-- Cas`, filtrées par `selon x sous forme -- Cas: … -- Autre: …`.
- Champ d'une structure : `personne.salaire`.

## Types admis

- Types de base : `contenu booléen`, `contenu entier`, `contenu décimal`, `contenu argent`, `contenu date`, `contenu durée`.
- Types composés : une énumération, une structure (`contenu Ligne`) ou une liste (`contenu liste de entier`).
- Catala n'a pas de type texte : n'écrivez jamais `contenu texte`. Modélisez un libellé par une énumération.
- `état` est un mot réservé : ne nommez pas une entrée `état`.

## Utiliser une énumération d'un autre module

Le module A déclare l'énumération dans un bloc `catala-metadata` : `a.catala_fr`.

````
> Module A

```catala-metadata
déclaration énumération État:
  -- Établi
  -- Écarté
  -- Inconnu
```
````

Le module B l'importe avec `> Usage de A`, puis écrit `A.État` pour le type et `A.État.Inconnu` pour le constructeur : `b.catala_fr`. `A.Inconnu` seul est refusé (« No enum named A found »).

````
> Module B
> Usage de A

```catala-metadata
déclaration champ d'application Qualification:
  entrée situation contenu A.État
  résultat retenu contenu booléen
```

```catala
champ d'application Qualification:
  définition retenu égal à
    selon situation sous forme
    -- A.État.Établi: vrai
    -- A.État.Écarté: faux
    -- A.État.Inconnu: faux
```
````

Un test qui fixe l'entrée écrit `résultat de B.Qualification avec { -- situation: A.État.Inconnu }` et, en tête de fichier, `> Usage de B` et `> Usage de A`.

## Bibliothèque standard

`pm catala env` donne `pack.env.CATALA_STDLIB`, le dossier des modules standard. Lisez-y les fichiers `*_fr.catala_fr` (`date_fr`, `decimal_fr`, `money_fr`, `list_fr`, `period_fr`…) pour connaître les fonctions exactes avant de les appeler.

## Lire une erreur

`pm catala verifier` affiche sous le contrôle en échec une ligne par erreur : `fichier:ligne.colonne: [ERROR] message`. Le compilateur propose souvent la correction (« Maybe you wanted to write: "égal à" »). Corrigez la première erreur, puis relancez : les suivantes en découlent souvent.
