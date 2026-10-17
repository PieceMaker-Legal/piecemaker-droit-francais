import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import { currentVibeCliHost, isVibeInstalled, resolveVibeExecutable, type VibeCliHost } from '@/shared/vibe-cli.js';

import {
  createVibeInstallRouter,
  currentVibeInstallHost,
  installVibe,
  pythonCandidates,
  pythonVersionIsSupported,
  VIBE_PACKAGE,
  type CommandResult,
  type VibeInstallHost,
} from './vibe-install.js';

type RunCall = { command: string; args: string[] };

type FakeInstallOptions = {
  platform?: NodeJS.Platform;
  files?: Record<string, string>;
  pythonVersions?: Record<string, string>;
  failStep?: 'venv' | 'pip';
  vibeStarts?: boolean;
  delayMs?: number;
};

function fakeInstallHost({
  platform = 'darwin',
  files = {},
  pythonVersions = {},
  failStep,
  vibeStarts = true,
  delayMs = 0,
}: FakeInstallOptions = {}) {
  const windows = platform === 'win32';
  const api = windows ? path.win32 : path.posix;
  const homedir = windows ? 'C:\\Users\\jean' : '/Users/jean';
  const vibeDirectory = api.join(homedir, '.piecemaker', 'vibe');
  const vibeExecutable = api.join(vibeDirectory, windows ? 'Scripts' : 'bin', windows ? 'vibe.exe' : 'vibe');
  const state = { files: { ...files }, calls: [] as RunCall[], removed: [] as string[] };
  const cli: VibeCliHost = {
    platform,
    env: {},
    homedir,
    existsSync: (filePath) => filePath in state.files,
    readFileSync: (filePath) => {
      if (!(filePath in state.files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return state.files[filePath];
    },
    spawnSync: ((command: string) => ({
      status: command === vibeExecutable && command in state.files && vibeStarts ? 0 : 1,
    })) as unknown as VibeCliHost['spawnSync'],
    keyringServices: [],
  };
  const host: VibeInstallHost = {
    cli,
    async run(command, args): Promise<CommandResult> {
      state.calls.push({ command, args });
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (args[0] === '--version') {
        return command in pythonVersions ? { code: 0, output: pythonVersions[command] } : { code: 1, output: 'not found' };
      }
      if (args.includes('venv')) {
        return failStep === 'venv' ? { code: 1, output: 'Error: ensurepip is missing' } : { code: 0, output: '' };
      }
      if (failStep === 'pip') {
        return { code: 1, output: 'Collecting mistral-vibe\nERROR: No matching distribution found for cryptography==50.0.0' };
      }
      state.files[vibeExecutable] = '';
      return { code: 0, output: 'Successfully installed mistral-vibe' };
    },
    removeDirectory(directory) {
      state.removed.push(directory);
      for (const file of Object.keys(state.files)) {
        if (file.startsWith(directory)) delete state.files[file];
      }
    },
  };
  return { host, state, vibeDirectory, vibeExecutable };
}

test('on Windows, the Python 3.12 that PieceMaker installed creates the vibe environment', async () => {
  const configured = 'C:\\Users\\jean\\.piecemaker\\runtime-python\\abc\\python\\python.exe';
  const { host, state, vibeExecutable } = fakeInstallHost({
    platform: 'win32',
    files: { 'C:\\Users\\jean\\.piecemaker\\config.json': JSON.stringify({ pythonPath: configured }), [configured]: '' },
    pythonVersions: { [configured]: 'Python 3.12.10' },
  });
  await installVibe(host);
  assert.deepEqual(state.calls, [
    { command: configured, args: ['--version'] },
    { command: configured, args: ['-m', 'venv', 'C:\\Users\\jean\\.piecemaker\\vibe'] },
    {
      command: 'C:\\Users\\jean\\.piecemaker\\vibe\\Scripts\\python.exe',
      args: ['-m', 'pip', 'install', '--only-binary=:all:', VIBE_PACKAGE],
    },
  ]);
  assert.equal(resolveVibeExecutable(host.cli), vibeExecutable);
  assert.equal(isVibeInstalled(host.cli), true);
});

test('on macOS, a configured Python 3.11 is skipped for python3 3.12', async () => {
  const configured = '/Users/jean/.piecemaker/venv/bin/python';
  const { host, state, vibeExecutable } = fakeInstallHost({
    files: { '/Users/jean/.piecemaker/config.json': JSON.stringify({ pythonPath: configured }), [configured]: '' },
    pythonVersions: { [configured]: 'Python 3.11.9', python3: 'Python 3.12.5' },
  });
  await installVibe(host);
  assert.deepEqual(state.calls.map((call) => call.command), [configured, 'python3', 'python3', '/Users/jean/.piecemaker/vibe/bin/python']);
  assert.equal(resolveVibeExecutable(host.cli), vibeExecutable);
});

test('Python candidates: the configured interpreter first, a missing one is ignored', () => {
  const configured = '/Users/jean/.piecemaker/venv/bin/python';
  const config = { '/Users/jean/.piecemaker/config.json': JSON.stringify({ pythonPath: configured }) };
  assert.deepEqual(pythonCandidates(fakeInstallHost({ files: { ...config, [configured]: '' } }).host.cli), [configured, 'python3', 'python']);
  assert.deepEqual(pythonCandidates(fakeInstallHost({ files: config }).host.cli), ['python3', 'python']);
  assert.deepEqual(pythonCandidates(fakeInstallHost({ files: { '/Users/jean/.piecemaker/config.json': '{oops' } }).host.cli), ['python3', 'python']);
  assert.deepEqual(pythonCandidates(fakeInstallHost({ platform: 'win32' }).host.cli), ['python', 'python3']);
});

test('only Python 3.12 and 3.13 are accepted', () => {
  assert.equal(pythonVersionIsSupported('Python 3.12.5'), true);
  assert.equal(pythonVersionIsSupported('Python 3.13.0\n'), true);
  for (const version of ['Python 3.11.9', 'Python 3.10.0', 'Python 3.14.0', 'Python 2.7.18', 'Python 3.1', '']) {
    assert.equal(pythonVersionIsSupported(version), false, version);
  }
});

test('without a usable Python, nothing is created and the error says why', async () => {
  const { host, state } = fakeInstallHost({ pythonVersions: { python3: 'Python 3.10.4', python: 'Python 2.7.18' } });
  await assert.rejects(installVibe(host), /Python 3\.12 ou 3\.13 est introuvable/);
  assert.deepEqual(state.calls.map((call) => call.args[0]), ['--version', '--version']);
  assert.deepEqual(state.removed, []);
});

test('a failed venv creation removes the folder and reports Python’s message', async () => {
  const { host, state, vibeDirectory } = fakeInstallHost({ pythonVersions: { python3: 'Python 3.12.5' }, failStep: 'venv' });
  await assert.rejects(installVibe(host), /environnement Python de Vibe a échoué :\nError: ensurepip is missing/);
  assert.deepEqual(state.removed, [vibeDirectory, vibeDirectory]);
});

test('a failed download removes the folder and reports pip’s last lines', async () => {
  const { host, state, vibeDirectory, vibeExecutable } = fakeInstallHost({ pythonVersions: { python3: 'Python 3.12.5' }, failStep: 'pip' });
  await assert.rejects(installVibe(host), /téléchargement de Mistral Vibe a échoué :[\s\S]*cryptography==50\.0\.0/);
  assert.deepEqual(state.removed, [vibeDirectory, vibeDirectory]);
  assert.equal(vibeExecutable in state.files, false);
});

test('a vibe that does not start after download is removed', async () => {
  const { host, state, vibeDirectory, vibeExecutable } = fakeInstallHost({ pythonVersions: { python3: 'Python 3.12.5' }, vibeStarts: false });
  await assert.rejects(installVibe(host), /ne démarre pas/);
  assert.deepEqual(state.removed, [vibeDirectory, vibeDirectory]);
  assert.equal(vibeExecutable in state.files, false);
});

test('a previous partial install is wiped before starting again', async () => {
  const { host, state, vibeDirectory } = fakeInstallHost({
    pythonVersions: { python3: 'Python 3.12.5' },
    files: { '/Users/jean/.piecemaker/vibe/lib/stale.py': '' },
  });
  await installVibe(host);
  assert.deepEqual(state.removed, [vibeDirectory]);
  assert.equal('/Users/jean/.piecemaker/vibe/lib/stale.py' in state.files, false);
});

test('two simultaneous requests share a single install', async () => {
  const { host, state } = fakeInstallHost({ pythonVersions: { python3: 'Python 3.12.5' }, delayMs: 10 });
  const first = installVibe(host);
  const second = installVibe(host);
  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.equal(state.calls.filter((call) => call.args.includes('venv')).length, 1);
  await installVibe(host);
  assert.equal(state.calls.filter((call) => call.args.includes('venv')).length, 2);
});

async function withRouter(host: VibeInstallHost, run: (origin: string) => Promise<void>) {
  const app = express();
  app.use('/api/piecemaker', createVibeInstallRouter(() => host));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('the routes report the state, install, then report vibe as installed', async () => {
  const { host } = fakeInstallHost({ pythonVersions: { python3: 'Python 3.12.5' } });
  await withRouter(host, async (origin) => {
    assert.deepEqual(await (await fetch(`${origin}/api/piecemaker/vibe`)).json(), { installed: false, installing: false });
    const install = await fetch(`${origin}/api/piecemaker/vibe/install`, { method: 'POST' });
    assert.equal(install.status, 200);
    assert.deepEqual(await install.json(), { installed: true });
    assert.deepEqual(await (await fetch(`${origin}/api/piecemaker/vibe`)).json(), { installed: true, installing: false });
  });
});

test('the install route returns the error message with status 500', async () => {
  const { host } = fakeInstallHost({ pythonVersions: { python3: 'Python 3.12.5' }, failStep: 'pip' });
  await withRouter(host, async (origin) => {
    const install = await fetch(`${origin}/api/piecemaker/vibe/install`, { method: 'POST' });
    assert.equal(install.status, 500);
    assert.match(((await install.json()) as { error: string }).error, /cryptography==50\.0\.0/);
  });
});

test('real install of Mistral Vibe from PyPI into a temporary PIECEMAKER_HOME', {
  skip: process.env.PIECEMAKER_TEST_REAL_VIBE_INSTALL !== '1' && 'set PIECEMAKER_TEST_REAL_VIBE_INSTALL=1 (downloads about 20 MB)',
  timeout: 15 * 60_000,
}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-vibe-install-'));
  try {
    const cli = { ...currentVibeCliHost(), env: { PIECEMAKER_HOME: home, PATH: process.env.PATH }, homedir: home };
    const host = { ...currentVibeInstallHost(), cli };
    await installVibe(host);
    const executable = resolveVibeExecutable(cli);
    assert.equal(executable, path.join(home, 'vibe', process.platform === 'win32' ? 'Scripts\\vibe.exe' : 'bin/vibe'));
    assert.equal(isVibeInstalled(cli), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
