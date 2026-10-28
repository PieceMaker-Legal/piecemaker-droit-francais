import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { embedLibreOffice } from '../../../../server/piecemaker/vendor/installer/steps/10-libreoffice.mjs';

if (process.platform !== 'win32') throw new Error('Ce contrôle nécessite Windows.');
const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-office-stage-'));
try {
  await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify({ build: {} }));
  await embedLibreOffice(stage);
  const result = spawnSync(process.execPath, ['--test', 'server/piecemaker/stamping.test.js'], {
    env: { ...process.env, SOFFICE_PATH: path.join(stage, 'libreoffice', 'program', 'soffice.com'), PIECEMAKER_STAMP_OFFICE: '1' },
    stdio: 'inherit', timeout: 180000,
  });
  if (result.error || result.status !== 0) throw result.error || new Error(`Conversion bureautique échouée (${result.status}).`);
} finally {
  await fs.rm(stage, { recursive: true, force: true });
}
