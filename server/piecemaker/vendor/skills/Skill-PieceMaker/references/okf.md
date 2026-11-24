# Bundle OKF (`pm okf`)

Le bundle OKF du dossier suit Context-OKF : Open Knowledge Format 0.3 sur le socle de la Legal Ontologies Foundry (LOF) de David R. Koepsell, sous licence CC BY 4.0. Il vit dans `.piecemaker/okf/` et fait autorité sur les concepts et leurs liens.

## Écrire

Écris les concepts avec Write ou Edit (Codex : apply_patch), en suivant le skill `okf`. Le Hérisson lance le validateur Context-OKF en mode strict après chaque écriture. Corrige chaque `ERROR` et chaque `LINT`.

## Commandes

| Commande | Effet |
| --- | --- |
| `pm okf verify` | lance le validateur sur tout le bundle ; une ligne `ERROR` ou `LINT` par défaut, puis le résumé |
| `pm okf ontologie` | liste les six patterns LOF (ODP-001 à 006) et les types principaux du dossier |
| `pm okf ontologie proposer --json '{"arborescence":[…]}' [--motif "raison"]` | propose à l'avocat l'arborescence complète |

## Arborescence

L'avocat règle seul l'arborescence commune à tous les dossiers (onglet Case index, lien « Arborescence » de la légende). Pour la modifier, édite `~/.piecemaker/ontologie.json` (clé `arborescence`) avec Edit ou Write, jamais par le shell, ou lance `pm okf ontologie proposer`. Le hook `guard-ontologie` en fait une proposition ; l'avocat l'accepte, la refuse ou la modifie.

## Suivi

Un événement du suivi renvoie à un concept daté par son titre : `"okf": "<title>"`. Le concept porte `date: AAAA-MM-JJ`, `resource` et `citation`.
