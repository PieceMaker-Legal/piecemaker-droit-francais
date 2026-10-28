import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { embedLibreOffice } from '../../server/piecemaker/vendor/installer/steps/10-libreoffice.mjs';
import { verifyMacBundleLinks } from '../../desktop-bootstrap/lib/prebuilt-app.mjs';

const mac = process.platform === 'darwin';
if (!mac && process.platform !== 'win32') throw new Error('Ce contrôle nécessite Windows ou macOS.');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-office-stage-'));
try {
  const app = path.join(root, mac ? 'PieceMaker.app' : 'PieceMaker');
  const stage = mac ? path.join(app, 'Contents', 'Resources') : path.join(app, 'resources');
  const executable = mac ? path.join(app, 'Contents', 'MacOS', 'PieceMaker') : path.join(app, 'PieceMaker.exe');
  await fs.mkdir(stage, { recursive: true });
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify({ build: {} }));
  await fs.copyFile(process.execPath, executable);
  if (mac) await fs.chmod(executable, 0o755);
  await embedLibreOffice(stage);
  if (mac) await verifyMacBundleLinks(app);
  const result = spawnSync(executable, ['--test', 'server/piecemaker/stamping.test.js'], {
    env: { ...process.env, SOFFICE_PATH: '', PIECEMAKER_STAMP_OFFICE: '1' },
    stdio: 'inherit', timeout: 180000,
  });
  if (result.error || result.status !== 0) throw result.error || new Error(`Conversion bureautique échouée (${result.status}).`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
