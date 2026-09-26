# Protection des pièces

Les pièces originales d'un dossier portent les noms réels. La promesse du
produit est que l'IA ne lit jamais une pièce PDF ou image : elle travaille sur
le Markdown converti et pseudonymisé. La « protection » est ce qui tient cette
promesse ; elle est **automatique**, sans aucun réglage dans l'interface.

## Périmètre : quels dossiers

**Tout projet CloudCLI est un dossier juridique.** Il n'existe plus de registre
manuel (`caseFolders` de `~/.piecemaker/config.json` n'est plus lu).

- `server/piecemaker/project-registry.ts` publie, au démarrage puis toutes les
  5 s (et avant chaque enregistrement de dossier), les chemins des projets de la
  base CloudCLI — archivés compris — dans `~/.piecemaker/projects.json`.
- Le fichier est découpé par source (`database:<chemin de auth.db>`), pour que
  plusieurs serveurs (dev, app de bureau) cohabitent ; l'autotest de
  l'installateur publie temporairement sous `installer-selftest`.
- Les hooks tournent hors du serveur, parfois avec le Node système (v16) : ils
  ne lisent pas SQLite, seulement ce fichier, via
  `vendor/piecemaker-plugin/scripts/lib/case-folders.cjs`
  (`locateProjectCase`, `registeredProjectFolders`).
- Sont exclus : le dossier personnel et ses parents (un projet ouvert sur `~`
  ferait de tout le disque un dossier), les répertoires temporaires. Un projet
  imbriqué l'emporte sur son parent.
- `case-registry.cjs` (liste de l'administration, `resolveCaseReference`) et
  `workspace-paths.cjs` (tamponnage) lisent la même liste.

## Règle

`isProtectedFile` (`scripts/lib/protection.cjs`) : un fichier est protégé s'il
est dans un projet, hors dotfile, hors `.md`/`.json`, avec une extension de
`PROTECTED_EXTENSIONS` (PDF et images), hors copie OOXML de travail, sans levée
du dossier, et absent des deux listes d'exceptions. Tout le reste — `.docx`,
`.txt`, `.eml`, tableurs — est lisible par l'IA, pseudonymisé par le proxy PII.

Toujours interdits, sans exception possible : les mappings (`mapping*.json`,
`*_sensitive_map.json`, `central-mapping.json`) et les secrets d'environnement
(`.env`, `.env.*` hors `example`/`sample`/`template`, `*.env`). L'absence de
`mapping_default.json` ne bloque rien : un projet de code reste lisible.

## Fichiers d'un dossier (`<projet>/.piecemaker/`, hors Git)

| Fichier | Contenu | Écrit par |
| --- | --- | --- |
| `protection.json` | `{version, unprotected, resources}` : uniquement des **exceptions**, jamais la liste des fichiers protégés. Un PDF déposé plus tard est protégé sans mise à jour. | création/enregistrement du dossier (listes vides), hook `classify-ai-documents.mjs`, `PUT /protection` |
| `protection-bypass.json` | drapeau `{scope: "dossier"}` : sa seule présence lève toute protection du dossier, pièces futures comprises. | `PUT /protection/bypass` (`server/piecemaker/protection/bypass.cjs`) |

- Les exceptions sont des chemins relatifs : une pièce renommée ou déplacée
  perd la sienne et redevient protégée (défaut sûr).
- `protection.json` est réécrit de façon atomique (fichier temporaire puis
  `rename`) sous le verrou `protection.json.lock` (lecture-modification-écriture
  entière sous verrou, verrou périmé après 10 s) : plusieurs hooks l'écrivent en
  parallèle.
- `classify-ai-documents.mjs` (après `Write`/`Bash`) n'y inscrit que les PDF et
  images créés par l'IA, pour qu'elle puisse se relire ; il ne réécrit rien si
  l'entrée existe déjà.
- Aucune interface ne modifie ces fichiers depuis `5ddbee2a` : les routes
  `/protection` et `/protection/bypass` restent sans appelant côté client.
  Toute évolution qui réintroduirait une énumération de fichiers protégés
  serait une régression.

## Qui applique la règle

| Code | Rôle |
| --- | --- |
| `protect-originals.mjs` (`PreToolUse` Read/Grep/Glob/Bash ; tous outils pour Codex) | refus + renvoi vers le Markdown ; mappings, secrets, Grep/Glob à la racine |
| `classify-ai-documents.mjs` (`PostToolUse` Write/Bash) | exceptions pour les PDF/images produits par l'IA |
| `lib/commits.cjs` | historique : pas d'extraction de texte des pièces protégées |
| `knowledge/pipeline.ts` | exclut les « ressources » de la conversion et du scan |
| proxy PII | ne lit ni `protection.json` ni le drapeau (voir couche 2) |

## Limites connues (audit du 2026-09-26)

- Seuls Claude Code et Codex ont les hooks ; les autres fournisseurs pilotés par
  CloudCLI ne sont couverts que par le proxy.
- Le hook analyse le texte des commandes : `python -c`, variables, globs
  (`cat *.pdf`), `cd` puis chemin relatif y échappent.
- `Grep` n'est bloqué qu'à la racine du dossier, pas dans un sous-dossier
  contenant des PDF.
- Les `.docx` originaux sont lisibles : seul le proxy (dictionnaire) les
  pseudonymise.
- Les dossiers enregistrés à la main hors projets CloudCLI ne sont plus
  protégés : les ouvrir comme projets.

Trois couches défendent cette promesse, dans l'ordre du trajet d'un fichier.
Elles ne sont pas interchangeables : **seule la première empêche**.

## 1. Hooks — la prévention

Hooks `PreToolUse` de Claude Code (`protect-originals.mjs`). L'IA demande à
ouvrir un chemin, le hook répond `deny` avant toute lecture. C'est la seule
couche où le contenu n'entre ni dans la conversation, ni dans le transcript sur
disque, ni dans l'historique du dossier. Elle sait aussi *expliquer* le refus et
renvoyer vers le Markdown converti, ce qui permet au modèle de se corriger seul.

Limites structurelles, à connaître avant de s'y fier :

- **Codex reçoit désormais le même refus par outil.** Codex CLI ≥ 0.153.4
  supporte le contrat `PreToolUse` (`hookSpecificOutput.permissionDecision:
  "deny"`) et normalise son exécution shell sous le nom d'outil `Bash` —
  exactement la branche déjà traitée par `protect-originals.mjs`, sans
  changement de logique. `installer/lib/codex-skills.mjs` installe ce même
  script dans `~/.codex/hooks.json` (matcher `"*"`, Codex n'exposant pas de
  tools Read/Grep/Glob distincts).
- **Un hook analyse du texte de commande, pas des syscalls.** `python -c
  "open(...)"`, `find -exec cat`, une variable de shell ou un chemin relatif
  après un `cd` échappent à toute analyse textuelle. C'est la raison d'être de
  la couche 3.

## 2. Proxy PII — le filet

`server/piecemaker/anonymizer/`, démarré et attendu par
`server/piecemaker/index.ts` avant toute écoute HTTP ; `anonymizer/lifecycle.ts`
refuse le démarrage si le proxy ou le routage Claude/Codex n'est pas prêt, et
chaque lancement de chat revérifie cet état. Il couvre Claude et Codex au même
point de passage, en JSON, SSE et WebSocket, et refuse tout corps qu'il ne sait
pas anonymiser. Seules les sessions lancées par PieceMaker y passent (routage
par l'environnement du serveur) ; détail dans `docs/anonymisation.md`.

Ce qu'il ne peut pas faire : empêcher. Une pièce lue localement ne lui parvient
qu'**au tour suivant**, dans le rappel de l'historique, sous forme de bloc
`tool_result` — à ce moment elle est déjà dans le transcript et à l'écran. De
plus, le chemin du fichier vit dans le bloc d'appel et le contenu dans le bloc
de résultat ; leur appariement n'existe aujourd'hui que pour
`consulter_decision` (`harness/decisions.cjs`).

**Rien dans `anonymizer/` ni `harness/` ne consulte `protection.json` ni le
drapeau de levée.** Le seul filtre du proxy est le dictionnaire central. Si l'on
voulait un jour y ajouter un caviardage des pièces protégées — notamment pour
couvrir Codex —, la mécanique de substitution existe déjà et est générique
(`anonymizer/rewrite.cjs`, y compris pour un motif fragmenté entre deltas SSE) ;
mais cela heurterait l'invariant de transparence octet pour octet affirmé et
testé par `proxy-harness.test.js`, et devrait se rejouer à chaque tour puisque
le `tool_result` demeure dans l'historique.

## 3. MXC — le confinement système

`microsoft/mxc` (« Microsoft eXecution Container ») : le shell est lancé *à
travers* un binaire qui refuse au niveau du système d'exploitation l'accès au
venv Python, aux mappings du dossier et au mapping central. Backends `seatbelt`
sur macOS, `processcontainer` sur Windows, `bubblewrap` sur Linux. Le réseau
reste autorisé — c'est un confinement du système de fichiers, pas du réseau.
L'installation vérifie son effectivité par un canari et **se désactive
elle-même** si le blocage n'a pas lieu.

C'est la seule couche qui ferme le trou de la couche 1, parce qu'elle ne lit pas
une commande : elle arbitre les ouvertures de fichiers. Deux réserves assumées :
Microsoft présente mxc comme une préversion et écrit que ses profils ne doivent
pas être traités comme des frontières de sécurité ; et sous Windows il n'expose
pas de chemins refusés, seulement une liste blanche. **MXC ne remplace donc
jamais les hooks, il se place dessous.**

## État réel, à ne pas confondre avec l'intention

- Couche 2 : **en production**, bloquante, testée.
- Couche 1 : les scripts de hook sont désormais **vendorisés dans ce dépôt**
  (`server/piecemaker/vendor/piecemaker-plugin/scripts/` et `hooks/hooks.json`),
  sans dépendance runtime au dépôt historique PieceMaker-Installer. Les
  étapes `06-hooks` (Claude Code) et `09-codex-plugin` (Codex) sont rejouées
  automatiquement par la commande `piecemaker`.
- Couche 3 : l'étape `14-mxc-sandbox` a été supprimée du dépôt — `mxc-sandbox.cjs`
  n'a jamais été vendorisé et rien ne la consommait à l'exécution.
  **Elle n'existe pas à l'exécution.**

Corollaire : une machine neuve, sans dépendance à l'Installer historique,
dispose désormais d'une protection de lecture réelle dès la première
exécution de `piecemaker` (étapes `06-hooks` et `09-codex-plugin`), pour
Claude Code comme pour Codex — ce dépôt livre la protection lui-même, les
dépôts restent autonomes.

Le sandbox natif de Claude Code (permissions, `sandbox`) n'est configuré nulle
part et reste la piste la moins coûteuse à évaluer avant tout chantier mxc.
