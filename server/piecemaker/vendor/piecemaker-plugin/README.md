# PieceMaker — composants Claude Code et Codex CLI

Ce dossier regroupe les skills partagés avec Claude Code et Codex CLI, ainsi
que les agents et hooks de garde-fou. Il n'est pas
distribué par un manifest ou un marketplace PieceMaker. Le serveur MCP
Légifrance est maintenu séparément dans
[`PieceMaker-Legal/mcp-legifrance`](https://github.com/PieceMaker-Legal/mcp-legifrance).

## Contenu

- **Skills** (`skills/`) :
  - `conversion-md` — conversion de documents en Markdown
    (`smart_converter.py`, markitdown/MinerU).
  - `redaction-juridique` — rédaction/relecture de documents juridiques
    français, citations sourcées via legifrance (MCP).
  - `tamponnage` — tampon du cabinet et tamponnage numéroté des pièces d'un
    bordereau : conversion de l'original en PDF (LibreOffice pour Excel/Word,
    `pdf-lib` pour images et texte), tampon puis renommage « Pièce n°N » dans
    le sous-dossier « Pièces tamponnées » de chaque dossier juridique.
- **Agents** (`agents/`) :
  - `verificateur-anonymisation` — audit lecture seule avant sortie de
    cabinet, confirme l'absence de PII résiduelle.
  - `analyste-piece` — synthèse structurée d'une pièce du dossier.
- **Hooks** (`hooks/hooks.json`) — protection des pièces et mappings
  (`PreToolUse`), suivi Légifrance et commit Git après écriture (`PostToolUse`),
  compilation des recherches et suivi de session local (`Stop`/`TaskCompleted`).
  Un document créé par l'IA dans un dossier enregistré est classé d'office
  « espace de travail » (`classify-ai-documents.mjs`, `PostToolUse`) : sans
  quoi il naîtrait au coffre-fort et l'IA ne pourrait pas se relire.
  Le mapping PII est appliqué par le proxy PII, pas par ces hooks. Tous
  les hooks échouent "ouverts" (fail-open) : aucune erreur, timeout ou
  absence de configuration ne bloque jamais une session.

L'installateur enregistre ces composants dans les emplacements utilisateur
découverts par les CLI. Il fusionne tous les hooks dans les réglages Claude
Code et la protection des pièces (`PreToolUse`) dans les réglages Codex.

Chaque sous-dossier immédiat de `config.workspacePath` est traité comme un dossier
juridique indépendant. Son historique Git est conservé hors des données client,
dans `~/.piecemaker/case-history/`. Il versionne les Markdown et mappings JSON ;
pour les `.docx`, il conserve une empreinte compacte des parties OOXML afin de
signaler une modification dans l’administration. Le binaire Word n’est jamais
archivé. Pour un DOCX explicitement déprotégé, une représentation textuelle
normalisée et compressée permet d’afficher un vrai diff ; le texte d’une pièce
protégée n’est jamais extrait. Les restaurations n’écrasent aucun DOCX.
L’historique, les restaurations et l’état de protection GLiNER sont accessibles
dans l’interface locale `/admin/`.

## Installation locale

L'étape `09-claude-assets` enregistre, si Claude Code est présent :

- `~/.claude/agents/<slug>.md`
- `~/.claude/skills/<slug>/SKILL.md`

L'étape `09-codex-plugin` enregistre, si Codex CLI est présent :

- `~/.codex/skills/<slug>/SKILL.md`
- `~/.codex/hooks.json` — refus `PreToolUse` de lecture des pièces protégées.

Ce sont des **liens symboliques** vers `piecemaker-plugin/` : toute
modification du Markdown (administration ou éditeur) est prise en compte à la
session suivante. Une copie rafraîchissable est utilisée si les liens ne sont
pas disponibles. Pour Claude Code, l'enregistrement a aussi lieu :

- à la création d'un skill ou d'un agent dans l'administration ;
- à chaque enregistrement d'un fichier ;
- au démarrage du serveur ;
- après `piecemaker update`.

Un fichier personnel homonyme déjà présent dans `~/.claude` n'est jamais
écrasé : l'administration affiche alors le badge « Conflit ». Les liens
devenus orphelins (skill supprimé du dépôt) sont nettoyés automatiquement.
Implémentations : `websocket-server/claude-assets.cjs` et
`installer/lib/codex-skills.mjs`.

Les hooks décrits par `hooks/hooks.json` sont fusionnés directement dans
`~/.claude/settings.json` avec le chemin absolu des scripts du dépôt. Ils ne
dépendent donc d'aucun cache de plugin. `piecemaker update`, le démarrage du
serveur et l'étape 06 réconcilient cet enregistrement.

## Serveur MCP Légifrance

L'étape `07-legifrance` installe le plugin autonome depuis
`PieceMaker-Legal/mcp-legifrance`. Son runtime, ses tests, son venv et sa
configuration MCP ne vivent plus dans ce dépôt. Le plugin est identifié dans
Claude par `piecemaker@mcp-legifrance`, avec le namespace
`mcp__plugin_piecemaker_legifrance`.

Les identifiants PISTE sont copiés avec des permissions 0600 dans
`~/.config/mcp-legifrance/.env`. Le `.env` PieceMaker reste alimenté pour
l'administration et la migration des installations antérieures.

`Search_Jurisprudence` est le seul outil de recherche jurisprudentielle : il
interroge Légifrance et Judilibre en un appel, avec les mêmes filtres et la même
requête booléenne, et fusionne les doublons. `Build_Research_Corpus` utilise le
même moteur pour figer une formulation, télécharger et scanner chaque texte
intégral, puis préparer les lots de revue, sans embeddings, base vectorielle ni
top-k. L'implémentation et ses tests appartiennent au dépôt MCP autonome.
