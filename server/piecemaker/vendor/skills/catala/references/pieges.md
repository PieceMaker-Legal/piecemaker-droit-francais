# Pièges Catala

Erreurs dont le message ne donne pas la correction. Pour les autres, suivez le message du compilateur ou de `pm catala verifier`. La syntaxe est dans `livre/` (voir la table de `SKILL.md`).

| Symptôme | Cause | Correction |
| --- | --- | --- |
| Un bloc de code est ignoré sans erreur | Bloc ouvert autrement que ` ```catala ` ou ` ```catala-metadata ` (espace, majuscule, suffixe) | Ouvrez le bloc exactement ainsi |
| Erreur de syntaxe sur une ligne de texte | Ligne de texte commençant par `>` | Reformulez : `>` est réservé aux directives (`> Module`, `> Usage de`) |
| « Type X is private » ou « Could not resolve reference » dans le test | Déclaration dans un bloc ` ```catala ` | Déclarez dans ` ```catala-metadata ` : un module n'expose que ces blocs |
| « No enum named A found » | Cas d'une énumération d'un autre module écrit `A.Cas` | Écrivez `A.Énumération.Cas` : `Resolution.Statut.Résolu` |
| Tests Python : `'function' object has no attribute …In` | Module et champ portent le même nom | Nommez le champ autrement que le module (`Resolution` / `ResolutionUnilaterale`) |
| Test ignoré ou erreur sur `#[test]` | Attribut mal placé | Mettez `#[test]` sur la ligne juste avant `déclaration champ d'application` |
| Erreur de syntaxe sur une entrée nommée `état` | `état` est un mot réservé | Choisissez un autre nom |
| Erreur sur `contenu texte` | Catala n'a pas de type texte | Modélisez un libellé par une énumération |
| « ambiguous date computation with no rounding mode specified » | Mois ou année ajouté à une fin de mois (31 janvier + 1 mois) | Choisissez l'arrondi d'après le texte : `Date.ajout_arrondi_inférieur` ou `Date.ajout_arrondi_supérieur` (`livre/5-2-types.md`, « Sémantique de l'addition de dates »). Testez la fin de mois |
| Montant décalé d'un centime, sans erreur | `argent` est arrondi au centime à chaque opération | Calculez en `décimal`, convertissez en `argent` à la fin |
| `format` : « Failed idempotence check » | Le formateur bute sur la construction | Gardez la forme écrite et signalez-le |
| Conflit signalé par la preuve | Deux définitions de même niveau peuvent s'appliquer ensemble | Lisez l'arbre (`pm catala exceptions`), puis donnez une `étiquette` à la règle générale et marquez l'autre `exception <étiquette>` (`livre/5-4-definitions-exceptions.md`). Justifiez l'ordre en commentaire `#` et signalez-le à l'avocat |
