# Remonter CloudCLI dans PieceMaker

Ce document couvre deux choses indissociables : **comment rejouer un merge
upstream** et **comment écrire le code PieceMaker pour que le merge suivant
reste mécanique**. Les deux se répondent : chaque ligne ajoutée dans un fichier
CloudCLI est un conflit futur.

Référence normative : la section « Plugging code in / rebranding CloudCLI » de
`CLAUDE.md`. Ce fichier en est la mise en œuvre opérationnelle.

---

## 0. Règle de sécurité : ne jamais tuer le serveur sans le relancer

**Le serveur PieceMaker porte le proxy PII sur lequel la session d'assistant
s'appuie. Le tuer, c'est couper le proxy — et rendre la session aveugle.**

Toute interruption doit donc être suivie du redémarrage **dans la même
commande**, jamais en deux temps :

```sh
pkill -TERM -f "$PWD/node_modules/.bin/concurrently.*server:dev.*client" 2>/dev/null || true
sleep 1
source "$HOME/.nvm/nvm.sh"
nvm install
npm rebuild better-sqlite3

(
  for i in {1..120}; do
    if curl -fsS http://127.0.0.1:3003/api/auth/status >/dev/null 2>&1 &&
       curl -fsS http://127.0.0.1:5173/ >/dev/null 2>&1; then
      open http://localhost:5173
      exit 0
    fi
    sleep 0.25
  done
) &

SERVER_PORT=3003 VITE_PORT=5173 npm run dev
```

Interdit : un `pkill` isolé, un `kill` « pour libérer le port » sans relance, ou
l'arrêt du serveur pendant un merge au motif qu'il « touche des fichiers ».
Corollaire : le serveur de dev tourne **pendant** le merge, et c'est normal.

---

## 1. Avant de commencer : neutraliser ce qui écrit dans le dépôt

Un merge se joue sur l'index et l'arbre de travail. Tout processus tiers qui
écrit dans `.git` casse le merge en silence.

**Fermer GitHub Desktop.** Constaté en conditions réelles : pendant un merge
en cours, un `git reset` extérieur a supprimé `MERGE_HEAD` et annulé treize
résolutions de conflits déjà faites. Les symptômes trompent — un `package.json`
dont la valeur change entre deux lectures, des marqueurs de conflit qui
disparaissent seuls, des fichiers `UU` qui redeviennent propres. Si l'un de ces
signes apparaît, vérifier immédiatement :

```sh
test -f .git/MERGE_HEAD && echo "merge vivant" || echo "MERGE ANNULÉ par un tiers"
git reflog -5   # un « reset: moving to HEAD » non demandé = coupable
```

Le serveur de dev, lui, **reste allumé** (§0).

---

## 2. Filet de sécurité

```sh
git tag pre-upstream-merge-backup main
```

L'arbre doit être propre. Si des travaux sont en cours, les **commiter** plutôt
que les remiser : le merge dispose alors d'un contexte three-way complet et les
conflits se résolvent une seule fois. Un WIP qui ne compile pas se commite tel
quel, en le disant dans le message, avec `--no-verify` si le hook de lint le
refuse — c'est un point de sauvegarde, pas une livraison.

```sh
git fetch upstream
git rev-list --left-right --count upstream/main...main   # gauche = à prendre
git merge upstream/main --no-commit --no-ff
```

### Upstream a réécrit son historique : vérifier la base avant de fusionner

Entre v1.37.3 et v1.37.4, upstream a réécrit sa branche : le commit fusionné
la fois précédente n'est plus un ancêtre de `upstream/main`, et
`git merge-base` retombe sur un commit de 2025. Un merge lancé tel quel compare
alors plus d'un an de code des deux côtés : des centaines de conflits, et le
risque de résoudre « vers upstream » du code PieceMaker. Contrôler d'abord :

```sh
PREV=$(git log -1 --format=%P <dernier commit de merge upstream> | awk '{print $2}')
git merge-base --is-ancestor $PREV upstream/main || echo "HISTORIQUE RÉÉCRIT"
```

Si l'historique a été réécrit, retrouver l'équivalent du commit précédemment
fusionné (même arbre, nouveau SHA), puis greffer temporairement notre dernier
merge sur lui pour que Git calcule la bonne base :

```sh
git log --format='%h %T' upstream/main | grep $(git log -1 --format=%T $PREV)
git replace --graft <notre merge> <son 1er parent> <équivalent upstream>
git merge-base main upstream/main          # doit donner l'équivalent
git merge upstream/main --no-commit --no-ff
# … résoudre, commiter le merge …
git replace -d <notre merge>               # le merge commité suffit ensuite
```

Le merge commité a `upstream/main` pour parent réel : la greffe n'est plus
nécessaire pour les remontées suivantes.

---

## 3. Connaître la surface de collision avant d'ouvrir un fichier

```sh
BASE=$(git merge-base upstream/main HEAD)
comm -12 \
  <(git diff --name-only $BASE..HEAD | sort) \
  <(git diff --name-only $BASE..upstream/main | sort)
```

Ce sont les seuls fichiers à risque : ceux que les deux côtés ont touchés. Tout
ce qui vit sous `server/piecemaker/`, `src/piecemaker/`, `scripts/piecemaker/`,
`plugins/`, `.piecemaker/` n'apparaît jamais ici — c'est précisément l'intérêt
de la règle « Add, don't edit ».

---

## 4. Invariants à vérifier nommément après tout merge

Ces points ont déjà été perdus ou ont failli l'être. Les contrôler un par un.

| Fichier | Ce qui doit survivre |
| --- | --- |
| `src/modules/auth/context/AuthContext.tsx` | **`token` absent des deps de `checkAuthStatus`** (depuis v1.37.4 upstream le garantit lui-même via `readStoredToken()` : le fichier est repris tel quel) |
| `src/modules/i18n/config.ts` | l'import, `PIECEMAKER_DEFAULT_LANGUAGE`, `applyPieceMakerI18nOverrides(i18n)` |
| `src/modules/settings/tabs/AboutTab.tsx` | `useProductVersionCheck`, `PRODUCT_REPOSITORY_URL`, `PRODUCT_SHORT_NAME` |
| `.release-it.json` | `"releaseName": "PieceMaker v${version}"` et l'en-tête de changelog |
| `.github/workflows/release.yml` | `NPM_TOKEN` et `NODE_AUTH_TOKEN` dans l'`env` du step Release |
| `package.json` | nom `@piecemaker-legal/piecemaker`, version PieceMaker (**ne jamais prendre la version upstream**), `homepage`/`repository` PieceMaker |
| `src/modules/chat/ChatInterface.tsx`, `hooks/useChatComposerState.ts`, `hooks/useSlashCommands.ts` | la transmission de `isActive`, qui aboutit à `useProjectSlashCommands(selectedProject, provider, { enabled: isActive })` |
| `server/modules/providers/services/provider-capabilities.service.ts` | l'entrée `mistral`, avec `effortLevels: ['none', 'high']` |
| `server/modules/providers/list/claude/claude-sessions.provider.ts` | `restoreVisibleText` dans les options du constructeur et `this.restoreMessage(msg)` après le rattachement du résultat d'outil |
| `server/modules/websocket/services/shell-websocket.service.ts` | `getApplicationDataRoot()` au lieu de `path.join(os.homedir(), '.cloudcli')` pour le thème du terminal |
| `src/shared/types.ts` | `'mistral'` dans l'union `LLMProvider` |
| `server/modules/providers/list/codex/codex-runtime.provider.ts` | `codex = new Codex(options.libraryCodexOptions);` (au lieu de `new Codex()`) |
| `src/modules/code-editor/EditorSidebar.tsx` | `import CodeEditor from '@/piecemaker/editor-tabs/TabbedCodeEditor';` (au lieu de `@/modules/code-editor/CodeEditor`) |
| `src/modules/project-workspace/WorkspaceMain.tsx` | l'import et l'appel `usePiecemakerEditorBridge(handleFileOpen);` |
| `server/index.ts` | l'import de `createExternalFileRouter` et `app.use('/api/file-tree', authenticateToken, createExternalFileRouter());` **avant** `fileTreeRoutes` |
| `src/modules/project-workspace/WorkspaceHeader.tsx` | `import { WorkspaceIconTabs as WorkspaceTabs } from '@/modules/piecemaker-workspace-tabs';` |
| `src/modules/project-workspace/WorkspaceMain.tsx` | `export default React.memo(withWorkspacePanels(WorkspaceMain));` et import de `withWorkspacePanels` |
| `server/modules/browser-use/browser-use.service.ts` | dans `registerAgentMcp()`, la ligne `...(process.env.ELECTRON_RUN_AS_NODE ? { ELECTRON_RUN_AS_NODE: … } : {})` de l'`env` |

### `codex-runtime.provider.ts` — le masquage des skills par dossier dans Codex

Désactiver un skill dans un dossier depuis la Bibliothèque le masque dans
Codex. Codex ignore le `config.toml` d'un projet pour les skills : seul un
réglage passé au client (`--config skills.config`) peut le faire. Le runtime de
la Bibliothèque (`server/piecemaker/library/runtime.ts`) calcule ce réglage et le
transmet dans `options.libraryCodexOptions` ; la seule ligne CloudCLI touchée le
remet au constructeur `Codex`. Sans option, le comportement est celui
d'upstream (`new Codex(undefined)`).

Un merge résolu « vers CloudCLI » remet `new Codex()` : les skills désactivés
réapparaissent dans Codex, sans erreur. Le garde-fou est
`server/piecemaker/library/codex-options.test.ts` (« exception CloudCLI : Codex
démarre / reprend… ») : il échoue alors. Restaurer la ligne, ne jamais supprimer
le test. Si upstream passe lui-même des options à `new Codex(...)`, les fusionner
avec `options.libraryCodexOptions` plutôt que d'en écraser une.

### `browser-use.service.ts` — le MCP navigateur de l'app de bureau

Activer « Navigateur » écrit l'outil MCP `cloudcli-browser` dans la config de
Claude, Codex, etc., avec `process.execPath` comme commande. Dans l'app de
bureau, c'est le binaire PieceMaker : sans `ELECTRON_RUN_AS_NODE=1`, chaque
session Claude ou Codex démarre l'app entière (serveur, plugins), que Claude
tue après 30 s en laissant des plugins orphelins. Le serveur de l'app tourne
déjà avec cette variable ; la seule ligne CloudCLI touchée la recopie dans
l'`env` de l'outil. Hors app de bureau, rien ne change.

Un merge résolu « vers CloudCLI » retire la ligne : l'app redémarre de nouveau à
chaque session, sans erreur. Garde-fou :
`server/piecemaker/browser-use-electron.test.ts` (« exception CloudCLI : le MCP
navigateur de l'app de bureau… »). Restaurer la ligne, ne jamais supprimer le
test. L'entrée déjà écrite chez l'utilisateur ne change qu'en désactivant puis
réactivant « Navigateur » (upstream ne la réécrit pas au démarrage,
siteboon/claudecodeui#1489).

### `EditorSidebar.tsx` et `WorkspaceMain.tsx` — les onglets de l'éditeur latéral

L'éditeur latéral de CloudCLI (le panneau qui partage la vue avec le chat)
reçoit des onglets, et les visionneuses PieceMaker (source d'une citation,
fiche d'une entité pseudonymisée) s'y ouvrent comme des fichiers. Tout vit dans
`src/piecemaker/editor-tabs/` ; deux points d'accroche seulement :

- `EditorSidebar.tsx` importe `TabbedCodeEditor` sous le nom `CodeEditor`. Le
  composant reçoit exactement les props de `CodeEditor` et les lui transmet :
  une nouvelle prop upstream passe sans changement. Il garde la liste des
  onglets, n'en monte qu'un (les raccourcis Échap et Ctrl+S de `CodeEditor`
  sont globaux) et rend lui-même les chemins `piecemaker://citation/…` et
  `piecemaker://identity/…`.
- `WorkspaceMain.tsx` appelle `usePiecemakerEditorBridge(handleFileOpen)`, qui
  relaie l'événement `piecemaker:open-in-editor` vers `handleFileOpen`.

`TabbedCodeEditor` vérifie aussi chaque fichier auprès du serveur
(`/api/piecemaker/file-links/resolve`) avant de monter `CodeEditor` : il lui
passe le chemin réel et affiche « Ce fichier n'existe plus » au lieu d'une
erreur. Un fichier situé hors du dossier s'ouvre dans la même visionneuse,
en lecture et en édition, parce que `server/index.ts` monte
`createExternalFileRouter()` (`server/piecemaker/file-links.ts`) devant
`fileTreeRoutes` : il ne prend que les chemins absolus que file-tree
refuserait et laisse passer le reste. Garde-fou :
`server/piecemaker/file-links.test.ts`. Si un merge retire cette ligne, les
liens vers un fichier hors du dossier renvoient de nouveau une erreur 403.

Un merge résolu « vers CloudCLI » retire les onglets et les visionneuses
n'ouvrent plus rien, sans erreur. Garde-fou :
`src/piecemaker/editor-tabs/tests/TabbedCodeEditor.test.tsx` (« exceptions
CloudCLI : le panneau latéral passe par les onglets PieceMaker »). Si upstream
déplace l'import de `CodeEditor` ou renomme `handleFileOpen`, reporter la
substitution sur le nouveau site plutôt que de la supprimer.

### `WorkspaceHeader.tsx` — les onglets compacts

Le module `src/modules/piecemaker-workspace-tabs/` affiche les icônes seules,
les noms au survol et les onglets excédentaires dans un menu sans scroll.
Le branchement de la barre remplace l'import de `WorkspaceTabs` dans
`WorkspaceHeader.tsx` par `WorkspaceIconTabs`.

`WorkspaceMain.tsx` importe aussi `withWorkspacePanels` et enveloppe son export
avec cette fonction. Le composant CloudCLI reste intact : Chat ou Terminal
reste la vue principale, tandis que les autres outils et plugins occupent des
cards à droite. Plusieurs cards peuvent rester ouvertes, être redimensionnées,
agrandies dans l'espace de travail ou fermées indépendamment.
Les cards sont rangées par colonnes dans l'ordre d'ouverture, deux par colonne.
Leur largeur appartient à la colonne : déplacer une séparation verticale
redimensionne toutes les cards des deux colonnes adjacentes. La séparation
entre Chat et les outils ajuste uniquement la première colonne d'outils.
Dans une colonne, la séparation horizontale agrandit une card et réduit l'autre,
à hauteur totale constante. Les séparations ne produisent aucun surlignage bleu.
Fermer une card laisse l'autre remplir sa colonne ; les autres cards gardent
leur colonne. Les tailles sont conservées pendant l'agrandissement.
L'agrandissement masque les autres vues sans démonter leur contenu. Les fichiers ouverts depuis
les volets utilisent la visionneuse existante.

La sauvegarde du code est dans `scripts/piecemaker/workspace-tabs/backup.json`.
Le test `src/modules/piecemaker-workspace-tabs/tests/WorkspaceIconTabs.test.tsx`
exécute automatiquement `node scripts/piecemaker/workspace-tabs/restore.mjs` :
les fichiers supprimés sont restaurés et les branchements upstream sont réinjectés.
Les fichiers PieceMaker encore présents ne sont jamais écrasés. Si upstream
déplace le branchement, le script échoue explicitement pour demander son report.
Si le module entier a été supprimé, le test autonome
`node --test scripts/piecemaker/workspace-tabs/restore.test.mjs` le rétablit
avant les tests frontend. Le script peut aussi être exécuté directement.
Actualiser la sauvegarde lorsque le module, ses tests ou ses feuilles de style évoluent.

### `AuthContext.tsx` — le piège le plus coûteux

Sans le correctif, l'en-tête `X-Refreshed-Token` relance l'amorçage, remet
`isLoading` à vrai, et `ProtectedRoute` démonte tout le sous-arbre `<Router>` :
dossier, onglet, chat et terminal perdus. Un merge résolu « vers CloudCLI »
réintroduit le bug **sans aucun signe visible**.

Le garde-fou est `src/piecemaker/auth/tests/authSessionSurvivesTokenRotation.test.tsx`.
Il échoue alors (l'amorçage part 3 fois au lieu d'une). **Ne jamais le
supprimer pour faire passer un merge.**

Depuis v1.37.4, upstream a corrigé le même bug (#1408 : lecture de
`readStoredToken()` et `t` passé par une ref) ainsi que l'affichage d'une
enveloppe d'erreur structurée (#1425, `readApiErrorMessage`). Nos cinq lignes
ont donc été abandonnées au profit de la version upstream : l'empreinte sur ce
fichier est nulle. Le test reste, pour le cas où upstream reviendrait en
arrière.

### `release.yml` — l'authentification npm n'est pas celle d'upstream

Upstream publie son propre paquet par trusted publishing (OIDC) et n'a donc
aucun token dans l'`env` du step Release. PieceMaker publie
`@piecemaker-legal/piecemaker` avec le secret `NPM_TOKEN` du dépôt : les deux
lignes `NPM_TOKEN` et `NODE_AUTH_TOKEN` doivent survivre à tout merge.

Prendre ce fichier « upstream verbatim » les supprime, et l'échec qui suit ne
ressemble pas à une perte de merge : `npm publish` renvoie un
`E404 Not Found - PUT https://registry.npmjs.org/@piecemaker-legal%2fpiecemaker`,
qui se lit comme un problème de droits chez npmjs alors que le token est
valide et que seul son passage a disparu. Perdu ainsi lors du merge de
CloudCLI v1.37.3, diagnostiqué après deux releases échouées.

Tout le reste du step vient d'upstream et se prend tel quel : npm `^11.5.1`,
le double `--verbose`, le step « Show npm failure details ».

### `package.json` — les champs `build` restent CloudCLI

`build.appId`, `build.productName` et `build.artifactName` gardent volontairement
les valeurs upstream. C'est `scripts/release/prepare-desktop-app.js` qui les
remplace à la construction depuis `product.config.json`. Y écrire une valeur
PieceMaker en dur est une régression, pas une correction.

---

## 5. Trois motifs de conflit et leur résolution

### a) Upstream transforme une chaîne en clé i18n

Le cas le plus fréquent. Nous avions branché la marque en dur, upstream passe à
`t('...')` :

```diff
-      footerText={`Enter your credentials to access ${PRODUCT_NAME}`}
+      footerText={t('login.footerText')}
```

**Prendre upstream, toujours.** La clé anglaise contient « CloudCLI » et c'est
la couche de surcharge qui la rebrande — c'est exactement son rôle. Le gain est
double : l'empreinte sur le fichier CloudCLI retombe à zéro, et la marque est
traduite dans les onze langues au lieu d'une.

Supprimer ensuite l'import `PRODUCT_NAME` devenu inutile, puis vérifier :

```sh
git diff upstream/main -- <fichier> | grep -c '^[+-][^+-]'   # viser 0
```

Puis régénérer et contrôler qu'aucune chaîne n'a échappé au renommage :

```sh
node scripts/piecemaker/generate-i18n-overrides.mjs
grep -ril cloudcli src/piecemaker/i18n/overrides/ || echo "aucune marque résiduelle"
```

Si une chaîne neuve reste en « CloudCLI », c'est une **règle manquante dans le
script**, pas une correction à faire à la main dans `locales/**` — ce dossier ne
se touche jamais.

Quand upstream ajoute une langue, le script s'arrête sur
`No PieceMaker wording rules for locale "xx"` **après avoir vidé**
`src/piecemaker/i18n/overrides/` : restaurer le dossier
(`git checkout -- src/piecemaker/i18n/overrides`), ajouter les règles de la
langue dans `RULES` (un nom de même genre que « projet » pour garder les
accords), puis relancer.

### b) Upstream déplace un symbole que nous avions étendu

Exemple vécu : `PROVIDER_LABELS` quitte `SidebarSessionItem.tsx` pour
`utils/sidebarProjectFormatting.ts`, alors que nous y avions ajouté `mistral`.

Prendre la suppression d'upstream, puis **reporter l'ajout au nouvel
emplacement**. L'empreinte se déplace, elle ne se duplique pas.

### c) Notre union `LLMProvider` est plus large qu'upstream

`mistral` est une fonctionnalité du fork. Tout `Record<LLMProvider, X>` **non
`Partial`** qu'upstream introduit ou modifie devient donc incomplet chez nous —
erreur de typage, jamais silencieuse. Les recenser puis laisser le typecheck
trancher :

```sh
grep -rn 'Record<LLMProvider' src/ server/ | grep -v Partial
npm run typecheck
```

---

## 6. Vérification finale, avant de commiter le merge

```sh
grep -rn '^<<<<<<<\|^>>>>>>>' src/ server/ scripts/ plugins/   # doit être vide
npm run typecheck
npm test
npx vitest run src/piecemaker/auth/tests/authSessionSurvivesTokenRotation.test.tsx
```

Le `package-lock.json` se régénère **sous la version de Node de la CI**, jamais
celle du poste — un npm plus récent produit des entrées imbriquées que `npm ci`
sous npm 10 refuse (`Missing: <pkg> from lock file`) :

```sh
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
nvm use 22 && rm -rf node_modules package-lock.json && npm install
npm ci   # le test qui simule exactement la CI
```

Puis relire le diff fichier par fichier et **justifier chaque hunk à voix
haute**. Ce qui ne se justifie pas se révoque.

```sh
git diff --cached upstream/main --stat -- src/modules/ server/modules/
git commit   # jamais de push
```

---

## 7. Écrire du code PieceMaker qui ne coûtera rien au merge suivant

Par ordre de préférence décroissante :

1. **Un plugin** (`ALLOWED_SLOTS = ['tab']`) — dépôt séparé, empreinte upstream
   nulle. Pour toute fonctionnalité autonome. Il porte ses propres traductions :
   l'i18n de l'hôte ne l'atteint pas.
2. **Un fichier à nous** sous `server/piecemaker/`, `src/piecemaker/`,
   `scripts/piecemaker/`. Coût de merge nul.
3. **Un décorateur** autour d'un service public, comme `harness/chat-harness.ts`
   qui enveloppe `providerRuntimeService.run` sans toucher un fichier upstream.
4. **La surcharge i18n** pour tout renommage de vocabulaire ou de marque. Elle
   réécrit l'existant ; elle ne crée aucun écran.
5. **En dernier recours**, une ligne dans un fichier CloudCLI — et seulement
   pour la marque ou l'isolation des données, avec repli sur la valeur upstream :

```ts
const value = PRODUCT_CONFIG.appId ?? 'ai.cloudcli.desktop';
```

Une substitution par ligne : le conflit futur se résout alors en une ligne, et
le code se comporte comme upstream si la configuration est absente.

### Une exception upstream se paie par un test

La séquence de `release.yml` conserve désormais la release GitHub en brouillon et appelle le workflow PieceMaker Windows avant publication. Cette modification est explicitement demandée pour empêcher toute annonce avant la disponibilité de l'installeur. Le test `desktop-bootstrap/lib/release-pipeline.test.mjs` protège l'ordre brouillon, vérification, téléversement, publication ; voir `docs/windows-update-performance.md`.

Les exceptions assumées (amorçage d'authentification, `isActive` du chat,
options du client Codex, onglets de l'éditeur latéral, MCP navigateur de l'app de bureau) ne sont pas des permissions : ce sont des dettes. Chacune doit porter un test
**à nous** qui échoue si un merge la révoque. Sans ce test, l'exception
disparaîtra un jour sans que personne ne le voie.

### Jamais en passant

Pas de reformatage, pas de nettoyage de commentaire, pas de correctif au vol
dans un fichier CloudCLI. `git diff <fichier upstream>` ne doit montrer que ce
que la marque ou l'isolation exige — tout le reste se révoque, si sensé soit-il.
