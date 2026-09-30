import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Les plugins PieceMaker sont compilés à la construction de l'application et
// embarqués dans `piecemaker-plugins/`. À chaque démarrage, avant que le
// serveur local ne lise `<données>/plugins`, on y recopie toute version absente
// ou différente : un plugin ne dépend plus d'une étape d'installation annexe
// qui a pu échouer, être sautée ou viser un autre répertoire de données.

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

/** Remplace le plugin installé sans jamais laisser de dossier à moitié copié visible. */
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
 * Aligne runtime.json sur le secret de plugins.json (tiré ici s'il manque :
 * le paquet n'en contient pas) et sur la base réellement utilisée par le serveur.
 */
function alignRuntime(target, entry, databasePath) {
  const runtimePath = path.join(target, 'runtime.json');
  const runtime = readJson(runtimePath, null);
  if (!runtime) return;
  const next = { ...runtime };
  if ('secret' in runtime) {
    if (typeof entry.secrets?.access !== 'string' || entry.secrets.access.length < 32) {
      entry.secrets = { ...entry.secrets, access: crypto.randomBytes(32).toString('hex') };
    }
    next.secret = entry.secrets.access;
  }
  if ('databasePath' in runtime && databasePath) next.databasePath = databasePath;
  if (JSON.stringify(next) !== JSON.stringify(runtime)) writeJson(runtimePath, next);
}

/**
 * Le choix de l'utilisateur (activé/désactivé) et un secret déjà en place
 * l'emportent ; le reste vient de la construction.
 */
function mergeConfig(current, bundled) {
  const merged = { ...bundled, ...current, enabled: current?.enabled ?? true };
  const secrets = { ...bundled?.secrets, ...current?.secrets };
  if (Object.keys(secrets).length) merged.secrets = secrets;
  else delete merged.secrets;
  return merged;
}

export function syncBundledPlugins({ bundleDir, dataRoot, databasePath, log = console }) {
  const bundle = readJson(path.join(bundleDir, BUNDLE_MANIFEST), null);
  if (!bundle?.plugins) return { installed: [], failed: [] };

  const pluginsDir = path.join(dataRoot, 'plugins');
  const configPath = path.join(dataRoot, 'plugins.json');
  fs.mkdirSync(pluginsDir, { recursive: true, mode: 0o700 });
  const config = readJson(configPath, {});
  const before = JSON.stringify(config);
  const installed = [];
  const failed = [];

  for (const [id, { fingerprint, config: bundledConfig }] of Object.entries(bundle.plugins)) {
    try {
      const target = path.join(pluginsDir, id);
      if (installedFingerprint(target) !== fingerprint) {
        replacePlugin(path.join(bundleDir, id), pluginsDir, id, fingerprint);
        installed.push(id);
      }
      config[id] = mergeConfig(config[id], bundledConfig);
      alignRuntime(target, config[id], databasePath);
    } catch (error) {
      failed.push(id);
      log.error?.(`[PieceMaker] Plugin ${id} non synchronisé : ${error.message}`);
    }
  }

  if (JSON.stringify(config) !== before) writeJson(configPath, config);
  if (installed.length) log.log?.(`[PieceMaker] Plugins synchronisés : ${installed.join(', ')}`);
  return { installed, failed };
}
