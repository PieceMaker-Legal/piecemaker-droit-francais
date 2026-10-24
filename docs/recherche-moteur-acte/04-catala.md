# Catala : inspirations ciblées pour le raisonnement PieceMaker

Analyse arrêtée au commit [`f32ea23ef35d1c55c874a5bc13788c8a7c26adfa`](https://github.com/CatalaLang/catala/tree/f32ea23ef35d1c55c874a5bc13788c8a7c26adfa), daté du 23 octobre 2026 selon l’identifiant fourni. PieceMaker a volontairement abandonné le langage Catala maison au profit d’un objet JavaScript déclaratif non exécuté. Cette note cherche des contrôles locaux applicables au modèle existant, sans réintroduire Catala comme représentation générale ou moteur.

## Ce que Catala fait

**Constat.** Le README décrit Catala comme un langage dédié à la programmation législative littéraire : le texte normatif est annoté article par article avec sa représentation informatique, puis compilé en algorithmes. Les exceptions et définitions sous conditions sont des éléments centraux de sa sémantique. Le compilateur est en OCaml, ses AST et opérateurs typés se trouvent notamment dans [`compiler/shared_ast/definitions.ml`](https://github.com/CatalaLang/catala/blob/f32ea23ef35d1c55c874a5bc13788c8a7c26adfa/compiler/shared_ast/definitions.ml). Ce fichier distingue explicitement les types `date`, `duration`, `money` et les opérateurs arithmétiques typés ; les traces peuvent conserver une balise `Exception` portant étiquette et position source.

Le dépôt est Apache-2.0, sauf licence différente indiquée dans un sous-dossier. Sa documentation qualifie le compilateur de projet de recherche, encore instable et incomplet, et ne mentionne qu’une preuve formelle partielle de certification du compilateur. Le projet publie des versions numérotées (1.2.1 est indiquée comme dernière stable) et une nightly sans garantie de stabilité. Sa maturité reste celle d’un projet de recherche, pas une promesse d’API stable.

## Réemplois incrémentaux possibles

**Définitions concurrentes, pas conditions `si`.** Dans Catala, le conflit apparaît quand plusieurs définitions proposent des conséquences concurrentes pour une même variable. Une exception explicitement prioritaire peut trancher ; sans priorité unique, l’évaluation signale le conflit et ses emplacements sources. Prioriser des exceptions reste une décision d’interprétation juridique. Ce mécanisme ne correspond pas au `si` PieceMaker : `si` est une conjonction de conditions d’une définition, non une famille de conséquences alternatives. Il n’y a donc pas lieu d’exiger l’exclusivité entre ses conditions, ni de changer `si` ou `sauf`. **Inférence :** le motif Catala ne deviendrait utile que si PieceMaker ajoutait un jour des formules ou régimes concurrents capables de produire plusieurs conséquences pour une même valeur ; on pourrait alors diagnostiquer les chevauchements non résolus sans importer sa logique.

**Types monétaires et unités.** Catala sépare `money`, `decimal`, `integer`, `date` et `duration`. Les décimaux sont rationnels de précision arbitraire ; `money` est défini au centime ; conversions et arrondis sont explicites. PieceMaker peut distinguer montant en euros, pourcentage, jours, durée et date dans ses valeurs/calculs. **Limite :** `money` n’est pas un système général d’unités ou de devises ; le modèle doit nommer devise, période et base de calcul si ces distinctions importent.

**Tests de frontières et régressions.** Dans [`tests/README.md`](https://github.com/CatalaLang/catala/blob/f32ea23ef35d1c55c874a5bc13788c8a7c26adfa/tests/README.md), les tests sont des fichiers source avec sorties attendues ; ils peuvent être rejoués sous plusieurs modes d’interprétation. **Inférence :** PieceMaker pourrait ajouter des cas couvrant seuil égal/inférieur/supérieur, dates inclusives/exclusives, fin de mois, valeur manquante et limites des calculs. Chaque cas resterait une donnée d’essai du modèle existant, avec résultat attendu à trois valeurs et éventuel résultat calculé.

**Portée limitée de formalisation.** Catala associe des définitions à un texte de loi et peut produire un PDF lisible par un juriste. Pour PieceMaker, une formalisation légère pourrait couvrir seulement le calcul ou l’embranchement contestable, avec références précises et règle d’interprétation choisie, sans formaliser l’acte entier ni déduire le droit de la prose. Faits, preuve, hypothèse et conclusion restent distincts dans l’objet courant.

**Traçabilité de calcul.** Les erreurs de conflit Catala indiquent les définitions concurrentes ; la balise `Exception` de l’AST garde étiquette et position source. Le moteur PieceMaker lu au commit `90ec4073c`, sur une autre branche que celle de cette recherche, enregistre déjà les résultats dans `trace` et renvoie des détails de calcul (dates retenues, montant et seuil). **Inférence :** l’apport possible est de rendre cette trace explicative de bout en bout : condition vraie/fausse/inconnue, calcul intermédiaire et référence de chaque condition à sa source datée exacte ; seules d’éventuelles conséquences concurrentes futures appelleraient un diagnostic de conflit. La traçabilité ne prouve pas, à elle seule, la validité juridique des sources saisies.

## Conclusion

Catala apporte ici des exemples de conception pour typer les calculs, choisir des cas de frontière, borner une formalisation et relier résultat et sources. Le contrôle de conséquences concurrentes ne serait utile que si le modèle PieceMaker évoluait vers plusieurs formules concurrentes ; il ne modifie pas la sémantique présente de `si` et `sauf`. Le compilateur et le runtime Catala restent propres à son approche exécutable ; les reprendre dans leur ensemble ajouterait une dépendance OCaml et les limites de maturité signalées par le projet.

## Sources primaires consultées

- [README Catala au SHA étudié](https://github.com/CatalaLang/catala/blob/f32ea23ef35d1c55c874a5bc13788c8a7c26adfa/README.md)
- [AST et opérateurs typés : `compiler/shared_ast/definitions.ml`](https://github.com/CatalaLang/catala/blob/f32ea23ef35d1c55c874a5bc13788c8a7c26adfa/compiler/shared_ast/definitions.ml)
- [Suite de tests au SHA étudié](https://github.com/CatalaLang/catala/blob/f32ea23ef35d1c55c874a5bc13788c8a7c26adfa/tests/README.md)
- [Manuel : conflits et exceptions](https://book.catala-lang.org/en/2-2-conditionals-exceptions.html), [types monétaires et numériques](https://book.catala-lang.org/en/5-2-types.html), [types de base et conversions](https://book.catala-lang.org/en/4-2-catala-specific.html)
- [Releases Catala](https://github.com/CatalaLang/catala/releases)
- Code PieceMaker lu statiquement au commit `90ec4073c` : `git show 90ec4073c:server/modules/piecemaker-reasoning/engine.ts` (fonctions `compile`, `decisive`, `evaluate`, `calculate`, `simulate`, `runTrials`).
