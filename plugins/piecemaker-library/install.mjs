import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
const applicationRoot = path.resolve(process.argv[2] || path.join(source, '../..'));
const configFile = path.join(applicationRoot, 'product.config.json');
const product = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
const dataRoot = process.env.CLOUDCLI_HOME || path.join(os.homedir(), product.dataDirectoryName || '.claude-code-ui');
const target = path.join(dataRoot, 'plugins', 'piecemaker-library');
fs.mkdirSync(target, { recursive: true });
for (const filename of ['manifest.json', 'index.js', 'server.mjs', 'package.json']) fs.copyFileSync(path.join(source, filename), path.join(target, filename));
fs.writeFileSync(path.join(target, 'local.json'), JSON.stringify({ home: process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker') }), { mode: 0o600 });
const configPath = path.join(dataRoot, 'plugins.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
config['piecemaker-library'] = { ...config['piecemaker-library'], enabled: true };
fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
process.stdout.write(`Bibliothèque installée dans ${target}\n`);
