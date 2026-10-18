import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = path.join(os.homedir(), '.piecemaker-maj-test');
fs.mkdirSync(directory, { recursive: true });
process.env.CLOUDCLI_HOME = path.join(directory, 'app-data');
process.env.DATABASE_PATH = path.join(directory, 'app-data', 'auth.db');
process.env.PIECEMAKER_HOME = path.join(directory, 'components');
process.env.PIECEMAKER_RUNTIME_CACHE_ROOT = path.join(directory, 'runtime-components');
process.env.PIECEMAKER_PREBUILT_ASSET_DIR = process.env.PIECEMAKER_TEST_ASSETS_DIR || path.join(path.dirname(app.getPath('exe')), 'resources', 'test-assets');
process.env.PIECEMAKER_ANONYMIZER = 'off';
app.setPath('userData', path.join(directory, 'browser-profile'));
async function start() {
  const physicalRoot = path.join(path.dirname(app.getPath('exe')), 'resources', 'app.asar.unpacked');
  const certs = path.join(process.env.PIECEMAKER_HOME, 'certs');
  fs.mkdirSync(certs, { recursive: true });
  fs.copyFileSync(path.join(process.env.PIECEMAKER_PREBUILT_ASSET_DIR, 'localhost.crt'), path.join(certs, 'piecemaker-ca.crt'));
  fs.copyFileSync(path.join(process.env.PIECEMAKER_PREBUILT_ASSET_DIR, 'localhost.key'), path.join(certs, 'piecemaker-ca.key'));
  const { installRuntimeComponents } = await import(pathToFileURL(path.join(physicalRoot, 'desktop-bootstrap/composants/install.mjs')).href);
  await installRuntimeComponents({ sourceDir: physicalRoot, requirePrebuilt: true });
  await import('./main.js');
}
void start().catch((error) => { console.error(error); app.exit(1); });
