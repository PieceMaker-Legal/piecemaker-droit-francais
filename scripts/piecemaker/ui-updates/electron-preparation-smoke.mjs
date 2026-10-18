import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeCompactRuntime } from '../../../desktop-bootstrap/overlay/electron-piecemaker/compact-runtime.mjs';

const root = mkdtempSync(path.join(os.tmpdir(), 'pm-first-start-'));
app.setPath('userData', path.join(root, 'browser-profile'));
process.env.PIECEMAKER_HOME = path.join(root, 'components');
process.env.PIECEMAKER_RUNTIME_CACHE_ROOT = path.join(root, 'cache');
app.on('window-all-closed', () => {});
let progress;
let main;
async function run() {
  try {
    await app.whenReady();
    const packedRoot = path.join(root, 'app.asar');
    const physicalRoot = packedRoot + '.unpacked';
    await fs.mkdir(path.join(physicalRoot, 'desktop-bootstrap/lib'), { recursive: true });
    await fs.writeFile(path.join(physicalRoot, 'runtime-components.json'), JSON.stringify({ repository: 'example/runtime', releaseTag: 'test', components: [] }));
    await fs.writeFile(path.join(physicalRoot, 'desktop-bootstrap/lib/prepare-installed.mjs'), 'export async function prepareInstalledDesktop() {}');
    const packagedApp = new Proxy(app, { get(target, name) {
      if (name === 'isPackaged') return true;
      const value = Reflect.get(target, name);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    class Controller { resolveServerEntry() { return ''; } }
    await initializeCompactRuntime({ app: packagedApp, LocalServerController: Controller, applicationRoot: packedRoot, createProgress: () => {
      progress = new BrowserWindow({ show: false });
      return progress;
    } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(progress.isDestroyed(), false, 'Preparation must remain alive until asynchronous desktop creation');
    main = new BrowserWindow({ show: false });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(progress.isDestroyed(), true, 'Preparation closes after the real desktop window exists');
    assert.equal(main.isDestroyed(), false);
    console.log(`PASS ${process.platform}: first preparation cannot close the application before the desktop opens`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    main?.destroy();
    if (progress && !progress.isDestroyed()) progress.destroy();
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    app.exit(process.exitCode || 0);
  }
}
void run();
