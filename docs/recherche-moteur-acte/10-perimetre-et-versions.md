# Périmètre et versions de la recherche

Recherche du 24 octobre 2026, demandée pour identifier des projets publics pouvant apporter quelque chose au moteur de raisonnement et à l'acte de PieceMaker. Les analyses individuelles sont confiées à Luna (`gpt-6-luna`, effort `high`), puis relues et consolidées par l'agent principal. Les sources sont les dépôts, leur code et la documentation des auteurs. Les essais proposés dans les rapports n'ont pas été exécutés.

## État PieceMaker retenu

La branche de travail de cette recherche est `MAJ-continue`. Les changements de raisonnement ont été lus depuis leurs commits sur les autres branches, sans changer de branche ni les fusionner :

- `90ec4073c2bfb978cc85d8620b16e5e2c3178ac5` : acte rédigé dans le raisonnement, DOCX comme impression ; lecture du cadre `.agents/skills/raisonnement-verifie/SKILL.md`, de `engine.ts` et de `acte-merge.ts` à cette version.
- `c96a6c35603cccb7a0a0a430519277b89ebbd62c` : exploration de la confrontation de deux raisonnements, lue dans `docs/raisonnement-juge.md`. C'est une proposition expérimentale, pas une fonction considérée comme livrée.
- [Recherche antérieure sur les outils documentaires](../recherche-obsidian/00-synthese.md), pour ne pas refaire la sélection précédente sans tenir compte du moteur récent.

Le modèle actuel possède déjà conditions, alternatives, exceptions, logique à trois valeurs, sources vérifiées, applicabilité et vigueur, preuves, calculs, hypothèses, recherche des faits décisifs et obstacles. L'objet JavaScript n'est pas exécuté comme du code, mais son interprétation produit bien des résultats calculés par `engine.ts`. Proposer simplement un graphe, des hypothèses, des citations ou un export Word ne constitue donc pas un apport nouveau.

La clé `acte` organise une prose libre en sections reliées aux termes. Les citations et la couverture déclarée se contrôlent mécaniquement ; cela ne démontre pas l'équivalence de sens entre toute la prose et le raisonnement. Le DOCX possède des repères et une base de fusion ; les retouches sont reprises à trois voies. Les pertes de mise en forme et les contenus Word non pris en charge sont déjà documentés par le cadre lu au commit ci-dessus.

## Repères des dépôts publics

Révisions de tête observées via l'API GitHub le 24 octobre 2026. Les liens vers les commits figent un repère ; les liens vers les branches dans les rapports peuvent évoluer. Les dates sont celles du dernier commit de la branche par défaut, pas une mesure de qualité ni une promesse de maintenance. Tous les dépôts ci-dessous étaient non archivés au contrôle.

| Projet | Révision observée | Date UTC du commit | Licence du dépôt consultée |
| --- | --- | --- | --- |
| Accord `template-engine` | [519ee9d558bd](https://github.com/accordproject/template-engine/commit/519ee9d558bd1ad57230754d986515c35582f927) | 2026-10-20 | Apache-2.0 |
| Accord `markdown-transform` | [15a54f711942](https://github.com/accordproject/markdown-transform/commit/15a54f71194258211ca7f40354b280119b88c1d9) | 2026-10-11 | Apache-2.0 |
| Blawx public | [6a717b1920e2](https://github.com/Lexpedite/blawx/commit/6a717b1920e21236536dcd4877e832cdb100f691) | 2024-11-01 | MIT |
| Carneades 4 | [d19d5431b36d](https://github.com/carneades/carneades-4/commit/d19d5431b36da16ffdc2c7ebe4dded784e65b49a) | 2024-10-15 | MPL-2.0 |
| Catala | [f32ea23ef35d](https://github.com/CatalaLang/catala/commit/f32ea23ef35d1c55c874a5bc13788c8a7c26adfa) | 2026-10-23 | Apache-2.0 |
| Arg2P | [83e0a7d6257d](https://github.com/tuProlog/arg2p-kt/commit/83e0a7d6257d174c0c1cd185d86338413f02b09c) | 2026-10-23 | MIT |
| docassemble | [b821998ddd94](https://github.com/jhpyle/docassemble/commit/b821998ddd9442f80456ed1649f38afee0a3b877) | 2026-10-23 | MIT |
| OpenFisca Core | [db0484b54871](https://github.com/openfisca/openfisca-core/commit/db0484b54871b0a73e673478b3153841dba908e9) | 2026-10-23 | AGPL-3.0-or-later |
| L4 actuel, Legalese | [b085e304d72f](https://github.com/legalese/l4-ide/commit/b085e304d72fb7b965b8bc63a5f4b913f9bb3eed) | 2026-10-24 | Apache-2.0 |
| Nomos | [209d4f023cbe](https://github.com/sboghossian/nomos/commit/209d4f023cbe406a8e54d787d7046ded61b25b02) | 2026-04-21 | Apache-2.0 |

Pour Carneades, L4 et Nomos, l'API de reconnaissance de licence retourne `NOASSERTION` ; les licences indiquées ici proviennent de la lecture de leur fichier `LICENSE`, pas de cette classification automatique. Ces repères ne sont pas un audit des dépendances transitives.

La sélection initiale a également rencontré [LegalRuleML](https://github.com/oasis-tcs/legalruleml), [TweetyProject](https://github.com/TweetyProjectTeam/TweetyProject) et [s(CASP)](https://github.com/SWI-Prolog/sCASP). LegalRuleML reste une piste d'interopérabilité, Tweety une boîte à outils plus générale. Ils ne sont pas retenus pour une analyse individuelle dans cette série ; s(CASP) est étudié avec Blawx. L'ancien dépôt `smucclaw/l4-ide` renvoie désormais vers `legalese/l4-ide` : les anciennes listes de fonctions prévues dans `smucclaw/dsl` ne sont pas considérées comme des fonctions livrées dans le L4 actuel.

## Vérification documentaire

La relecture a vérifié les liens internes, l'accès aux sources externes et les données interdites avec le garde du dépôt. Elle a notamment corrigé la confusion entre conditions cumulatives PieceMaker et définitions concurrentes Catala, séparé les capacités Blawx publiques des annonces du service actuel, et distingué le paquet ACTUS annoncé par le README L4 des fichiers réellement présents. Ces vérifications documentaires ne remplacent pas les essais logiciels proposés dans les fiches.
