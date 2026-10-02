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
| `src/modules/auth/context/AuthContext.tsx` | `useRef`, `tokenRef`, l'effet `tokenRef.current = token`, et **`token` absent des deps de `checkAuthStatus`** |
| `src/modules/i18n/config.ts` | l'import, `PIECEMAKER_DEFAULT_LANGUAGE`, `applyPieceMakerI18nOverrides(i18n)` |
| `src/modules/settings/tabs/AboutTab.tsx` | `useProductVersionCheck`, `PRODUCT_REPOSITORY_URL`, `PRODUCT_SHORT_NAME` |
| `.release-it.json` | `"releaseName": "PieceMaker v${version}"` et l'en-tête de changelog |
| `.github/workflows/release.yml` | `NPM_TOKEN` et `NODE_AUTH_TOKEN` dans l'`env` du step Release |
| `package.json` | nom `@piecemaker-legal/piecemaker`, version PieceMaker (**ne jamais prendre la version upstream**), `homepage`/`repository` PieceMaker |
| `src/modules/chat/ChatInterface.tsx`, `hooks/useChatComposerState.ts`, `hooks/useSlashCommands.ts` | la transmission de `isActive` |
| `src/shared/types.ts` | `'mistral'` dans l'union `LLMProvider` |

### `AuthContext.tsx` — le piège le plus coûteux

Sans le correctif, l'en-tête `X-Refreshed-Token` relance l'amorçage, remet
`isLoading` à vrai, et `ProtectedRoute` démonte tout le sous-arbre `<Router>` :
dossier, onglet, chat et terminal perdus. Un merge résolu « vers CloudCLI »
réintroduit le bug **sans aucun signe visible**.

Le garde-fou est `src/piecemaker/auth/tests/authSessionSurvivesTokenRotation.test.tsx`.
Il échoue alors (l'amorçage part 3 fois au lieu d'une). **Ne jamais le
supprimer pour faire passer un merge** : restaurer les cinq lignes.

Quand upstream ajoute une dépendance légitime à ce `useCallback` (par exemple
`t` de `useTranslation`), la prendre — mais **retirer `token`** :

```ts
}, [checkOnboardingStatus, clearSession, t]);   // jamais `token`
```

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

Les deux exceptions assumées (amorçage d'authentification, `isActive` du chat)
ne sont pas des permissions : ce sont des dettes. Chacune doit porter un test
**à nous** qui échoue si un merge la révoque. Sans ce test, l'exception
disparaîtra un jour sans que personne ne le voie.

### Jamais en passant

Pas de reformatage, pas de nettoyage de commentaire, pas de correctif au vol
dans un fichier CloudCLI. `git diff <fichier upstream>` ne doit montrer que ce
que la marque ou l'isolation exige — tout le reste se révoque, si sensé soit-il.
