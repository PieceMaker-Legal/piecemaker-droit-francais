---
name: okf
description: Construire, lire et vérifier le bundle OKF du dossier (.piecemaker/okf/) au format Context-OKF (Open Knowledge Format 0.3 sur le socle de la Legal Ontologies Foundry) — documents, actes, contenus, rôles, positions, chaînes, versions, conflits et déterminations, chaque fait qualifié par un pattern LOF (ODP-001 à 006) et cité dans une pièce. Use when the user asks to read, build, complete or check the case index, the links between documents, the legal positions, roles, acts, clauses or parties of the case, or the OKF index.
---

# Bundle OKF du dossier

> Un lien se cherche dans les pièces ; on ne l'invente pas.

Le bundle OKF résume les pièces du dossier en concepts Markdown liés. Il ne porte que les documents rangés dans un dossier de type `Pièces` de l'arborescence : ignorez les projets, notes et autres dossiers. Il vit dans `.piecemaker/okf/` et fait autorité : en cas de doute, il l'emporte sur toute autre note.

## Socle

Le bundle suit Context-OKF : l'OKF 0.3 dit comment représenter, la Legal Ontologies Foundry (LOF, David R. Koepsell, CC BY 4.0) dit quoi représenter.

1. Lisez [references/socle-lof-okf.md](references/socle-lof-okf.md) avant la première écriture.
2. Lisez la méthode de lecture [contexte/lecture/lire-un-contrat.md](contexte/lecture/lire-un-contrat.md).
3. Lisez la fiche du pattern dans [contexte/patterns/](contexte/patterns/) avant de qualifier un fait. La spécification complète du pattern est dans [references/lof/](references/lof/).
4. Le bundle [contexte/](contexte/) est l'exemple de référence, sur des pièces fictives.

Ne copiez ni les patterns ni les fondations dans le bundle du dossier.

## Structure

```text
.piecemaker/okf/
├── index.md          okf_version: "0.3", liste des dossiers
├── log.md            un acte de maintenance daté par entrée
├── documents/        type: Document — une pièce analysée
├── actes/            type: Acte — signature, modification, notification
├── contenus/         type: Contenu — clause, obligation établie par l'acte
├── roles/            type: Rôle — partie et rôle conféré (ODP-002)
├── positions/        type: Position — claim, duty, power, liability (ODP-003)
├── chaines/          type: Chaîne — norme, rôle, déclencheur, acte, cible, effet, remède (ODP-004)
├── versions/         type: Version — acte modificatif, dates de vigueur (ODP-005)
├── conflits/         type: Conflit — deux normes opposées (ODP-006)
└── determinations/   type: Détermination — précédence émise par l'autorité (ODP-006)
```

Chaque dossier a son `index.md`, qui liste ses concepts par lien. Créez seulement les dossiers utiles.

## Concept

```markdown
---
type: Position
title: Créance de paiement du prix
description: Le client doit payer le prix au prestataire à trente jours.
resource: "/Pièces/Contrat de prestation.pdf"
date: 2026-03-01
citation: "Le Client paie le prix dans un délai de trente jours."
---

# Créance de paiement du prix

Le prestataire tient une créance contre le client — qualifié par ODP-003 — LOF-ODP-003 : positions déontiques corrélatives (Concept ID patterns/odp-003 du Context OKF).

Corrélatif : [devoir de payer](devoir-de-payer.md). Titulaire : [prestataire](../roles/prestataire.md). Fondée sur [la clause de prix](../contenus/clause-prix.md).
```

- `type`, `title` et `description` sont obligatoires.
- `resource` est le chemin de la pièce depuis la racine du dossier, précédé de `/`. Un Document, un Acte et un Contenu portent `resource`. Ne copiez jamais une pièce dans le bundle. `resource` doit être une pièce existante d'un dossier de type `Pièces` de l'arborescence (jamais `..` ni `.piecemaker/`) : `pm okf verify` refuse sinon.
- `citation` est un extrait littéral de la pièce de `resource`.
- `date` (`AAAA-MM-JJ`) date un événement. Le suivi du dossier renvoie à un concept daté par son titre : `evenements.<nom>.okf` = `title` du concept, qui porte `date`, `resource` et `citation`.
- Chaque fait relevé cite le pattern qui le qualifie, dans la phrase « — qualifié par ODP-00X — … (Concept ID patterns/odp-00X du Context OKF) ». N'écrivez pas de lien vers le pattern : il n'est pas dans le bundle.
- Un lien est un lien Markdown relatif vers un autre concept. Un maillon de chaîne manquant se signale dans le corps ; il ne se devine pas.

## Concision

- Soyez concis : une phrase par fait, sans paraphrase de la pièce ni répétition d'un autre concept.
- Aucun fichier du bundle ne dépasse 500 lignes. Le validateur rend un `LINT` au-delà. Scindez un fichier trop long en concepts liés.

## Écrire et vérifier

1. Écrivez les concepts directement avec Write et Edit dans `.piecemaker/okf/`.
2. Après chaque écriture, le Hérisson lance le validateur en mode strict. Corrigez chaque `ERROR` et chaque `LINT` qu'il rend : lien cassé, concept orphelin, frontmatter incomplet.
3. Pour vérifier tout le bundle, lancez `pm okf verify`.
4. Partez de l'Index du dossier : `pm dossier index lire` rend la revue tabulaire, une ligne par pièce avec ses informations principales et son classement. Seules les pièces de type `Pièces` entrent dans le bundle. L'Index oriente ; il ne remplace pas la citation.
5. Pour une pièce, lisez la pièce entière. Suivez la méthode de lecture dans l'ordre : document, actes, rôles, positions, chaîne, versions, conflits.
6. Ajoutez une entrée datée à `log.md` à chaque création, modification ou extinction.
7. Un hook refuse toute écriture directe dans `~/.piecemaker/ontologie.json`, qui porte l'arborescence commune à tous les dossiers. Proposez un changement par `pm okf ontologie proposer`.

## Parties

Le dossier `persons/` contient une fiche par personne (CCO *Person*) et par organisation (CCO *Organization*) de la base du dossier. Le serveur génère ces fiches depuis la base. N'écrivez jamais dans `persons/` : la génération suivante écrase vos modifications.

1. Pour compléter une fiche, écrivez dans la base avec l'outil `sql` : nœud, lien entre éléments (dirigeant, SIREN, adresse), citation avec `piece_id` ou `source`.
2. Rapprochez les éléments trouvés par l'anonymisation : un SIREN à sa société, une adresse à sa personne. Vérifiez une société dans le registre public ou le BODACC ; citez la source.
3. Seuls un acte ou un registre établissent un dirigeant. Ne déduisez jamais un rôle d'une simple mention.
4. Un Rôle a un seul porteur. Liez le Rôle à sa fiche : `[Jean Dupont](/persons/personne-physique-01.md)`.

Chaque écriture de l'agent porte l'auteur `agent` (« À vérifier »). Le scan porte l'auteur `gliner` (« À trier »). L'avocat valide une fiche dans l'onglet Dossier : l'auteur devient `human` (« Validé »). La qualification d'une partie cliente ou adverse appartient à l'avocat. Signalez-lui une personne qu'une pièce montre partie ; ne la qualifiez pas vous-même.

## Règles de conduite

- Ne recopiez pas une personne dans un concept : liez sa fiche `persons/`.
- Ne citez jamais sans extrait littéral de la pièce.
- Si deux pièces se contredisent, créez un Conflit. Ne tranchez pas sans Détermination de l'autorité compétente.
- Si le bundle ne contient pas l'information, répondez « je ne sais pas ». N'inventez ni concept ni lien.
