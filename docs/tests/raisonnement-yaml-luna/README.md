# Essai YAML / objet JS avec Luna

Branche `yaml`, issue de `feat/raisonnement-redaction` au commit `90ec4073c2bfb978cc85d8620b16e5e2c3178ac5`. Essai du 25 octobre 2026. Le dossier, ses personnes, ses pièces et ses identifiants de sources sont fictifs ; les textes fournis sont des fixtures hors ligne, pas une recherche juridique actualisée.

## Ce qui a été construit

L'agent écrit librement tout le fichier `.piecemaker/raisonnement.yaml` par les moyens de son choix. Aucun outil de mutation ne lui impose des opérations atomiques. `pm raisonnement verifier` relit le fichier, contrôle les clés, applique le moteur existant, restitue les erreurs/manques et normalise le YAML. `pm acte exporter`, `importer` et `fusionner` conservent ce format.

Le format est YAML 1.2 core : les dates sont des chaînes, les booléens `true`/`false`, une inconnue `null`. `objectifs` est obligatoire et non vide ; les entrées doivent utiliser `objectif` et un verbe reconnu (`obtenir`, `écarter`, `réduire`, `augmenter`). Le même validateur métier qu'en JS refuse les clés inconnues ou mal placées. Les noms de termes et leur nombre restent libres ; les conditions se composent et se partagent par leurs noms. Commentaires et prose hors modèle, clés dupliquées, tags, documents multiples et alias circulaires sont refusés. Les alias ordinaires sont acceptés, mais développés à la normalisation ; ce ne sont pas des références métier persistantes.

Si les deux fichiers existent, YAML prime ; JS est utilisé en l'absence de YAML. Aucun changement n'a été fait au moteur de logique, de calcul ou d'objectifs. Cette isolation permet de comparer les écritures, sans attribuer au YAML un gain dû à un autre modèle de raisonnement.

## Protocole

Deux agents `gpt-6-luna`, effort `high`, ont rédigé indépendamment sur le même corpus `../acte-redige-haiku/` : `DOSSIER.md`, `SOURCES.md`, `pieces/`. Les instructions archivées ici ont la même base ; chemin, syntaxe, booléens et exemple sont convertis. La phrase demandant une délégation a été retirée dans les deux bras pour garder un seul rédacteur par format.

Chaque agent disposait de tous les fichiers de son dossier, du shell et d'une commande `./pm` appelant le vérificateur et l'exporteur réels. Il ne devait consulter ni l'autre essai, ni le moteur, ni des sources externes. Les connecteurs du banc lisent uniquement les pièces et les textes simulés du corpus ; registre actif simulé, aucune validation du droit positif en ligne. Chaque vérification archive l'entrée et sa sortie dans un journal hors dépôt. Les instructions et les modèles finaux sont conservés ici.

La première rédaction n'a pas suffi. Des relances ont demandé de continuer jusqu'à zéro erreur, puis de résoudre les manques documentables. Une relecture a ensuite demandé de distinguer l'allégation d'un défaut, la preuve du défaut et sa contradiction ; elle a aussi relevé une date YAML mal liée à son extrait et une qualification JS inadaptée. Ces interventions sont une partie du coût observé. Il s'agit d'un essai supervisé de convergence, pas d'une réussite autonome au premier jet.

Deux vérifications sont séparées :

1. **Transport d'un objet identique** : conversion JS/YAML, mêmes résultats annotés et diagnostics, en ignorant les numéros de ligne et l'ordre d'arrivée des pièces vérifiées en parallèle. Les quatre modèles du précédent essai et les rédactions présentes sont rejoués avec les pièces/sources du corpus.
2. **Rédaction libre par Luna** : même demande et même corpus, mais des choix de décomposition différents. Même somme demandée ne signifie pas même graphe ni même degré de justification.

## Résultats mesurés

| Mesure | Luna JS | Luna YAML |
|---|---:|---:|
| Demande en principal | 20 400 € | 20 400 € |
| Indemnités demandées | 80 € | 80 € |
| Objectifs explicités | 2 | 2 |
| Hypothèses explicites | 2 | 2 |
| Erreurs finales | 0 | 0 |
| Manques finaux | 5 | 5 |
| Vérifications explicites | 27 | 24 |
| Vérifications appelées par l'export | 5 | 2 |
| Sections du DOCX | 8 | 7 |
| Paragraphes du DOCX | 19 | 15 |

Les deux agents produisent les mêmes demandes chiffrées et laissent les deux objectifs **à établir**. Les réserves concernent l'exception d'inexécution, la date de saisine absente et les sections qui portent ces prétentions. Les cinq manques ne sont pas identiques : JS distingue deux contrôles de prescription et une exception globale ; YAML partage un contrôle de prescription et décompose l'inexécution et sa gravité. Les dépendances de l'indemnité diffèrent aussi. Les DOCX ne sont donc ni textuellement ni structurellement identiques.

La parité exacte est vérifiée séparément : chaque objet libre est réencodé dans l'autre syntaxe puis rejoué, et conserve ses résultats. [js-equivalent.yaml](js-equivalent.yaml) est la conversion exacte du [modèle JS de Luna](luna-js.js), sans nouvelle interprétation. [luna-yaml.yaml](luna-yaml.yaml) est la rédaction indépendante. [mesures.json](mesures.json) contient les vérifications successives, leurs compteurs, les statuts finaux et le contenu structuré des DOCX.

À objet JS identique, l'écriture canonique passe de **23 105 octets / 409 lignes en JS** à **21 993 octets / 445 lignes en YAML** : environ 4,8 % d'octets en moins, 8,8 % de lignes en plus. Cela ne mesure pas les tokens d'un modèle. La différence de taille entre les deux rédactions libres ne permettrait pas d'isoler le coût de syntaxe.

**56 tests passent**, dont la parité des quatre archives antérieures et des deux modèles Luna, les objectifs absents/vides, les clés incorrectes, les types, les citations échappées et multilignes, les alias, la profondeur de 80 termes, la persistance native et l'import/export/fusion Word. Le lint ciblé passe. Le typecheck serveur rencontre une erreur déjà présente au commit de départ dans `server/piecemaker/library/codex-options.ts:19` ; le même échec a été confirmé dans le worktree de référence. Aucun build n'a été lancé.

## Visuel de l'écriture

Fragment de structure, avec données fictives ; la preuve reste attachée à la condition plutôt que placée librement dans la prose :

```yaml
objectifs:
  - objectif: Obtenir le paiement des factures
    obtenir: créance_factures_exigible
créance_factures_exigible:
  si:
    - condition: obligation_de_paiement
      selon:
        - source: pieces/01_contrat_cadre.md
          citation: Les factures sont payables à trente jours à compter de leur date d'émission.
          validite: validité_de_la_clause_de_paiement
      preuve:
        - piece: pieces/02_facture_F-2025-014.md
          citation: "Montant TTC : 12 000,00 euros. Échéance : 2 avril 2025."
```

Le sous-raisonnement `validité_de_la_clause_de_paiement` a sa propre clé à la racine du modèle complet et peut être partagé. On ajoute de la profondeur logique en nommant des termes, sans déplacer tout le fichier sous une indentation croissante. L'agent peut lire uniquement ce terme, remonter aux objectifs qui le citent ou parcourir les dépendances après parsing.

## Comparaison pour l'agent

| Critère | Objet JS littéral actuel | YAML expérimental |
|---|---|---|
| Accès et édition | Fichier entier, accès libre | Identique |
| Objectifs et clés imposés | Validation métier | Même validation métier |
| Composition profonde | Termes nommés, références partagées | Même graphe ; test de 80 niveaux réussi |
| Syntaxe | Accolades, virgules, chaînes ; aucune fonction exécutée | Indentation, listes, scalaires ; attention aux deux-points et types |
| Citations et paragraphes | Chaînes entre accents graves possibles | Texte simple ou bloc multiligne ; sérialiseur gère les échappements |
| Lecture locale | Chercher un nom, lire la portion utile, parser l'objet | Même possibilité ; en-têtes de termes sans indentation à la racine |
| Query arbitraire | Parcourir l'objet après parsing | Parcourir le même objet après parsing ; aucun nouveau moteur de requêtes |
| Vérification | Sources, calculs, cas, objectifs, liens avec l'acte | Identique pour un objet identique |
| Extension du vocabulaire | Modifier le schéma pour une nouvelle clé métier | Même nécessité ; YAML ne rend pas le schéma extensible tout seul |
| Historique | Snapshot courant en base | Identique ; pas d'historique complet ajouté |

Le YAML convient à une mémoire déclarative relisible et éditable. Il ne résout pas à lui seul les erreurs de preuve, le choix de qualification ou les dépendances oubliées. Dans les deux essais, Luna a surtout appris les emplacements de clés à travers les retours du vérificateur. Une erreur d'indentation peut aussi déplacer un sous-arbre et rendre la structure fausse, même si le YAML reste syntaxiquement valide.

**Choix proposé : conserver le modèle commun, proposer YAML comme écriture native, garder JS comme compatibilité.** Ce test établit la faisabilité et la parité, sans établir une supériorité de fiabilité ou de vitesse. Pour garantir les justifications, les contrôles du modèle comptent davantage que les signes de ponctuation du format.

« Souplesse totale » signifie ici liberté d'écriture, de noms, de découpage et de partage des sous-raisonnements. Les relations restent celles que le moteur sait comprendre (`si`, `sauf`, `l_une`, sources, preuves, calculs, hypothèses, contrôles). Ajouter librement n'importe quelle relation ne lui donnerait pas une sémantique vérifiable. Le test de profondeur ne prouve pas une profondeur infinie.

## Limites observées

- Un dossier, un rédacteur par format, plusieurs relances : aucun classement statistique des modèles ou formats ; pas de mesure de tokens ni de coût disponible.
- Le vérificateur contrôle la présence et la retrouvabilité des citations, pas leur entailment juridique complet. L'agent peut citer un passage exact qui ne prouve pas sa conclusion. La relecture a trouvé ce problème dans l'essai.
- L'export existant bloque les erreurs de l'acte, mais pas toutes les erreurs du raisonnement. L'agent JS a pu exporter avant d'avoir zéro erreur ; ce comportement préexistant n'a pas été modifié dans l'expérience.
- `.piecemaker/` est exclu de l'historique automatique du dossier. La base remplace le snapshot courant en incrémentant la révision ; elle ne stocke pas chaque ancienne version. Ni JS ni YAML n'offrent donc ici l'historique cumulatif complet envisagé dans la discussion.
- La dépendance YAML est déclarée dans un manifeste local au module pour ne pas toucher au manifeste CloudCLI. Installation explicite requise ; le packaging de distribution n'est pas réalisé. Certaines anciennes commandes/modèles et libellés d'interface mentionnent encore JS. Aucun serveur ni application de bureau n'a été redémarré.

## Rejouer

Depuis la branche `yaml`, avec Node 24 et les dépendances principales déjà installées :

```sh
npm ci --prefix server/modules/piecemaker-reasoning
npx tsx --tsconfig server/tsconfig.json --test server/modules/piecemaker-reasoning/tests/yaml.test.ts server/modules/piecemaker-reasoning/tests/raisonnement.test.ts server/modules/piecemaker-reasoning/tests/acte.test.ts server/piecemaker/tests/acte-docx.test.ts server/piecemaker/tests/acte-yaml.test.ts
```

Pour rejouer un modèle final sur le corpus hors ligne, sans modifier les archives :

```sh
case_dir=$(mktemp -d)
cp -R docs/tests/acte-redige-haiku/pieces "$case_dir/pieces"
cp docs/tests/acte-redige-haiku/SOURCES.md "$case_dir/SOURCES.md"
mkdir "$case_dir/.piecemaker"
cp docs/tests/raisonnement-yaml-luna/luna-yaml.yaml "$case_dir/.piecemaker/raisonnement.yaml"
TSX_TSCONFIG_PATH=server/tsconfig.json npx tsx scripts/piecemaker/raisonnement-yaml/run.ts "$case_dir" yaml raisonnement verifier
TSX_TSCONFIG_PATH=server/tsconfig.json npx tsx scripts/piecemaker/raisonnement-yaml/run.ts "$case_dir" yaml acte exporter --sortie conclusions.docx
```

Le banc est réservé au test : il n'utilise pas les connecteurs juridiques de production. Les DOCX d'essai restent hors dépôt ; leur contenu structuré et les modèles source sont inspectés, leur mise en page n'a pas fait l'objet d'une validation visuelle.
