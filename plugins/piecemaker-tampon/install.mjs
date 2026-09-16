import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
const applicationRoot = path.resolve(process.argv[2] || path.join(source, '../..'));
const configFile = path.join(applicationRoot, 'product.config.json');
const product = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
const dataRoot = process.env.CLOUDCLI_HOME || path.join(os.homedir(), product.dataDirectoryName || '.claude-code-ui');
const target = path.join(dataRoot, 'plugins', 'piecemaker-tampon');

if (!fs.existsSync(path.join(applicationRoot, 'node_modules', 'esbuild'))) {
  process.stderr.write(`esbuild introuvable dans ${applicationRoot} — installez les dépendances de l'application avant ce plugin.\n`);
  process.exit(1);
}

const compilation = spawnSync(process.execPath, [path.join(source, 'build.mjs'), applicationRoot], {
  cwd: source,
  encoding: 'utf8',
  windowsHide: true,
});
if (compilation.status !== 0) {
  process.stderr.write(`${compilation.stdout || ''}${compilation.stderr || ''}`);
  process.stderr.write('Compilation du plugin Bordereau échouée.\n');
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.join(target, 'dist'), { recursive: true });
fs.cpSync(path.join(source, 'dist'), path.join(target, 'dist'), { recursive: true });
for (const filename of ['manifest.json', 'icon.svg', 'package.json']) fs.copyFileSync(path.join(source, filename), path.join(target, filename));

const configPath = path.join(dataRoot, 'plugins.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
config['piecemaker-tampon'] = { ...config['piecemaker-tampon'], enabled: true };
fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
process.stdout.write(`Bordereau installé dans ${target}\n`);
