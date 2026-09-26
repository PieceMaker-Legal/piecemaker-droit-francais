import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { removeLegacyProxyConfig } from '../../../server/piecemaker/anonymizer/client-config.cjs';

const userHome = os.homedir();
const homeDir = path.join(userHome, '.piecemaker');
const configFile = path.join(homeDir, 'config.json');
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Configuration PieceMaker invalide');

const next = { ...config, anonymizer: { ...config.anonymizer, enabled: false } };
const temporary = `${configFile}.piecemaker-${process.pid}-${Date.now()}`;
fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(temporary, configFile);

removeLegacyProxyConfig({ userHome, homeDir });
process.stdout.write('Proxy PII PieceMaker désactivé.\n');
