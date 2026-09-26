import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { getDatabasePath } from '@/modules/database/index.js';
import { getApplicationDataRoot } from '@/shared/utils.js';

export function installTelegramTab(applicationRoot: string): void {
  const source = path.join(applicationRoot, 'server/piecemaker/telegram/assets');
  const destination = path.join(getApplicationDataRoot(), 'plugins/piecemaker-telegram');
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const name of ['manifest.json', 'index.js', 'server.mjs', 'icon.svg']) {
    const content = fs.readFileSync(path.join(source, name));
    const target = path.join(destination, name);
    if (!fs.existsSync(target) || !fs.readFileSync(target).equals(content)) fs.writeFileSync(target, content, { mode: 0o600 });
  }
  const configPath = path.join(getApplicationDataRoot(), 'plugins.json');
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  const currentSecret = config['piecemaker-telegram']?.secrets?.access;
  const secret = typeof currentSecret === 'string' && currentSecret.length >= 32
    ? currentSecret : randomBytes(32).toString('hex');
  config['piecemaker-telegram'] = {
    ...config['piecemaker-telegram'],
    secrets: { ...config['piecemaker-telegram']?.secrets, access: secret },
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.writeFileSync(path.join(destination, 'runtime.json'), JSON.stringify({
    databasePath: getDatabasePath(),
    applicationRoot,
    secret,
  }), { mode: 0o600 });
}
