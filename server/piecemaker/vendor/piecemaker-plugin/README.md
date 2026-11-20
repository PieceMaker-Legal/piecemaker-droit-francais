# PieceMaker — composants Claude Code et Codex CLI

Ce dossier regroupe les skills partagés avec Claude Code et Codex CLI, ainsi
que les agents et hooks de garde-fou. Il n'est pas
distribué par un manifest ou un marketplace PieceMaker, et la Bibliothèque
n'importe plus ces skills et agents. Le serveur MCP Légifrance est embarqué
dans `server/piecemaker/vendor/mcp/legifrance/` et déclaré dans chaque dossier.

## Contenu

- **Skills** (`skills/`) :
  - `style-redaction-cabinet` — rédaction/relecture de documents juridiques
    français, citations sourcées via legifrance (MCP).
- **Agents** (`agents/`) :
  - `research-maker` — recherche Légifrance et Judilibre (modèle léger) ; l'agent principal relit chaque source.
  Nom d'affichage (`metadata.title`) : ResearchMaker.
- **Hooks Vibe** : `scripts/vibe-hook.mjs` traduit le protocole de `~/.vibe/hooks.toml` vers les scripts ci-dessous ; le serveur y installe au démarrage les entrées `piecemaker-*` (`installer/lib/vibe-hooks.mjs`), sans toucher aux hooks personnels.
- **Hooks** : `guard-legal-search` (Claude, Codex, Vibe) refuse les outils `Search_*` à tout agent autre que
  `research-maker` quand celui-ci est installé ; Mistral les remplace par l'outil `research_maker` ; il lui laisse `consulter_article` et `consulter_decision`.
  Avec le SDK Mistral, chaque `.vibe/agents/*.toml` devient un outil de délégation (`research_maker`) : boucle `chat.complete`, outils d'écriture soumis à la même autorisation que l'agent principal.
- **Hooks** : `guard-ontologie` (Claude, Codex, Vibe, chat Mistral) refuse toute écriture directe dans
  `~/.piecemaker/ontologie.json`, qui porte les relations, les natures et l'arborescence communes à tous
  les dossiers. Une modification de l'ontologie ou de l'arborescence par Edit, Write ou apply_patch devient une proposition pour l'avocat
  (`scripts/lib/proposition-edit.mjs`). Les liens des fiches OKF passent par l'outil `OkfWrite` du MCP
  `features` ou par `pm okf link|unlink|examinee|revue` ; le Hérisson vérifie l'index après chaque écriture.
- **Hooks** (`hooks/hooks.json`) — protection des pièces et mappings
  (`PreToolUse`), suivi Légifrance et commit Git après écriture (`PostToolUse`),
  compilation des recherches et suivi de session local (`Stop`/`TaskCompleted`).
  Un document créé par l'IA dans un dossier enregistré est classé d'office
  « espace de travail » (`classify-ai-documents.mjs`, `PostToolUse`) : sans
  quoi il naîtrait au coffre-fort et l'IA ne pourrait pas se relire.
  Après `research-maker`, `verify-subagent.mjs` (`PostToolUse` sur `Agent|Task`
  sous Claude, `SubagentStop` sous Codex) signale les décisions citées absentes
  du cache `~/.piecemaker/decisions/`, donc jamais lues. Claude donne le bilan à
  l'agent principal, avec l'invitation à relancer le sous-agent ; Codex renvoie
  une fois le sous-agent au travail. L'index OKF et le programme Catala sont écrits par
  l'agent principal.
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
dans l’interface locale.

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

Le runtime est embarqué dans `server/piecemaker/vendor/mcp/legifrance/` et
déclaré dans chaque dossier (`legifrance`, y compris `.mcp.json` pour Claude).
Le venv isolé vit dans `~/.piecemaker/mcp-legifrance/`. Les identifiants PISTE
sont lus dans `~/.config/mcp-legifrance/.env` (0600). L'étape `07-legifrance`
prépare le venv, configure ces clés et retire l'ancien plugin Claude. Ce serveur
est le seul serveur Légifrance ; `Search_Jurisprudence` interroge Légifrance et
Judilibre.
