// Installe un bundle de plugins (produit par build.mjs) dans le répertoire de
// données de PieceMaker. Autonome (aucun import hors node:*) : il est copié dans
// chaque bundle, ce qui permet à l'application Electron de l'exécuter depuis
// son propre paquet à chaque démarrage.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const BUNDLE_MANIFEST = 'bundle.json';
export const INSTALLED_MARKER = '.piecemaker-bundle';

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function installedFingerprint(target) {
  try {
    return fs.readFileSync(path.join(target, INSTALLED_MARKER), 'utf8').trim();
  } catch {
    return null;
  }
}

/** Remplace le plugin installé sans jamais exposer un dossier à moitié copié. */
function replacePlugin(source, pluginsDir, id, fingerprint) {
  const target = path.join(pluginsDir, id);
  // Préfixe `.tmp-` : ignoré par scanPlugins() pendant la copie.
  const staging = path.join(pluginsDir, `.tmp-${id}-${crypto.randomBytes(4).toString('hex')}`);
  fs.cpSync(source, staging, { recursive: true });
  fs.writeFileSync(path.join(staging, INSTALLED_MARKER), `${fingerprint}\n`);
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(staging, target);
}

/**
 * Le choix de l'utilisateur (activé/désactivé) est conservé. Un plugin à
 * serveur reçoit un secret, tiré une fois puis gardé : l'hôte l'injecte en
 * en-tête `x-plugin-secret-access` et le serveur le lit dans runtime.json.
 */
function pluginConfig(current, hasServer) {
  const entry = { ...current, enabled: current?.enabled ?? true };
  if (hasServer) {
    const secret = entry.secrets?.access;
    if (typeof secret !== 'string' || secret.length < 32) {
      entry.secrets = { ...entry.secrets, access: crypto.randomBytes(32).toString('hex') };
    }
  }
  return entry;
}

function writeRuntime(target, runtime) {
  const runtimePath = path.join(target, 'runtime.json');
  if (JSON.stringify(readJson(runtimePath, null)) !== JSON.stringify(runtime)) writeJson(runtimePath, runtime);
}

/**
 * Aligne `<dataRoot>/plugins` sur le bundle : plugin absent ou d'empreinte
 * différente recopié, plugin retiré des sources désinstallé (seulement s'il
 * porte le marqueur, donc s'il a été posé par cet outil), runtime.json des
 * plugins à serveur réécrit.
 */
export function syncPlugins({ bundleDir, dataRoot, databasePath, log = console }) {
  const bundle = readJson(path.join(bundleDir, BUNDLE_MANIFEST), null);
  if (!bundle?.plugins) return { installed: [], removed: [], failed: [] };

  const pluginsDir = path.join(dataRoot, 'plugins');
  const configPath = path.join(dataRoot, 'plugins.json');
  fs.mkdirSync(pluginsDir, { recursive: true, mode: 0o700 });
  const config = readJson(configPath, {});
  const before = JSON.stringify(config);
  const installed = [];
  const removed = [];
  const failed = [];

  for (const [id, { fingerprint, server }] of Object.entries(bundle.plugins)) {
    try {
      const target = path.join(pluginsDir, id);
      if (installedFingerprint(target) !== fingerprint) {
        replacePlugin(path.join(bundleDir, id), pluginsDir, id, fingerprint);
        installed.push(id);
      }
      config[id] = pluginConfig(config[id], server);
      if (server) {
        writeRuntime(target, { ...bundle.runtime, databasePath, secret: config[id].secrets.access });
      }
    } catch (error) {
      failed.push(id);
      log.error?.(`[PieceMaker] Plugin ${id} non installé : ${error.message}`);
    }
  }

  for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name in bundle.plugins) continue;
    const target = path.join(pluginsDir, entry.name);
    if (entry.name.startsWith('.tmp-piecemaker-')) {
      fs.rmSync(target, { recursive: true, force: true });
    } else if (installedFingerprint(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      delete config[entry.name];
      removed.push(entry.name);
    }
  }

  if (JSON.stringify(config) !== before) writeJson(configPath, config);
  if (installed.length) log.log?.(`[PieceMaker] Plugins installés : ${installed.join(', ')}`);
  if (removed.length) log.log?.(`[PieceMaker] Plugins retirés : ${removed.join(', ')}`);
  return { installed, removed, failed };
}
