## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

# Repository guidance

Forking CloudCLI. Never modify original code, only plug additions on top so upstream merges stay possible. Clear separation in folder (PieceMaker subfolder). **Never comment inside code files** — self-evident names, one comment in the commit message. **Always commit once a task is over. Never push.**

## Real data NEVER enters the repo

**No real name, company, address, ID number or document title taken from the user's cases, test corpora or scanned documents may appear anywhere in the repo or its git history: code, tests, fixtures, docs, comments, descriptions/prompts, file names, branch names, commit messages.** This has leaked before and required rewriting the whole history — it must never happen again.

- Always write fictitious data: `Jean Dupont`, `Société Exemple SAS`, `12 rue des Lilas, Paris`, `ZETABIO`. Invent it; never "lightly alter" a real value.
- When reading a real document or scan output to build a test or example, retype the example with invented values. Never paste entity text, excerpts, file names or benchmark document names.
- Real benchmark documents stay outside the repo (scratchpad, `~/.piecemaker`). Never reference their real names in a commit.
- Mechanical guard, hashed (no plaintext list in the repo): `scripts/piecemaker/guard-donnees-reelles/` — `.husky/pre-push` scans every pushed commit (messages, added lines, paths), `.github/workflows/guard-donnees-reelles.yml` re-checks on GitHub, and a Claude Code `PreToolUse` hook (`check.mjs claude-hook`, in `.claude/settings.local.json`, git-ignored) blocks writes. Add a newly discovered real term with `printf '%s\n' 'terme' | node scripts/piecemaker/guard-donnees-reelles/check.mjs add -` (hashes it; `--exact` keeps accents). Never bypass with `--no-verify`.
- If the guard flags something, fix the content — never the guard. Details: `docs/donnees-reelles.md`.

## Plugging code in / rebranding CloudCLI

Merge procedure and writing rules: `docs/upstream-cloudcli.md`. Upstream merges must stay mechanical — every added line is a future conflict.

- **Add, don't edit.** New behaviour goes in a new file/folder (no merge cost).
- **Touch an upstream file only for branding or data isolation** (hardcoded name, URL, `appId`, protocol, `~/.cloudcli` path). Nothing else justifies it.
- **One substitution per line, with an upstream fallback.** Replace hardcoded value with a reference to `product.config.json` (via `shared/product-config.mjs` or `src/shared/constants.ts`), defaulting to the original CloudCLI value.
- **Never improve an upstream file in passing.** No reformatting, no drive-by fixes. `git diff <upstream file>` must show only branding/isolation lines.
- **Copying an upstream file into a template**: copy byte-for-byte from `git show HEAD:<path>`, apply substitutions via a script asserting each pattern is present/unique, diff to confirm nothing else moved.
- **Never redirect provider-owned paths** (`~/.codex`, `~/.claude`, etc.) — only CloudCLI's own data root moves.
- Before committing: read `git diff` file by file, justify each hunk out loud; if you can't, revert it.

## Code PieceMaker (french-law feature) on top of CloudCLI

- `server/piecemaker/vendor/` — **owned code, not a synced copy.** Originally forked from PieceMaker-Installer but modifies freely now like the rest of the repo; nothing needs upstreaming there. The "Add, don't edit" rule applies only to CloudCLI files. Folder names/tree (`websocket-server/`, `piecemaker-plugin/`, `installer/`, `mcp/`) are kept because internal `require`s depend on them.
- **Harness Legal** — mechanical citation-verification layer for legal research (Claude/Codex/Mistral chat). Full detail, invariants and file map: `docs/harness-legal.md`.
- **Protection des pièces** — the `protect-originals` hook acts only on green-shield projects (anonymization complete, published to `~/.piecemaker/anonymized-projects.json`, and not lifted): there PDFs/images are never read by the AI, which is redirected to the converted Markdown. A click on the project's sidebar shield (`CaseProtectionShield`, green = protected, red crossed-out = lifted, confirmation required) lifts it for a whole project. Not-yet-anonymized projects (no shield) are not protected. Every CloudCLI project is a legal case (the server publishes them to `~/.piecemaker/projects.json`; `caseFolders` is gone). Per-case exceptions in `.piecemaker/protection.json` (atomic, locked writes). Two defense layers (hooks / hudsucker anonymisation proxy), only the first truly prevents access. Operation, files, consumers and known limits: `docs/protection-pieces.md`.
- **Outil `sql`** — accès SQL unique du LLM à la base du dossier (Claude, Codex, Vibe) : masquage fait par le serveur, `dossier()`, citations, exclusions, scan additif, sauvegarde hebdomadaire ; remplace l'outil MCP `renommage`. Détail : `docs/outil-sql.md`.
- **Historique du dossier** — commit Git local automatique (jamais de remote) à chaque tour Claude/Codex et après les modifications de l'avocat (« Modifications hors IA »), en tâche de fond, un seul `git` à la fois ; skill `historique-dossier` pour le retour arrière, Git durci dans `protect-originals`. Détail : `docs/historique-dossier.md`.
- **Accès téléphone** — Réglages › Téléphone publie l'UI sur le tailnet via Tailscale Serve (jamais Funnel), derrière une passerelle loopback qui n'accepte que le compte Tailscale du propriétaire ; maintien d'éveil tant que publié. Détail : `docs/acces-telephone.md`.
- **Raisonnement** — l'agent transcrit sa réponse juridique dans `.piecemaker/raisonnement.js` (objet sans fonctions : conditions si / sauf / l_une, sources avec citation et vigueur, pièces) ; `pm raisonnement verifier` le lit sans l'exécuter, vérifie sources, citations, vigueur, pièces et personnes, exécute la fonction test et renvoie l'objet annoté. L'avocat écarte des alertes et note la fiabilité des pièces. Détail : `docs/raisonnement.md`.
- **Anonymisation** — GLiNER scan & mapping, applied to AI traffic by the hudsucker proxy (`server/piecemaker/anonymizer/`).
- **Documents Word (`.docx`)** — assistant via the vendored `docx-cli` skill (`server/piecemaker/vendor/skills/docx-cli/`) and `redaction-juridique` (`vendor/piecemaker-plugin/skills/redaction-juridique/`), both declared in every case folder; lawyer via the in-app editor (`src/piecemaker/docx/`, route `docx-document.ts`, single hook line in `CodeEditor.tsx`). Operation and known defects from the audit: `docs/docx.md`.
- **Research** — French legal research via the vendored Légifrance MCP: `server/piecemaker/vendor/mcp/legifrance/`. Identifiants PISTE dans `~/.config/mcp-legifrance/.env`.
- **Surcharge i18n & Système de plugins** — i18n overrides rename existing UI (vocabulary/brand) without touching upstream locale files; the plugin system is the extension point for genuinely new screens/features (single `tab` slot, minimal host API). They don't overlap — full detail, comparison table and known upstream exceptions (auth bootstrap, chat tab visibility, Codex client options for per-folder skill masking): `docs/i18n-et-plugins.md`.

### Frontend code standards

- Frontend code under `src/`: load and follow `$frontend-module-standards` from `.agents/skills/frontend-module-standards/SKILL.md`.
- Apply it only to `src/` — never impose it on backend code.

## Commande `piecemaker`

Developer / PWA entry point (ports, clone/update, deps, socle components, app start w/ hudsucker anonymisation proxy, PWA install, open). No questions asked; skippable with `--launch-only`. Bootstrap one-liners: `docs/cli-piecemaker.md`. End-user desktop install is `desktop-bootstrap/`.

## Installation de l'app de bureau (`desktop-bootstrap/`)

Installateur autonome, sans rapport avec la commande `piecemaker` ni avec `server/piecemaker/vendor/installer/` : `curl` (mac) / `irm` (Windows) installe l'app Electron. Windows utilise l'installeur NSIS précompilé signé Authenticode éditeur ; la CA TLS locale du proxy reste générée sur le poste. Détail : `docs/installation-app-electron.md`.

## Développement local

- Server always on port 3003: `SERVER_PORT=3003 PORT=3003 npm run dev`. Port 3002 is the installed desktop app — a fixed dev port avoids hunting for it.
- Client (Vite) at http://localhost:5173 — open this URL. Proxy points at `SERVER_PORT`.
- **Never look at the UI on port 3003 and never run `vite build` / `npm run build` to check a change.** 3003 serves the compiled `dist/` when it exists, i.e. an old version; Vite (5173) always serves the current code. A build eats several GB of RAM and freezes the 8 GB Mac on top of the running dev server. Keep `dist/` absent in the working copy (3003 then redirects to 5173).
- **Dev and desktop app never share data.** The working copy's `.env` (git-ignored, create it on a new machine) holds `CLOUDCLI_HOME=$HOME/.piecemaker-droit-francais-dev` (absolute path): the dev server, `npm run plugins` and the `piecemaker` command launched from this clone use that folder; the installed desktop app keeps `~/.piecemaker-droit-francais` and reinstalls its own embedded plugins there at each start. Without it, each overwrites the other's plugins and the dev UI shows stale plugins. After changing a plugin: `npm run plugins`, then reload. The desktop app only gets new plugins with a new release.
- **One dev server at a time.** Before `npm run dev`, check `lsof -iTCP:3003 -iTCP:5173 -sTCP:LISTEN` and reuse what runs. A server change needs a restart (tsx without watch): ask first, stop it with SIGTERM (never `kill -9`, it orphans plugins and hudsucker).
- System Node is v16 (too old for Vite 7) — use nvm v24: prefix with `export PATH="$HOME/.nvm/versions/node/v24.11.1/bin:$PATH"`.
- **Hudsucker = the anonymisation proxy**. Spawned by the server at startup on a dynamic port, killed with it; disabled by `anonymizer.enabled: false` in `~/.piecemaker/config.json`. Sessions launched by the server (chat, built-in terminal) inherit its `HTTPS_PROXY` at spawn: when the server stops they **fail closed** (ECONNREFUSED), never continue unfiltered — open a new session after relaunch. Sessions opened outside PieceMaker (Terminal, Claude desktop) never go through hudsucker and are unaffected by a server stop. Don't kill a server the user is running without asking.

## Packaging, release, distribution

npm package, GitHub Packages, Windows Authenticode (`WINDOWS_CSC_LINK`), version-check/release-name mechanics, `package-lock.json` regeneration under the CI's exact Node/npm version, and the recommended `release.yml` pipeline are documented in `docs/packaging-et-release.md`. Key rule: always release via `release.yml` (Windows assets, then npm, then GitHub publish — never `publish-npm-package.yml` alone), and always ask the user for the version increment — never infer it.

## About CloudCLI

Licensed AGPL-3.0-or-later; published packages retain CloudCLI attribution.
