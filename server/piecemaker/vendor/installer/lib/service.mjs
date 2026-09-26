/**
 * Maintenance du dépôt installé : mise à jour Git/npm. Aucun serveur local
 * n'est piloté ici — l'application et son proxy PII sont démarrés par la
 * commande `piecemaker`.
 */

import { REPO_ROOT, npmBin, npmEnv, runCapture } from './platform.mjs';

function runOrThrow(command, args, label) {
  const result = runCapture(command, args, { cwd: REPO_ROOT });
  if (result.code !== 0 || result.error) {
    throw new Error(`${label} : ${result.stderr || result.stdout || result.error?.message || `code ${result.code}`}`);
  }
  return result;
}

function gitOut(args, label) {
  return runOrThrow('git', args, label).stdout;
}

/**
 * Fetch the target ref and report whether it differs from the checked-out
 * revision. Read-only: nothing is stopped, moved or installed here, so the
 * caller can decide about downtime before the working tree is touched.
 */
export function checkForUpdate() {
  const branch = gitOut(['branch', '--show-current'], 'Impossible de déterminer la branche');
  const ref = process.env.PIECEMAKER_REF || branch || 'main';
  runOrThrow('git', ['fetch', 'origin', ref], 'Téléchargement Git impossible');

  const current = gitOut(['rev-parse', 'HEAD'], 'Impossible de lire la révision locale');
  const target = gitOut(['rev-parse', 'FETCH_HEAD'], 'Impossible de lire la révision distante');
  // The installed checkout is a deployment artifact: tracked local edits are
  // never a second source of truth. They trigger reconciliation with origin,
  // while untracked/ignored runtime data remains untouched.
  const localChanges = gitOut(
    ['status', '--porcelain', '--untracked-files=no'],
    'Impossible de vérifier le dépôt',
  ).split('\n').filter(Boolean);
  const changed = current === target
    ? []
    : gitOut(['diff', '--name-only', current, target], 'Impossible de comparer les révisions')
      .split('\n')
      .filter(Boolean);

  const remoteAvailable = current !== target;
  const dirty = localChanges.length > 0;
  return {
    ref,
    branch,
    current,
    target,
    changed,
    localChanges: localChanges.length,
    dirty,
    remoteAvailable,
    available: remoteAvailable || dirty,
  };
}

/**
 * Apply a pending update: move the working tree to the fetched revision, then
 * reconcile node_modules with the new package.json. `git` handles both halves
 * of "delete deprecated files, download new ones" — a checkout removes files
 * dropped upstream and writes the added ones — and `npm prune` does the same
 * for dependencies that no longer appear in package.json.
 *
 * Pass the result of `checkForUpdate()` to avoid fetching twice.
 */
export function updateRepository(pending = checkForUpdate()) {
  if (!pending.available) return { ...pending, updated: false };

  // origin is authoritative for every tracked file in the installed clone.
  // `reset --hard` also handles divergent commits and a detached HEAD. It does
  // not perform `git clean`, so untracked and ignored runtime data is kept.
  runOrThrow('git', ['reset', '--hard', 'FETCH_HEAD'], 'Mise à jour Git impossible');

  const npmOptions = { cwd: REPO_ROOT, env: npmEnv() };
  const installed = runCapture(npmBin('npm'), ['install', '--no-audit', '--no-fund'], npmOptions);
  if (installed.code !== 0 || installed.error) {
    throw new Error(`Mise à jour npm impossible : ${installed.stderr || installed.stdout || installed.error?.message || `code ${installed.code}`}`);
  }
  const pruned = runCapture(npmBin('npm'), ['prune', '--no-audit', '--no-fund'], npmOptions);
  if (pruned.code !== 0 || pruned.error) {
    throw new Error(`Nettoyage des dépendances impossible : ${pruned.stderr || pruned.stdout || pruned.error?.message || `code ${pruned.code}`}`);
  }
  return {
    ...pending,
    updated: true,
    // requirements.txt is installed into the venv by step 03, not by npm.
    pythonChanged: pending.changed.some((file) => file.endsWith('requirements.txt')),
  };
}
