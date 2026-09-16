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
const target = path.join(dataRoot, 'plugins', 'piecemaker-dossier');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const dependencies = ['better-sqlite3', 'esbuild'];

if (!dependencies.every((dependency) => fs.existsSync(path.join(source, 'node_modules', dependency)))) {
  const installation = spawnSync(npmCommand, ['ci', '--no-audit', '--no-fund'], {
    cwd: source,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (installation.status !== 0) process.exit(installation.status || 1);
}

const build = spawnSync(npmCommand, ['run', 'build'], {
  cwd: source,
  stdio: 'inherit',
  windowsHide: true,
});
if (build.status !== 0) process.exit(build.status || 1);

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.join(target, 'dist'), { recursive: true });
fs.copyFileSync(path.join(source, 'dist', 'client.js'), path.join(target, 'dist', 'client.js'));
for (const filename of ['manifest.json', 'icon.svg', 'package.json']) fs.copyFileSync(path.join(source, filename), path.join(target, filename));

const configPath = path.join(dataRoot, 'plugins.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
config['piecemaker-dossier'] = { ...config['piecemaker-dossier'], enabled: true };
fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
process.stdout.write(`Dossier installé dans ${target}\n`);
