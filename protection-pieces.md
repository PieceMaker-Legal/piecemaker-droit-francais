# Protection des pièces

Les pièces originales d'un dossier (PDF, DOCX, courriels) portent les noms
réels. La promesse du produit est que l'IA ne les lit jamais : elle travaille
sur les Markdown convertis et pseudonymisés. La « protection » est ce qui tient
cette promesse.

**Seuls les PDF et les images sont protégés** (`PROTECTED_EXTENSIONS` dans
`scripts/lib/protection.cjs`) : ce sont les pièces dont on tire un Markdown
converti, et un refus renvoie vers ce Markdown. Tout le reste — `.docx`, `.txt`,
`.eml`, tableurs, `.md`, `.json` — est accessible à l'IA, anonymisé à la lecture
par le proxy PII. `.piecemaker/protection.json` ne stocke que des *exceptions*,
jamais la liste des fichiers protégés : un PDF déposé plus tard est donc protégé
sans que rien n'ait à être mis à jour.

Deux familles sont interdites à l'IA en toute circonstance, quelle que soit leur
extension, et aucune exception ne les atteint : les mappings (`mapping*.json`,
`*_sensitive_map.json`, `central-mapping.json`) et les secrets d'environnement
(`.env`, `.env.*` hors `example`/`sample`/`template`, `*.env`).

La **levée de protection** (`server/piecemaker/protection/bypass.cjs`, bouton
`src/piecemaker/dossier/sections/CaseFilesProtectionBypass.tsx`) suit la même
logique : elle pose un simple drapeau `.piecemaker/protection-bypass.json`
portant la portée « dossier », **sans aucune liste de fichiers**. Elle vaut donc
pour les pièces déposées ensuite. Toute évolution qui réintroduirait une
énumération de fichiers serait une régression.

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
  tools Read/Grep/Glob distincts), en plus de la sentinelle `SessionStart`
  (`proxy-guard.mjs`).
- **Un hook analyse du texte de commande, pas des syscalls.** `python -c
  "open(...)"`, `find -exec cat`, une variable de shell ou un chemin relatif
  après un `cd` échappent à toute analyse textuelle. C'est la raison d'être de
  la couche 3.
- `proxy-guard.mjs` est **fail-open** par conception : proxy indisponible ⇒ il
  retire la configuration du proxy des fichiers clients et laisse la session
  partir en accès direct, avec un avertissement. Le refus de démarrage, lui,
  appartient au serveur (couche 2).

## 2. Proxy PII — le filet

`server/piecemaker/anonymizer/`, démarré et attendu par
`server/piecemaker/index.ts` avant toute écoute HTTP ; `anonymizer/lifecycle.ts`
refuse le démarrage si le proxy ou le routage Claude/Codex n'est pas prêt, et
chaque lancement de chat revérifie cet état. Il couvre Claude et Codex au même
point de passage, en SSE et en JSON, et refuse en 404 tout chemin non routé.

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
  automatiquement par la commande `piecemaker`. La sentinelle `SessionStart`
  reste unique, hors vendorisation, sous `scripts/piecemaker/hooks/proxy-guard.mjs`
  à la racine du dépôt, partagée par les deux clients via
  `PIECEMAKER_HOOK_CLIENT`.
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
