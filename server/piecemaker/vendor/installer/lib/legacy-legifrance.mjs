/**
 * Migration — restes des anciens serveurs MCP Légifrance.
 *
 * Un ancien serveur tournait en service launchd HTTP local. Sur une machine déjà
 * installée, cet agent survit à la mise à jour : `KeepAlive` le relance toutes
 * les 5 s sur un script désormais absent, ce qui recrée sans fin le dossier de
 * runtime supprimé et gonfle un journal d'erreurs de plusieurs mégaoctets.
 *
 * Un autre passait par le plugin Claude `piecemaker@mcp-legifrance`. Le seul
 * serveur est désormais `server/piecemaker/vendor/mcp/legifrance`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './ui.mjs';
import { runCapture } from './platform.mjs';

export const LEGACY_SERVICE_LABEL = 'com.piecemaker.mcp-legifrance-local';
const EXTERNAL_PLUGIN = 'piecemaker@mcp-legifrance';
const EXTERNAL_MARKETPLACE = 'mcp-legifrance';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Dossier de runtime hérité, à l'intérieur du dépôt. */
export function legacyRuntimeDir(root = REPOSITORY_ROOT) {
  return path.join(root, 'piecemaker-plugin', 'mcp');
}

/** Fichier launchd hérité, dans le home de l'utilisateur. */
export function legacyServicePlist(userHome = os.homedir()) {
  return path.join(userHome, 'Library', 'LaunchAgents', `${LEGACY_SERVICE_LABEL}.plist`);
}

/**
 * Retire l'agent launchd — d'abord, sinon il recrée aussitôt ses journaux —,
 * puis son .plist et le dossier de runtime. Idempotent : sur une machine
 * installée après l'extraction, rien n'existe et rien n'est fait. Renvoie la
 * liste de ce qui a été retiré, vide dans le cas courant.
 */
export function removeLegacyLegifranceService({
  userHome = os.homedir(),
  repositoryRoot = REPOSITORY_ROOT,
  capture = runCapture,
  logger = log,
  platform = process.platform,
} = {}) {
  const removed = [];
  if (platform === 'darwin') {
    const domain = `gui/${process.getuid()}`;
    if (capture('launchctl', ['print', `${domain}/${LEGACY_SERVICE_LABEL}`]).code === 0) {
      capture('launchctl', ['bootout', `${domain}/${LEGACY_SERVICE_LABEL}`]);
      removed.push('service launchd');
    }
    const plist = legacyServicePlist(userHome);
    if (fs.existsSync(plist)) {
      fs.rmSync(plist, { force: true });
      removed.push('fichier .plist');
    }
  }
  const runtime = legacyRuntimeDir(repositoryRoot);
  if (fs.existsSync(runtime)) {
    fs.rmSync(runtime, { recursive: true, force: true });
    removed.push('dossier de runtime hérité');
  }
  if (removed.length) {
    logger.detail(`Ancien serveur MCP Légifrance local nettoyé : ${removed.join(', ')}.`);
  }
  return removed;
}

export function removeExternalLegifrancePlugin({ capture = runCapture, logger = log } = {}) {
  const removed = [];
  const parsed = (result) => {
    if (result.code !== 0) return [];
    try { return JSON.parse(result.stdout); } catch { return []; }
  };
  if (parsed(capture('claude', ['plugin', 'list', '--json'])).some?.((plugin) => plugin.id === EXTERNAL_PLUGIN)
    && capture('claude', ['plugin', 'uninstall', EXTERNAL_PLUGIN]).code === 0) removed.push(EXTERNAL_PLUGIN);
  if (parsed(capture('claude', ['plugin', 'marketplace', 'list', '--json'])).some?.((marketplace) => marketplace.name === EXTERNAL_MARKETPLACE)
    && capture('claude', ['plugin', 'marketplace', 'remove', EXTERNAL_MARKETPLACE]).code === 0) removed.push(EXTERNAL_MARKETPLACE);
  if (removed.length) logger.info(`Ancien plugin Légifrance retiré : ${removed.join(', ')}`);
  return removed;
}
