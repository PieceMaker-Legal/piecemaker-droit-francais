# Le socle LOF — règles de construction d'un OKF juridique

LOF n'est pas un contenu à mettre dans un bundle. LOF est le socle de règles qui gouverne la construction de tout OKF juridique. L'OKF dit comment représenter (concept, frontmatter, lien, index, log, familles de confiance) ; le LOF dit quoi et pourquoi. Le bundle `okf/` de ce dépôt est l'implémentation de référence de ce socle : il porte les objets LOF (fondations, patterns, ontologie) et la méthode de lecture dérivée.

## 1. Règles de construction OKF, et la règle LOF qui les gouverne

| Catégorie de construction OKF (spec v0.3) | Règle LOF de remplacement | Ce que la règle impose |
|---|---|---|
| Concept et `type` (§3.2, §4.1) | BFO (continuant / occurrent) + [ODP-001](../contexte/patterns/odp-001.md) | Trois objets jamais confondus : l'acte (processus), le contenu (continuant dépendant), le document (entité matérielle). Le `type` nomme la nature LOF de l'objet : Fondation, Design Pattern, Ontologie, Méthode pour le contexte ; Acte, Contenu, Rôle, Position, Chaîne, Version, Conflit, Détermination pour un bundle de dossier. |
| `resource` (§4.1) | [ODP-001](../contexte/patterns/odp-001.md) | Le `resource` pointe le document qui porte l'acte. Un concept sur une idée abstraite n'a pas de `resource`. Jamais une URL-seule : la source vit dans `assets/`. |
| Lien et graphe du bundle (§6.1, §6.4) | [ODP-004](../contexte/patterns/odp-004.md) | Un lien est un maillon de chaîne : norme, rôle, déclencheur, acte, cible, effet, remède. Le graphe du bundle est le réseau des chaînes. Un maillon manquant se signale ; il ne se devine pas. |
| `sources` — provenance (§5.1) | [ODP-001](../contexte/patterns/odp-001.md) et [ODP-005](../contexte/patterns/odp-005.md) | Un contenu dérive de l'acte qui l'établit (acte modificatif, abrogation). L'attribution d'un fait se fait par le pattern qui le qualifie ; l'URL amont reste en `sources` pour la provenance. |
| `generated` / `verified` — paliers de confiance (§5.2, §5.3) | [ODP-006](../contexte/patterns/odp-006.md) | Une détermination ne vaut que si elle est elle-même du contenu juridique, émise par l'autorité compétente. Le palier traduit l'autorité : `human:` = détermination d'autorité ; machine = contrôle formel ; rien = allégué. |
| `status` / `superseded_by` — cycle de vie (§5.4) | [ODP-005](../contexte/patterns/odp-005.md) | Un contenu n'est pas changé, il est succédé : acte modificatif, période de vigueur, remplacement désigné par `superseded_by`. `deprecated` = éteint ou abrogé. |
| `stale_after` — fraîcheur (§5.5) | [ODP-005](../contexte/patterns/odp-005.md) | L'échéance de conformité : échue signifie « à vérifier », jamais « faux ». |
| `Attested Computation`, `executor`, `attester` (§10) | [ODP-004](../contexte/patterns/odp-004.md) — formes SHACL compagnes | L'attester est le contrôle déterministe de chaîne, sans LLM : les formes SHACL signalent les chaînes incomplètes, maillon par maillon. Le reçu est la chaîne reconstituée. Une valeur n'est « attestée » que si un runtime déterministe l'a produite. |
| Convention `references/` (§6.3) | House rule « no link-only knowledge » | Toute source citée vit dans `assets/`, datée, vendue telle quelle. |
| `index.md` — divulgation progressive (§8) | [Méthode de lecture](../contexte/lecture/lire-un-contrat.md) | La navigation suit l'ordre de lecture : la pièce d'abord (nature), puis les actes, les rôles, les positions, la chaîne, les versions, les conflits. |
| `log.md` — historique (§9) | [ODP-005](../contexte/patterns/odp-005.md) | Chaque entrée du log date un acte de maintenance (création, modification, extinction), comme un acte modificatif date le contenu qu'il succède. |
| Asset (§3.2) | [ODP-001](../contexte/patterns/odp-001.md) | Une pièce est un asset : un document, jamais un concept. On annote une copie ; on ne modifie jamais l'original. |

## 2. Catégories des bundles OKF, et leur remplacement LOF

Les bundles de référence OKF (GA4, Stack Overflow, Bitcoin, Acme Retail dans `open-knowledge-format/bundles/`) organisent le savoir en catégories de données : `datasets/`, `tables/`, `metrics/`, `computations/`, `playbooks/`, `references/`, `policies/`. Un bundle juridique construit sur le socle nomme ses dossiers selon les objets que définissent les règles LOF, pas selon les données :

| Dossier générique OKF | Remplacement LOF | Objets portés |
|---|---|---|
| `datasets/` (périmètre d'un ensemble de données) | le corpus de pièces, en `assets/` | les pièces brutes : des documents, des assets |
| `tables/` (actif structuré) | `documents/` | les documents analysés, liés aux actes qu'ils fondent |
| `metrics/` (valeur mesurée) | `positions/` | claims, duties, powers, liabilities — [ODP-003](../contexte/patterns/odp-003.md) |
| `computations/` (calcul sanctionné) | `chaines/` et `determinations/` | chaînes minimales reconstituées — [ODP-004](../contexte/patterns/odp-004.md) ; déterminations de précédence — [ODP-006](../contexte/patterns/odp-006.md) |
| `playbooks/` (procédure d'exploitation) | `lecture/` | la méthode de lecture, pas à pas |
| `references/` (copie de matériel externe) | `assets/` | sources LOF vendées, datées |
| `policies/` (règle métier d'un calcul) | `patterns/` | les design patterns LOF eux-mêmes, qui fondent toute qualification |

Un bundle de dossier construit sur ce socle (par exemple l'annotation d'un corpus de pièces) suit la même discipline : chaque fait qualifié cite le pattern qui le qualifie, chaque prétention expose sa chaîne, chaque version porte ses dates de vigueur, chaque conflit reste ouvert faute de détermination.

## 3. Ce que le socle vérifie dans ce dépôt

Le validateur (`skills/okf/scripts/validate.py`, mode `--strict`, activé par la présence de `fondations/lof.md`) contrôle l'implémentation de référence : le bundle porte tous les objets LOF requis (BFO, la Foundry, les six patterns) et chaque pattern ou ontologie pointe sa source vendée par `resource`. Le visualiseur colore les familles LOF et garde les assets hors du graphe (spec §6.4 : arêtes concept vers concept).
