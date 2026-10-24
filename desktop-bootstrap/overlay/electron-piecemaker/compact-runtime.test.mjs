import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LocalServerController } from '../../../electron/localServer.js';
import { initializeCompactRuntime } from './compact-runtime.mjs';

test('the compact runtime uses the CloudCLI server entry hook without replacing its controller', { timeout: 10000 }, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pm-compact-runtime-')));
  const packedRoot = path.join(root, 'application with spaces', 'app.asar');
  const physicalRoot = `${packedRoot}.unpacked`;
  const serverEntry = path.join(physicalRoot, 'dist-server', 'server', 'index.js');
  const resolveServerEntry = LocalServerController.prototype.resolveServerEntry;
  const environmentKeys = ['ELECTRON_SERVER_ENTRY', 'ELECTRON_NODE_PATH', 'NODE_OPTIONS', 'PIECEMAKER_PACKED_APP_ROOT', 'PIECEMAKER_PHYSICAL_APP_ROOT', 'PIECEMAKER_COMPONENT_MODULE_ROOTS', 'PIECEMAKER_RUNTIME_CACHE_ROOT'];
  const previousEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
  let child;
  t.after(async () => {
    if (child?.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, 'exit');
    }
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(path.dirname(serverEntry), { recursive: true });
  await fs.mkdir(path.join(physicalRoot, 'electron-piecemaker'));
  await fs.writeFile(path.join(physicalRoot, 'package.json'), JSON.stringify({ type: 'module' }));
  await fs.writeFile(path.join(physicalRoot, 'runtime-components.json'), JSON.stringify({ repository: 'example/app', releaseTag: 'v1', components: [] }));
  await fs.copyFile(new URL('./asar-runtime.mjs', import.meta.url), path.join(physicalRoot, 'electron-piecemaker', 'asar-runtime.mjs'));
  await fs.writeFile(serverEntry, 'process.stdout.write(JSON.stringify({ cwd: process.cwd(), entry: process.argv[1] }));');
  delete process.env.ELECTRON_SERVER_ENTRY;
  process.env.ELECTRON_NODE_PATH = process.execPath;
  process.env.PIECEMAKER_RUNTIME_CACHE_ROOT = path.join(root, 'cache');
  const runtime = await initializeCompactRuntime({ app: { isPackaged: true }, applicationRoot: packedRoot });
  assert.equal(LocalServerController.prototype.resolveServerEntry, resolveServerEntry);
  assert.equal(runtime.applicationRoot, physicalRoot);
  const controller = new LocalServerController({ appRoot: packedRoot, dataRoot: path.join(root, 'data') });
  assert.equal(await controller.resolveServerEntry(), serverEntry);
  assert.equal(controller.appRoot, packedRoot);
  controller.startBundledServer(12345, serverEntry);
  child = controller.ownedServerProcess;
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), { cwd: physicalRoot, entry: serverEntry });
});
