import os from 'node:os';
import path from 'node:path';

const PRODUCT_NAME = 'PieceMaker';
const LIBRARY_DIRECTORY = 'library-backend';
export const UNINSTALL_ARGUMENT = '--piecemaker-uninstall';
const paths = path.posix;

export function packagedApplicationRoot(appPath, platform = process.platform) {
  if (!appPath) return null;
  if (platform === 'darwin') {
    const root = paths.resolve(appPath, '..', '..', '..');
    return paths.basename(root) === `${PRODUCT_NAME}.app` ? root : null;
  }
  return null;
}

function underHome(target, home) {
  const resolved = paths.resolve(target);
  const root = paths.resolve(home);
  if (resolved === root) return false;
  const relative = paths.relative(root, resolved);
  return relative !== '' && !relative.startsWith('..') && !paths.isAbsolute(relative);
}

function safeNamedDirectory(candidate, home, fallback, basename) {
  if (typeof candidate !== 'string' || !candidate.trim()) return fallback;
  const resolved = paths.resolve(candidate);
  if (paths.basename(resolved) !== basename || !underHome(resolved, home)) return fallback;
  return resolved;
}

const DATABASE_FILES = ['', '-wal', '-shm'];

function isWithin(target, root) {
  const relative = paths.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !paths.isAbsolute(relative));
}

function macLibraryPaths(home, appId, platform) {
  if (platform !== 'darwin' || !appId) return [];
  const library = paths.join(home, 'Library');
  return [
    paths.join(library, 'Preferences', `${appId}.plist`),
    paths.join(library, 'Saved Application State', `${appId}.savedState`),
    paths.join(library, 'Caches', appId),
    paths.join(library, 'Caches', `${appId}.ShipIt`),
    paths.join(library, 'HTTPStorages', appId),
    paths.join(library, 'HTTPStorages', `${appId}.binarycookies`),
    paths.join(library, 'WebKit', appId),
  ];
}

export function removalTargets(candidates, database, home) {
  const resolvedDatabase = paths.resolve(database);
  const databaseDirectory = paths.dirname(resolvedDatabase);
  const keep = DATABASE_FILES.map((suffix) => `${paths.basename(resolvedDatabase)}${suffix}`);
  const remove = [];
  const purge = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    const target = paths.resolve(candidate);
    if (seen.has(target) || !underHome(target, home)) continue;
    seen.add(target);
    if (target === databaseDirectory) purge.push({ directory: target, keep });
    else if (!isWithin(resolvedDatabase, target)) remove.push(target);
  }
  return { remove, purge };
}

export function removalPlan(appRoot, home = os.homedir(), env = process.env, platform = process.platform, extra = {}) {
  const dataHome = env.PIECEMAKER_HOME || paths.join(home, '.piecemaker');
  const componentsHome = env.PIECEMAKER_COMPONENTS_HOME || dataHome;
  const productHome = extra.productDataRoot || paths.join(home, '.cloudcli');
  const database = env.DATABASE_PATH || paths.join(productHome, 'auth.db');
  const fallbackVenv = paths.join(componentsHome, 'venv');
  const { remove, purge } = removalTargets([
    dataHome,
    productHome,
    paths.join(componentsHome, 'python'),
    safeNamedDirectory(extra.config?.venvPath, home, fallbackVenv, 'venv'),
    env.PIECEMAKER_BOOTSTRAP_HOME || paths.join(dataHome, 'bootstrap'),
    ...(extra.electronPaths || []),
    ...macLibraryPaths(home, extra.appId, platform),
  ], database, home);
  const libraryHome = paths.resolve(dataHome);
  const purgedLibraryHome = purge.find((entry) => entry.directory === libraryHome);
  const keptData = [LIBRARY_DIRECTORY, 'vibe-session-origins', 'vibe-message-times'];
  if (purgedLibraryHome) purgedLibraryHome.keep.push(...keptData);
  else if (remove.includes(libraryHome)) {
    remove.splice(remove.indexOf(libraryHome), 1);
    purge.push({ directory: libraryHome, keep: keptData });
  }
  return {
    appRoot,
    caCert: paths.join(dataHome, 'certs', 'piecemaker-ca.crt'),
    remove,
    purge,
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function macUninstallScript(plan) {
  const purges = plan.purge.map(({ directory, keep }) => (
    `[ -d ${shellQuote(directory)} ] && find ${shellQuote(directory)} -mindepth 1 -maxdepth 1 ${keep.map((name) => `! -name ${shellQuote(name)}`).join(' ')} -exec rm -rf {} +\n`
  )).join('');
  return `#!/bin/sh
set -u
while kill -0 "$1" 2>/dev/null; do sleep 0.3; done
sleep 0.5
security remove-trusted-cert ${shellQuote(plan.caCert)} || true
keychain=$(security default-keychain -d user 2>/dev/null | tr -d ' "')
fingerprint=$(openssl x509 -in ${shellQuote(plan.caCert)} -noout -fingerprint -sha1 2>/dev/null | cut -d= -f2 | tr -d ':')
if [ -n "$keychain" ] && [ -n "$fingerprint" ]; then
  security delete-certificate -Z "$fingerprint" "$keychain" || true
fi
${plan.remove.length ? `rm -rf ${plan.remove.map(shellQuote).join(' ')}\n` : ''}${purges}rm -rf ${shellQuote(plan.appRoot)}
`;
}
