import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from './shell.mjs';
import { ui } from './ui.mjs';

export const BUNDLE_DIR = 'piecemaker-plugins';

// Découverts sur disque (tout `plugins/piecemaker-*` doté d'un install.mjs)
// plutôt que listés en dur : l'ancienne liste avait oublié Tabular Review.
export async function bundledPlugins(sourceDir) {
  const root = path.join(sourceDir, 'plugins');
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const plugins = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('piecemaker-')) continue;
    const installer = path.join(root, entry.name, 'install.mjs');
    if (!(await fs.access(installer).then(() => true, () => false))) continue;
    const manifest = await fs.readFile(path.join(root, entry.name, 'manifest.json'), 'utf8')
      .then(JSON.parse, () => ({}));
    plugins.push({ name: entry.name, label: manifest.displayName || entry.name, installer });
  }
  return plugins.sort((left, right) => left.name.localeCompare(right.name));
}

async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files.sort();
}

async function fingerprint(directory) {
  const hash = crypto.createHash('sha256');
  for (const file of await listFiles(directory)) {
    hash.update(file).update('\0').update(await fs.readFile(path.join(directory, file))).update('\0');
  }
  return hash.digest('hex');
}

/**
 * Compile chaque plugin avec son propre install.mjs, dans un répertoire de
 * données jetable, puis embarque le résultat dans l'application
 * (`piecemaker-plugins/`). L'application le recopie dans le vrai répertoire de
 * données à chaque démarrage (overlay `bundled-plugins.js`).
 *
 * Un échec est bloquant : mieux vaut garder l'application en place que d'en
 * installer une à laquelle il manque un plugin.
 */
export async function embedBundledPlugins(sourceDir, stageDir) {
  ui.step('Compilation des plugins PieceMaker…');
  const plugins = await bundledPlugins(sourceDir);
  if (!plugins.length) throw new Error(`Aucun plugin trouvé sous ${path.join(sourceDir, 'plugins')}.`);

  const home = path.join(sourceDir, '.desktop-build', 'plugins-home');
  const bundleDir = path.join(stageDir, BUNDLE_DIR);
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(bundleDir, { recursive: true, force: true });
  await fs.mkdir(bundleDir, { recursive: true });

  for (const { name, label, installer } of plugins) {
    try {
      await run(process.execPath, [installer, sourceDir], {
        cwd: sourceDir,
        env: { ...process.env, CLOUDCLI_HOME: home },
      });
    } catch (error) {
      throw new Error(`Plugin ${label} : compilation échouée (${error.message}).`);
    }
  }

  const config = JSON.parse(await fs.readFile(path.join(home, 'plugins.json'), 'utf8'));
  const manifest = { plugins: {} };
  for (const { name, label } of plugins) {
    const built = path.join(bundleDir, name);
    await fs.cp(path.join(home, 'plugins', name), built, { recursive: true });
    // Aucun secret dans le paquet de l'application (lisible par tous sous
    // /Applications) : il est tiré au premier démarrage, dans plugins.json.
    const runtimePath = path.join(built, 'runtime.json');
    const runtime = await fs.readFile(runtimePath, 'utf8').then(JSON.parse, () => null);
    if (runtime && 'secret' in runtime) {
      await fs.writeFile(runtimePath, JSON.stringify({ ...runtime, secret: null }), { mode: 0o600 });
    }
    const { secrets: _secrets, ...pluginConfig } = config[name] || { enabled: true };
    manifest.plugins[name] = { fingerprint: await fingerprint(built), config: pluginConfig };
    ui.detail(`Plugin ${label} embarqué.`);
  }
  await fs.writeFile(path.join(bundleDir, 'bundle.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await fs.rm(home, { recursive: true, force: true });
  ui.ok(`${plugins.length} plugins PieceMaker embarqués dans l'application.`);
}
