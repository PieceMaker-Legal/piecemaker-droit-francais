---
name: catala
description: Écrire et vérifier un programme Catala qui code une règle juridique du dossier (calcul de montant, de délai, de seuil, conditions et exceptions) — fiche de syntaxe vérifiée, typecheck, format, tests clerk, tests Python, squelette de test, trace d'exécution, arbre des exceptions, preuve d'absence de conflit entre exceptions, explication d’une exécution, vigueur des articles cités avec catleg. Use when the user asks for Catala, a formal or executable version of a legal rule, a proof that exceptions do not overlap, or a check that cited articles are still in force.
---

# Catala

Catala code une règle juridique en programme exécutable. Le pack Catala est installé par l'app de bureau PieceMaker. Lancez chaque outil par `pm catala`, jamais par un chemin direct.

## Classement

Un programme Catala vit dans `.piecemaker/catala/<nom>/`. `<nom>` s'écrit en minuscules, chiffres et tirets. Un dossier peut contenir plusieurs programmes ; indiquez alors `--programme <nom>`.

```
.piecemaker/catala/
  prime-anciennete/              programme Catala
    clerk.toml                   [project] name = "prime-anciennete"
    prime.catala_fr              > Module Prime
    test_prime.catala_fr         > Usage de Prime, scopes #[test]
    resultats/                   écrit par pm catala, ne pas modifier
```

## Écrire le programme

Lisez d'abord `references/syntaxe.md` : modèle vérifié, pièges fréquents, mots-clés et bibliothèque standard. Partez de ce modèle, pas de mémoire.

1. Créez `clerk.toml` avec `[project]` et `name = "<nom>"`.
2. Écrivez le module : `> Module Nom` en tête, nom de fichier en minuscules (`nom.catala_fr`).
3. Mettez les déclarations exposées aux autres fichiers dans des blocs ` ```catala-metadata `. Un module n'expose que ces blocs. Sinon les tests échouent à la compilation (« Could not resolve reference »).
4. Mettez les définitions dans des blocs ` ```catala `. Citez le texte en Markdown au-dessus du bloc qui le code.
5. Reprenez les pièces et citations du dossier dans le Markdown associé à chaque règle ou donnée. Écrivez les extraits sous la forme `Citation : « passage exact »` après leur lien. Évitez les lignes commençant par `>` : Catala les réserve à ses directives. Titrez chaque article cité `## Article 1218 | LEGIARTI000032041431`. catleg lit ces titres. Placez l'article ou la décision qui fonde une règle juste avant le bloc ` ```catala ` de cette règle : le volet les rattache à elle. Pour rattacher une pièce ou une source à une donnée ou à une autre règle, écrivez dans sa section `Concerne : <identifiant>` (plusieurs identifiants séparés par des virgules). Le volet montre les sources non rattachées à part. Nommez les identifiants en français, avec les accents (`mise_en_demeure`, `résolution_possible`) : le volet les affiche tels quels à l'avocat.
6. Écrivez les tests dans `test_<module>.catala_fr` : `> Usage de Nom`, un champ d'application `#[test]` par scénario, avec `assertion`. Utilisez des faits fictifs ou ceux du dossier, jamais d'autres.
7. Codez une exception avec `étiquette` et `exception`. Deux exceptions qui peuvent s'appliquer ensemble sont un conflit : `pm catala verifier` le détecte.

## Construire le graphe du raisonnement

Lisez `references/graphe.md` avant d'écrire ou reprendre un raisonnement destiné au graphe. Séparez les faits, leur qualification, les conditions et les exceptions. Une valeur de scénario ne prouve aucun fait.

## Documentation obligatoire du raisonnement

1. Ajoutez un attribut natif `#[doc="…"]` à chaque définition et règle exécutable, y compris dans les scénarios.
2. Dans chaque `#[doc]`, indiquez `titre: …`, `source: URL ou chemin` et une balise `quote: « passage exact »` non vide. Rédigez le titre selon « Style des titres ».
3. Pour une règle, citez son fondement juridique. Pour une donnée factuelle, citez la pièce qui la soutient.
4. Pour une qualification ou un calcul, citez le fondement de l’opération et gardez les dépendances vers les faits distincts.
5. Conservez les titres juridiques avec identifiant. Utilisez les inclusions natives de PDF seulement comme annexes documentaires.
6. Lancez `pm catala verifier`. Corrigez chaque erreur `#[doc] manquant`, `quote manquante ou vide dans #[doc]` et `titre manquant dans #[doc]`.
7. Si une source ou citation manque, signalez le manque et recherchez-la. N’inventez aucun passage pour satisfaire le contrôle.

`doc` est un attribut natif Catala. `titre`, `source` et `quote` sont des conventions PieceMaker dans son texte, pas des attributs natifs spécialisés.
Le graphe et le contrôle des citations lisent cette annotation. Un `#[doc]` précis prime sur les sources du texte voisin.
Une citation Markdown extérieure ne remplace pas la balise `quote` obligatoire. Les anciens liens restent lisibles pour compatibilité.

## Style des titres

Le titre nomme la case du graphe. L’avocat le lit sans le code. Aucun contrôle ne vérifie ce style : relisez chaque titre.

| Case | Forme | Exemples | À éviter |
|---|---|---|---|
| Règle, condition, qualification, calcul | Verbe d’action à l’infinitif, puis son objet | `Vérifier le montant demandé`, `Calculer l’indemnité` | `Montant`, `Le montant est-il dû ?` |
| Fait (sa `source` est une pièce) | Nom, puis participe passé qui constate | `Montant demandé`, `Contrat conclu` | `Contrat`, `Vérifier le contrat` |

- Écrivez dans la langue du programme. En anglais : `Check the amount claimed`, `Amount claimed`.
- Écrivez 2 à 7 mots. N’écrivez ni phrase, ni question, ni point final, ni identifiant (`montant_demandé`), ni numéro d’article.
- Reprenez les mêmes mots dans la condition et dans le fait qui la valide : `Vérifier le montant demandé`, `Montant demandé`.
- N’annoncez pas le résultat dans le titre d’une règle : la couleur de la case le donne.

## Commandes

Contrôler, une seule commande :

- `pm catala verifier --programme <nom> --au AAAA-MM-JJ` met les fichiers au format officiel, puis lance tous les contrôles : typage avec invariants, tests Clerk/Python, preuve de chaque champ métier, Catleg, citations PieceMaker et graphe du scénario réussi. Le volet se met à jour après la commande.
- La commande réécrit les fichiers : relisez un fichier signalé « reformatés » avant de le modifier.
- Sous un contrôle en échec, le bilan donne une ligne par erreur (`fichier:ligne.colonne: [ERROR] message`) ou par test faux (`fichier:ligne › Scenario : message`). Tant que la compilation échoue, les contrôles qui en dépendent sont bloqués : corrigez d'abord la compilation.
- Un `[WARNING]` de preuve est un échec : lisez le contre-exemple dans `resultats/preuve.log`.
- Corrigez et relancez jusqu'à « vérifié ».

Comprendre un échec :

- `pm catala executer --scope <Scenario> [--fichier F]` exécute un champ sans entrées et affiche sa trace : valeur de chaque variable et règle appliquée. Utilisez-la pour un test qui échoue.
- `pm catala exceptions --scope <Champ> --variable <v> [--fichier F]` affiche l'arbre des exceptions d'une variable. Utilisez-la pour un conflit signalé par la preuve.
- `pm catala expliquer --scope <Scenario> [--fichier F]` produit le graphe d'un autre scénario. Voir « Expliquer une exécution ».

Écrire :

- `pm catala squelette --scope <Champ> [--fichier F]` génère un test dont les entrées ont leur valeur par défaut. Copiez-le dans `test_<module>.catala_fr`, puis fixez les faits et ajoutez les assertions.

Hors parcours : `pm catala lister` (programmes et dernier bilan), `pm catala env` (pack, Python) et `pm catala exec <outil> -- <arguments>` (outil du pack, pour un éditeur).

## Expliquer une exécution

Choisissez un champ sans entrées : ses données doivent être fixées dans le scénario. Indiquez `--fichier` quand le programme contient plusieurs fichiers.

La vérification produit déjà le graphe. Utilisez `expliquer` pour choisir un autre scénario. Le volet présente chaque règle avec son fondement, sa valeur Vrai ou Faux dans le scénario et les faits qui la justifient, en vue écrite et en graphe. Aucun Graphviz n’est nécessaire.

L’explication concerne cette exécution seulement. Elle ne remplace ni les tests, ni la preuve du programme, ni la justification des faits.

Les résultats vont dans `.piecemaker/catala/<nom>/resultats/` : `verification.json`, `tests.json`, `preuve.json`, `catleg.json`, `citations.json`, `explication.json`, `explication.dot` et un journal par contrôle.

Le bilan distingue réussite, échec, contrôle bloqué et contrôle indisponible. Catleg et les citations tournent en parallèle ; les commandes qui utilisent `_build` restent séquentielles. Le contrôle des citations réutilise PieceMaker, le MCP Légifrance et les identifiants PISTE existants. Il vérifie les extraits déclarés, sans ajouter de raisonnement juridique.

## Limites à dire à l'avocat

- Catleg vérifie les articles reconnus dans les titres Markdown, avec les identifiants PISTE existants. Zéro article contrôlé ne vaut jamais validation. La date de vigueur vient uniquement de `--au AAAA-MM-JJ` ; sans `--au`, `pm catala verifier` marque Catleg « non effectué ». En conseil ou en rédaction de contrat, donnez la date du jour. En contentieux, donnez la date à laquelle le droit s’apprécie (conclusion du contrat, fait générateur, acte de procédure) ; demandez-la à l’avocat si elle est incertaine. Catleg compare la période officielle de chaque article à cette date, y compris pour un article abrogé depuis. Ce contrôle ne prouve pas l’applicabilité juridique ni les dispositions transitoires.
- Catala 1.3 peut omettre des obligations pour des définitions globales. La preuve valide seulement les obligations produites. Une preuve sans obligation échoue.
- Une preuve porte sur le programme. Elle ne prouve ni les faits, ni la fidélité du programme au texte.
- Le programme ne lit pas les pièces. Le lien entre les entrées du programme et les pièces passe par une table des sources que l'avocat construit (qualification, lien officiel, pièce).
- Si le contrôle `format` échoue avec « Failed idempotence check », le formateur bute sur la construction : gardez la forme écrite et signalez-le.

Répondez à l'avocat sans code : la règle codée, les scénarios testés, le résultat des contrôles et ces limites.
