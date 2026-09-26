import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
const applicationRoot = path.resolve(process.argv[2] || path.join(source, '../..'));
const product = JSON.parse(fs.readFileSync(path.join(applicationRoot, 'product.config.json'), 'utf8'));
const dataRoot = process.env.CLOUDCLI_HOME || path.join(os.homedir(), product.dataDirectoryName);
const target = path.join(dataRoot, 'plugins', 'piecemaker-telegram');
const configPath = path.join(dataRoot, 'plugins.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
const currentSecret = config['piecemaker-telegram']?.secrets?.access;
const secret = typeof currentSecret === 'string' && currentSecret.length >= 32
  ? currentSecret : randomBytes(32).toString('hex');
const envPath = path.join(applicationRoot, '.env');
const envDatabasePath = fs.existsSync(envPath)
  ? fs.readFileSync(envPath, 'utf8').split('\n').map((line) => line.trim()).find((line) => line.startsWith('DATABASE_PATH='))?.slice('DATABASE_PATH='.length)
  : undefined;
const configuredDatabasePath = process.env.DATABASE_PATH || envDatabasePath || path.join(dataRoot, 'auth.db');
const databasePath = path.isAbsolute(configuredDatabasePath)
  ? configuredDatabasePath : path.resolve(applicationRoot, configuredDatabasePath);

fs.mkdirSync(target, { recursive: true, mode: 0o700 });
for (const filename of ['manifest.json', 'icon.svg', 'index.js', 'server.mjs']) {
  fs.copyFileSync(path.join(source, filename), path.join(target, filename));
}
config['piecemaker-telegram'] = {
  ...config['piecemaker-telegram'],
  enabled: true,
  secrets: { ...config['piecemaker-telegram']?.secrets, access: secret },
};
fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
fs.writeFileSync(path.join(target, 'runtime.json'), JSON.stringify({
  databasePath,
  applicationRoot,
  secret,
}), { mode: 0o600 });
process.stdout.write(`Telegram installé dans ${target}\n`);
