/**
 * Step 13 — global secret-file guard for Claude Code.
 *
 * Reproduces, via the installer, a guard that previously only existed by
 * hand under ~/.claude/ and would vanish on a fresh machine or a wiped
 * ~/.claude: a `PreToolUse` hook that denies the *agent* any read of the
 * server's `.env` et la base `auth.db` (Read/Grep/Glob/Edit/Write/NotebookEdit and Bash
 * workarounds — cat/grep/head/`python -c "open(...)"`…), because the first
 * holds Légifrance credentials and the second the real names behind every
 * pseudonymisation code (`piecemaker_mappings`). See `installer/lib/secrets-guard.mjs` for
 * the merge logic and `installer/assets/claude-hooks/
 * piecemaker-guard-secrets.mjs` for the hook itself (a byte-for-byte copy of
 * the one that was running standalone in ~/.claude/hooks).
 *
 * Comme les autres hooks PieceMaker, il est câblé directement dans
 * ~/.claude/settings.json, sans manifest ni cache de plugin. Il reste séparé
 * car il protège un fichier global précis et maintient sa propre liste noire.
 *
 * The .env this seeds the blocklist with is resolved the same way the rest
 * of the installer already resolves "the server's .env" — `ENV_FILE` from
 * `installer/lib/state.mjs`, i.e. `REPO_ROOT/.env` — so whichever clone
 * (dev checkout or `~/PieceMaker` runtime install) this particular installer
 * instance is running from, it seeds the blocklist with THAT clone's own
 * `.env`. Nothing here hardcodes a username or an absolute path.
 *
 * Idempotent end to end: re-running never duplicates the PreToolUse entry,
 * the permissions.deny rule, or a blocklist entry, and only rewrites a file
 * whose content would actually change.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log } from '../lib/ui.mjs';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, GIT_REPO_ROOT } from '../lib/platform.mjs';
import { ENV_FILE } from '../lib/state.mjs';
import {
  HOOK_SCRIPT_BASENAME,
  blocklistTargetPath,
  denyRuleFor,
  hookAssetPath,
  hookTargetPath,
  installHookScript,
  mergeSettings,
  seedBlocklist,
  settingsPath,
} from '../lib/secrets-guard.mjs';

export const meta = {
  id: '13-garde-secrets',
  label: 'Garde-fou secrets (Claude Code)',
  description: "Empêche Claude Code de lire le .env et la base auth.db (noms réels)",
};

async function databaseFiles() {
  const upstreamRoot = path.join(os.homedir(), '.cloudcli');
  let dataRoot = upstreamRoot;
  try {
    const { productDataRoot } = await import(pathToFileURL(path.join(GIT_REPO_ROOT, 'shared', 'product-config.mjs')).href);
    dataRoot = productDataRoot(upstreamRoot);
  } catch {
    dataRoot = process.env.CLOUDCLI_HOME || upstreamRoot;
  }
  const database = process.env.DATABASE_PATH || path.join(dataRoot, 'auth.db');
  return ['', '-wal', '-shm'].map((suffix) => `${database}${suffix}`);
}

async function protectedPaths() {
  return [ENV_FILE, ...await databaseFiles()];
}

export async function install(ctx) {
  const userHome = os.homedir();
  const guarded = await protectedPaths();

  if (ctx.dryRun) {
    log.info(`[simulation] hook installé/rafraîchi : ${hookTargetPath(userHome)} <- ${hookAssetPath(REPO_ROOT)}`);
    log.info(`[simulation] liste noire créée/complétée : ${blocklistTargetPath(userHome)} (+${guarded.join(', ')})`);
    log.info(`[simulation] ${settingsPath(userHome)} : hook PreToolUse + permissions.deny fusionnés`);
    return { status: 'skipped', note: 'Mode simulation — aucune modification effectuée.' };
  }

  if (!fs.existsSync(hookAssetPath(REPO_ROOT))) {
    return { status: 'failed', note: `Asset manquant dans le dépôt : ${hookAssetPath(REPO_ROOT)}` };
  }

  const hook = installHookScript({ repoRoot: REPO_ROOT, userHome });
  if (hook.changed) log.ok(`Hook ${hook.created ? 'installé' : 'mis à jour'} : ${hook.path}`);
  else log.ok(`Hook déjà à jour : ${hook.path}`);

  const blocklist = seedBlocklist({ repoRoot: REPO_ROOT, userHome, envPaths: guarded });
  if (blocklist.created) log.ok(`Liste noire créée : ${blocklist.path} (${blocklist.entries.length} chemin(s))`);
  else if (blocklist.added.length) log.ok(`Liste noire complétée (+${blocklist.added.length}) : ${blocklist.path}`);
  else log.ok(`Liste noire déjà à jour : ${blocklist.path}`);

  const settings = mergeSettings({ userHome, envPaths: guarded });
  if (settings.hookAdded) log.ok(`Hook PreToolUse enregistré dans ${settings.path}`);
  else log.ok('Hook PreToolUse déjà enregistré.');
  if (settings.denyAdded.length) log.ok(`Règle(s) permissions.deny ajoutée(s) : ${settings.denyAdded.join(', ')}`);
  else log.ok('Règle(s) permissions.deny déjà présente(s).');

  log.detail("Ce garde-fou est enregistré directement dans Claude Code, sans dépendre d'un plugin PieceMaker.");

  return { status: 'done', note: '' };
}

export async function check(ctx) {
  const userHome = os.homedir();
  const guarded = await protectedPaths();

  const hookOk = fs.existsSync(hookTargetPath(userHome));

  let blocklistOk = false;
  try {
    const list = JSON.parse(fs.readFileSync(blocklistTargetPath(userHome), 'utf8'));
    const normalized = new Set(Array.isArray(list)
      ? list.filter((entry) => typeof entry === 'string').map((entry) => path.resolve(entry))
      : []);
    blocklistOk = guarded.every((entry) => normalized.has(path.resolve(entry)));
  } catch {
    // absent or malformed -> not ok
  }

  let hookWiredOk = false;
  let denyOk = false;
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath(userHome), 'utf8'));
    const preToolUse = settings?.hooks?.PreToolUse;
    hookWiredOk =
      Array.isArray(preToolUse) &&
      preToolUse.some(
        (group) =>
          Array.isArray(group?.hooks) &&
          group.hooks.some((h) => typeof h?.command === 'string' && h.command.includes(HOOK_SCRIPT_BASENAME))
      );
    const deny = settings?.permissions?.deny;
    denyOk = Array.isArray(deny)
      && guarded.every((entry) => deny.includes(denyRuleFor(entry)));
  } catch {
    // absent or malformed -> not ok
  }

  if (hookOk && blocklistOk && hookWiredOk && denyOk) return { status: 'done', note: '' };

  const missing = [];
  if (!hookOk) missing.push('script du hook');
  if (!blocklistOk) missing.push('liste noire');
  if (!hookWiredOk) missing.push('câblage PreToolUse');
  if (!denyOk) missing.push('règle permissions.deny');

  if (missing.length === 4) return { status: 'failed', note: 'Garde-fou secrets absent — relancez cette étape.' };
  return { status: 'partial', note: `Incomplet (${missing.join(', ')}) — relancez cette étape.` };
}
