import { randomBytes } from 'node:crypto';
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
const target = path.join(dataRoot, 'plugins', 'piecemaker-tabular-review');

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
  process.stderr.write('Compilation du plugin Tabular Review échouée.\n');
  process.exit(1);
}

function locate(command) {
  const lookup = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], { encoding: 'utf8', windowsHide: true });
  const found = lookup.status === 0 ? lookup.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) : '';
  return found && path.isAbsolute(found) ? found : null;
}

const configPath = path.join(dataRoot, 'plugins.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
const currentSecret = config['piecemaker-tabular-review']?.secrets?.access;
const secret = typeof currentSecret === 'string' && currentSecret.length >= 32 ? currentSecret : randomBytes(32).toString('hex');
const codexLauncher = path.join(applicationRoot, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.join(target, 'dist'), { recursive: true, mode: 0o700 });
fs.cpSync(path.join(source, 'dist'), path.join(target, 'dist'), { recursive: true });
for (const filename of ['manifest.json', 'icon.svg', 'package.json', 'launcher.mjs']) fs.copyFileSync(path.join(source, filename), path.join(target, filename));

config['piecemaker-tabular-review'] = {
  ...config['piecemaker-tabular-review'],
  enabled: true,
  secrets: { ...config['piecemaker-tabular-review']?.secrets, access: secret },
};
fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
fs.writeFileSync(path.join(target, 'runtime.json'), JSON.stringify({
  applicationRoot,
  nodePath: process.execPath,
  secret,
  claudePath: locate('claude'),
  codexPath: locate('codex'),
  codexLauncher: fs.existsSync(codexLauncher) ? codexLauncher : null,
  vibePath: locate('vibe'),
}), { mode: 0o600 });
process.stdout.write(`Tabular Review installé dans ${target}\n`);
