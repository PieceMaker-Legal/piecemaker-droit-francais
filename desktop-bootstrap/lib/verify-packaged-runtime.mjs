import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureRuntimeComponents } from '../overlay/electron-piecemaker/runtime-components.mjs';

export async function verifyPackagedRuntime(applicationDir, assetDir, { executableName = 'PieceMaker.exe' } = {}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-packaged-runtime-'));
  try {
    const packedRoot = path.join(applicationDir, 'resources', 'app.asar');
    const physicalRoot = `${packedRoot}.unpacked`;
    const manifest = JSON.parse(fs.readFileSync(path.join(physicalRoot, 'runtime-components.json'), 'utf8'));
    const prepared = await ensureRuntimeComponents({
      manifest,
      cacheRoot: path.join(scratch, 'components'),
      fetchImpl: async (url) => ({ ok: true, body: fs.createReadStream(path.join(assetDir, decodeURIComponent(new URL(url).pathname.split('/').pop()))) }),
    });
    const probe = path.join(scratch, 'probe.mjs');
    fs.writeFileSync(probe, "import Database from 'better-sqlite3'; import bcrypt from 'bcrypt'; import pty from 'node-pty'; import {query} from '@anthropic-ai/claude-agent-sdk'; import {Codex} from '@openai/codex-sdk'; import {Octokit} from '@octokit/rest'; const db=new Database(':memory:'); if(db.prepare('select 7 as value').get().value!==7)throw new Error('SQLite failed'); if(!await bcrypt.compare('sample',await bcrypt.hash('sample',4)))throw new Error('bcrypt failed'); if(typeof pty.spawn!=='function'||typeof query!=='function'||typeof Codex!=='function'||typeof Octokit!=='function')throw new Error('Missing runtime export'); db.close(); console.log('packaged-runtime-ok');");
    const environment = Object.fromEntries(['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'ComSpec', 'PATHEXT'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
    const result = spawnSync(path.join(applicationDir, executableName), [probe], {
      cwd: physicalRoot,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 30000,
      env: {
        ...environment,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_OPTIONS: `--import=${pathToFileURL(path.join(physicalRoot, 'electron-piecemaker', 'asar-runtime.mjs')).href}`,
        PIECEMAKER_PACKED_APP_ROOT: packedRoot,
        PIECEMAKER_PHYSICAL_APP_ROOT: physicalRoot,
        PIECEMAKER_COMPONENT_MODULE_ROOTS: JSON.stringify(prepared.moduleRoots),
        USERPROFILE: scratch,
        LOCALAPPDATA: path.join(scratch, 'AppData', 'Local'),
        APPDATA: path.join(scratch, 'AppData', 'Roaming'),
      },
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('packaged-runtime-ok'));
    await ensureRuntimeComponents({ manifest, cacheRoot: path.join(scratch, 'components'), fetchImpl: async () => { throw new Error('Cache hit downloaded a component.'); } });
    return { nativeModules: true, providerModules: true, cacheReuse: true };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: verify-packaged-runtime.mjs <application-dir> <component-assets-dir>');
  console.log(JSON.stringify(await verifyPackagedRuntime(path.resolve(process.argv[2]), path.resolve(process.argv[3]))));
}
