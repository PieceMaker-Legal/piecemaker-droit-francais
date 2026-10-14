import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureRuntimeComponents } from '../overlay/electron-piecemaker/runtime-components.mjs';

async function verifyServer(executable, physicalRoot, environment) {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  const started = performance.now();
  const child = spawn(executable, [path.join(physicalRoot, 'dist-server/server/index.js')], {
    cwd: physicalRoot,
    windowsHide: true,
    env: { ...environment, HOST: '127.0.0.1', SERVER_PORT: String(port), PORT: String(port), PIECEMAKER_ANONYMIZER: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let spawnError;
  child.once('error', error => { spawnError = error; });
  const capture = chunk => { output = (output + chunk).slice(-16000); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const closed = new Promise(resolve => child.once('close', resolve));
  try {
    let health;
    while (performance.now() - started < 30000) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`Packaged server exited ${child.exitCode}: ${output}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
        if (response.ok) {
          health = await response.json();
          break;
        }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(health?.status, 'ok', `Packaged server did not become healthy: ${output}`);
    const index = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    assert.equal(index.status, 200, `Packaged interface failed: HTTP ${index.status}, location ${index.headers.get('location')}`);
    const html = await index.text();
    assert.match(html, /<html[\s>]/i);
    const scriptPath = html.match(/<script\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
    assert.ok(scriptPath, 'Packaged interface has no JavaScript entry.');
    const script = await fetch(new URL(scriptPath, `http://127.0.0.1:${port}/`), { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    assert.equal(script.status, 200, 'Packaged interface JavaScript is missing.');
    assert.match(script.headers.get('content-type') || '', /javascript/i);
    await script.arrayBuffer();
    return { serverStartupMs: Math.round(performance.now() - started), interface: true };
  } finally {
    if (child.exitCode === null && !spawnError) child.kill();
    await closed;
  }
}

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
    fs.writeFileSync(probe, "import Database from 'better-sqlite3'; import bcrypt from 'bcrypt'; import {createRequire} from 'node:module'; import path from 'node:path'; import pty from 'node-pty'; import {query} from '@anthropic-ai/claude-agent-sdk'; import {Codex} from '@openai/codex-sdk'; import {Octokit} from '@octokit/rest'; const express=createRequire(path.join(process.env.PIECEMAKER_PHYSICAL_APP_ROOT,'dist-server/server/index.js'))('express'); const db=new Database(':memory:'); if(db.prepare('select 7 as value').get().value!==7)throw new Error('SQLite failed'); if(!await bcrypt.compare('sample',await bcrypt.hash('sample',4)))throw new Error('bcrypt failed'); if(typeof express!=='function'||typeof pty.spawn!=='function'||typeof query!=='function'||typeof Codex!=='function'||typeof Octokit!=='function')throw new Error('Missing runtime export'); db.close(); console.log('packaged-runtime-ok');");
    const environment = Object.fromEntries(['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'ComSpec', 'PATHEXT'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
    const runtimeEnvironment = {
      ...environment,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: `--import=${pathToFileURL(path.join(physicalRoot, 'electron-piecemaker', 'asar-runtime.mjs')).href}`,
      PIECEMAKER_PACKED_APP_ROOT: packedRoot,
      PIECEMAKER_PHYSICAL_APP_ROOT: physicalRoot,
      PIECEMAKER_COMPONENT_MODULE_ROOTS: JSON.stringify(prepared.moduleRoots),
      CLOUDCLI_HOME: path.join(scratch, 'app-data'),
      DATABASE_PATH: path.join(scratch, 'app-data', 'auth.db'),
      PIECEMAKER_HOME: path.join(scratch, 'piecemaker'),
      USERPROFILE: scratch,
      LOCALAPPDATA: path.join(scratch, 'AppData', 'Local'),
      APPDATA: path.join(scratch, 'AppData', 'Roaming'),
    };
    const executable = path.join(applicationDir, executableName);
    const result = spawnSync(executable, [probe], {
      cwd: physicalRoot,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 30000,
      env: runtimeEnvironment,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('packaged-runtime-ok'));
    const server = await verifyServer(executable, physicalRoot, runtimeEnvironment);
    await ensureRuntimeComponents({ manifest, cacheRoot: path.join(scratch, 'components'), fetchImpl: async () => { throw new Error('Cache hit downloaded a component.'); } });
    return { nativeModules: true, providerModules: true, cacheReuse: true, ...server };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: verify-packaged-runtime.mjs <application-dir> <component-assets-dir>');
  console.log(JSON.stringify(await verifyPackagedRuntime(path.resolve(process.argv[2]), path.resolve(process.argv[3]))));
}
